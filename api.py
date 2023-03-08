import json
import math
import sqlite3
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formatdate
from smtplib import SMTP

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, BaseSettings, Field


DT_FMT = "%Y%m%d%H%M"


class Settings(BaseSettings):
    database: str
    admin_email: list[str]
    admin_password: str
    smtp_host: str
    smtp_port: int
    admin_slack: str = None
    days: int = Field(14, gt=0)
    notify_on_signup: bool = False

    class Config:
        @classmethod
        def parse_env_var(cls, field_name: str, raw_val: str):
            if field_name == "admin_email":
                emails = []
                for x in raw_val.split(','):
                    x = x.strip().lower()
                    if x not in emails:
                        emails.append(x)

                return emails

            return cls.json_loads(raw_val)


settings = Settings()
tags = [
    {
        "name": "Root",
        "description": "Get the date and time of the latest update.",
    },
    {
        "name": "Overall activity",
        "description": "Get the overall recent activity.",
    },
    {
        "name": "Team activity",
        "description": "Get the recent activity of a specific team.",
    },
    {
        "name": "Teams carbon footprint",
        "description": "Get the carbon footprint per team."
    },
    {
        "name": "Memory",
        "description": "Get the distribution of the memory efficiency "
                       "of recently completed jobs."
    },
    {
        "name": "CPU",
        "description": "Get the distribution of the CPU efficiency "
                       "of recently completed jobs."
    },
    {
        "name": "Statuses",
        "description": "Get the number of recently completed and failed jobs."
    },
    {
        "name": "Runtimes",
        "description": "Get the distribution of runtimes for recently "
                       "completed LSF jobs."
    },
    {
        "name": "User",
        "description": "Get user information"
    },
    {
        "name": "User footprint",
        "description": "Get user recent activity and footprint"
    },
    {
        "name": "Sign up",
        "description": "Receive the unique identifier to access your activity "
                       "and carbon footprint"
    },
    {
        "name": "User report",
        "description": "Get your carbon footprint for a given month"
    }
]
app = FastAPI(
    title="EMBL-EBI HPC CO2",
    description="Simple carbon footprint tracker for EMBL-EBI",
    openapi_tags=tags,
    docs_url="/docs/",
    redoc_url=None
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["Root"])
async def root():
    con = sqlite3.connect(settings.database)
    dt = get_last_update(con)
    con.close()
    return {
        "meta": {
            "email": settings.admin_email[0],
            "slack": settings.admin_slack,
            "updated": dt.strftime("%A, %d %b %Y, %H:%M")
        }
    }


@app.get("/activity/", tags=["Overall activity"])
async def get_overall_activity(start: str | None = None,
                               stop: str | None = None,
                               days: int = settings.days):
    con = sqlite3.connect(settings.database)
    start, stop = get_interval(con, start, stop, days)
    start = floor2hour(start)
    stop = floor2hour(stop)

    activity = []
    sliding_window = []
    core_events = {}
    mem_events = {}
    cpu_time = co2e = cost = 0

    for dt_str, ts, users_data, _ in iter_usage(con, start, stop):
        user_cores = {}
        user_memory = {}
        submitted_jobs = 0
        completed_jobs = 0
        failed_jobs = 0
        for user, values in users_data.items():
            user_cores[user] = values["cores"]
            user_memory[user] = values["memory"]
            submitted_jobs += values["submitted"]
            completed_jobs += values["done"]
            failed_jobs += values["failed"]

            co2e += values["co2e"]
            cost += values["cost"]
            cpu_time += values["cputime"]

        activity.append({
            "timestamp": ts,
            "cores": sum(user_cores.values()),
            "memory": sum(user_memory.values()),
            "jobs": {
                "submitted": submitted_jobs,
                "completed": completed_jobs,
                "failed": failed_jobs
            }
        })

        # if len(sliding_window) == 8:  # 8 * 15min: window of 2h
        #     sliding_window.pop(0)
        #
        # sliding_window.append((ts, user_cores, user_memory))
        # find_events(sliding_window, core_events, mem_events, min_growth=1.5)

    con.close()

    return {
        "data": {
            "activity": activity,
            "events": {
                "cores": filter_events(core_events),
                "memory": filter_events(mem_events),
            },
            "co2e": co2e,
            "cost": cost,
            "cputime": cpu_time
        },
        "meta": {
            "days": days,
            "start": start.strftime(DT_FMT),
            "stop": stop.strftime(DT_FMT)
        }
    }


@app.get("/footprint/teams/", tags=["Teams carbon footprint"])
async def get_daily_team_footprint(start: str | None = None,
                                   stop: str | None = None,
                                   days: int = settings.days):
    con = sqlite3.connect(settings.database)
    start, stop = get_interval(con, start, stop, days)
    start = floor2day(start)
    stop = floor2hour(stop)
    user2teams = {}
    teams = {}
    for u in load_users(con):
        user2teams[u["id"]] = u["teams"]

        for team in u["teams"]:
            teams[team] = {
                "name": team,
                "co2e": 0,
                "cost": 0,
                "cputime": 0
            }

    activity = []
    _teams = {}
    day = day_ts = None
    for dt_str, ts, users_data, _ in iter_usage(con, start, stop):
        _day = dt_str[:8]

        if _day != day:
            if day_ts is not None:
                activity.append({
                    "timestamp": day_ts,
                    "teams": _teams,
                })

            day = _day
            day_ts = ts
            _teams = {}

        for user, values in users_data.items():
            co2e = values["co2e"]
            cost = values["cost"]
            cpu_time = values["cputime"]

            try:
                user_teams = user2teams[user]
            except KeyError:
                continue

            for team in user_teams:
                team_obj = teams[team]
                team_obj["co2e"] += co2e / len(user_teams)
                team_obj["cost"] += cost / len(user_teams)
                team_obj["cputime"] += cpu_time / len(user_teams)

                try:
                    _teams[team] += co2e / len(user_teams)
                except KeyError:
                    _teams[team] = co2e / len(user_teams)

    if day_ts is not None:
        activity.append({
            "timestamp": day_ts,
            "teams": _teams,
        })

    con.close()

    return {
        "data": {
            "activity": activity,
            "teams": list(teams.values())
        },
        "meta": {
            "days": days,
            "start": start.strftime(DT_FMT),
            "stop": stop.strftime(DT_FMT)
        }
    }


def get_user(con: sqlite3.Connection, uuid: str) -> dict:
    row = con.execute("SELECT login, name, teams, position, photo_url "
                      "FROM user WHERE uuid = ?", [uuid]).fetchone()
    if row is None:
        con.close()
        if row is None:
            raise HTTPException(status_code=401, detail={
                "status": "401",
                "title": "Unauthorized",
                "detail": "Invalid UUID"
            })

    return {
        "login": row[0],
        "name": row[1],
        "teams": sorted(json.loads(row[2])),
        "position": row[3],
        "photoUrl": row[4]
    }


@app.get("/user/{uuid}/", tags=["User"])
async def sign_in(uuid: str):
    con = sqlite3.connect(settings.database)
    user = get_user(con, uuid)
    username = user["login"]
    rows = con.execute("SELECT month FROM report "
                       "WHERE login=? ORDER BY month", [username]).fetchall()
    con.close()

    user["reports"] = []
    for month, in rows:
        user["reports"].append((
            month,
            datetime.strptime(month, "%Y-%m").strftime("%B %Y")
        ))

    return {
        "meta": user
    }


class User(BaseModel):
    email: str


def send_email(login: str, recipient: str, to_email: str, uuid: str):
    content = f"""\
Dear {recipient},

You, or someone else, requested the UUID for {login}.

It allows you to find out the recent activity and carbon footprint of {login}.

The UUID is: {uuid}

(This is an automated email)
    """

    msg = EmailMessage()
    msg["Subject"] = f"EMBL-EBI carbon footprint: UUID reminder for {login}"
    msg["To"] = to_email
    msg["From"] = settings.admin_email[0]
    msg["Date"] = formatdate(localtime=True)
    msg.set_content(content)

    admin_email = settings.admin_email[0]

    with SMTP(host=settings.smtp_host, port=settings.smtp_port) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(admin_email.split('@')[0], settings.admin_password)
        server.send_message(msg)

        if settings.notify_on_signup:
            msg = EmailMessage()
            msg["Subject"] = (f"EMBL-EBI carbon footprint: "
                              f"UUID requested for {login}")
            msg["To"] = admin_email
            msg["From"] = admin_email
            msg["Date"] = formatdate(localtime=True)
            msg.set_content(
                f"""\
Someone asked for a UUID reminder:
User: {login}
Name: {recipient}
                """
            )

            server.send_message(msg)


@app.post("/user/", tags=["Sign up"])
async def sign_up(user: User):
    login, domain = user.email.split("@", maxsplit=1)
    con = sqlite3.connect(settings.database)
    row = con.execute("SELECT name, uuid, sponsor FROM user "
                      "WHERE login=?", [login]).fetchone()

    if row is None:
        con.close()
        raise HTTPException(status_code=400, detail={
            "status": "400",
            "title": "Bad Request",
            "detail": f"No user found with e-mail address {user.email}"
        })

    name, uuid, sponsor = row

    if sponsor:
        row = con.execute("SELECT name FROM user "
                          "WHERE login=?", [sponsor]).fetchone()
        if row is not None and row[0] is not None:
            # We know the name of the sponsor
            recipient = row[0]
        else:
            # Use sponsor's login
            recipient = sponsor

        to_email = f"{sponsor}@{domain}"
    else:
        recipient = name or login
        to_email = user.email

    con.close()

    try:
        send_email(login, recipient, to_email, uuid)
    except Exception as exc:
        print(exc)
        raise HTTPException(status_code=500, detail={
            "status": "500",
            "title": "Internal Server Error",
            "detail": f"Could not send email to {user.email}"
        })

    return {
        "meta": {
            "email": to_email,
            "sponsor": bool(sponsor)
        }
    }


@app.get("/user/{uuid}/footprint/", tags=["User footprint"])
async def get_user_footprint(uuid: str, start: str | None = None,
                             stop: str | None = None,
                             days: int = settings.days):
    con = sqlite3.connect(settings.database)
    start, stop = get_interval(con, start, stop, days)
    start = floor2hour(start)
    stop = floor2hour(stop)
    user = get_user(con, uuid)
    username = user["login"]

    activity = []
    jobs = submitted = done = failed = co2e = cost = 0
    memdist = [0] * 5
    for dt_str, ts, users_data, _ in iter_usage(con, start, stop):
        try:
            values = users_data[username]
        except KeyError:
            cores = mem = 0
        else:
            jobs += values["jobs"]
            cores = values["cores"]
            mem = values["memory"]
            co2e += values["co2e"]
            cost += values["cost"]
            submitted += values["submitted"]
            done += values["done"]
            failed += values["failed"]
            for i, v in enumerate(values["memeff"]):
                memdist[i] += v

        activity.append({
            "timestamp": ts,
            "cores": cores,
            "memory": mem,
        })

    con.close()

    return {
        "data": {
            "jobs": round(jobs),
            "done": done,
            "exit": failed,
            "co2e": co2e,
            "cost": cost,
            "activity": activity,
            "memory": memdist
        },
        "meta": {
            "days": days,
            "start": start.strftime(DT_FMT),
            "stop": stop.strftime(DT_FMT)
        }
    }


@app.get("/user/{uuid}/report/{month}/", tags=["User report"])
async def get_user_report(uuid: str, month: str):
    con = sqlite3.connect(settings.database)
    user = get_user(con, uuid)
    username = user["login"]
    row = con.execute("SELECT data FROM report WHERE login=? AND month=?",
                      [username, month]).fetchone()

    if row is None:
        con.close()
        raise HTTPException(status_code=404, detail={
            "status": "404",
            "title": "Not found",
            "detail": "There is no report for this user and month"
        })

    data = json.loads(row[0])

    # Teams the user belongs to
    teams = {}
    for team in user["teams"]:
        teams[team] = {
            "name": team,
            "co2e": data["co2e"] / len(user["teams"]),
            "cost": data["cost"] / len(user["teams"]),
        }

    # Other team members
    team_members = {}
    for u in load_users(con):
        if u["id"] == username:
            continue

        for team in u["teams"]:
            if team in teams:
                try:
                    team_members[u["id"]]["teams"].append(team)
                except KeyError:
                    team_members[u["id"]] = {
                        "teams": [team],
                        "divisor": len(u["teams"])
                    }

    # Report of other team members
    for login, raw_data in con.execute(
        f"""
        SELECT login, data
        FROM report
        WHERE login IN ({','.join(['?' for _ in team_members])})
        AND month = ?
        """,
        list(team_members.keys()) + [month]
    ):
        user_data = json.loads(raw_data)
        obj = team_members[login]

        for team in obj["teams"]:
            teams[team]["co2e"] += user_data["co2e"] / obj["divisor"]
            teams[team]["cost"] += user_data["cost"] / obj["divisor"]

    con.close()

    data["teams"] = sorted(teams.values(), key=lambda x: x["name"])

    return {
        "data": data,
        "meta": {
            "month": datetime.strptime(month, "%Y-%m").strftime("%B %Y")
        }
    }


@app.get("/user/{uuid}/team/{team:path}/", tags=["Team activity"])
async def get_team_activity(uuid: str, team: str,
                            start: str | None = None,
                            stop: str | None = None,
                            days: int = settings.days):
    con = sqlite3.connect(settings.database)
    start, stop = get_interval(con, start, stop, days)
    start = floor2hour(start)
    stop = floor2hour(stop)
    user = get_user(con, uuid)
    if team not in user["teams"]:
        raise HTTPException(status_code=401, detail={
            "status": "401",
            "title": "Unauthorized",
            "detail": "You are not authorized to access this team's activity"
                      " and footprint"
        })

    team_users = {}
    teams_per_user = {}
    for u in load_users(con):
        if team in u["teams"]:
            team_users[u["id"]] = u["name"]
            teams_per_user[u["id"]] = len(u["teams"])

    activity = []
    footprint_per_day = []
    users = {}
    day = day_ts = None
    for dt_str, ts, users_data, _ in iter_usage(con, start, stop):
        _day = dt_str[:8]

        if _day != day:
            if day_ts is not None:
                footprint_per_day.append({
                    "timestamp": day_ts,
                    "users": users
                })

            day = _day
            day_ts = ts
            users = {}

        ts_cores = ts_memory = 0
        for login, values in users_data.items():
            try:
                num_teams = teams_per_user[login]
            except KeyError:
                continue

            cores = values["cores"] / num_teams
            memory = values["memory"] / num_teams
            co2e = values["co2e"] / num_teams
            cost = values["cost"] / num_teams

            try:
                user = users[login]
            except KeyError:
                user = users[login] = {
                    "co2e": 0,
                    "cost": 0,
                }

            user["co2e"] += co2e
            user["cost"] += cost

            ts_cores += cores
            ts_memory += memory

        activity.append({
            "timestamp": ts,
            "cores": ts_cores,
            "memory": ts_memory,
        })

    if day_ts is not None:
        footprint_per_day.append({
            "timestamp": day_ts,
            "users": users
        })

    con.close()

    return {
        "data": {
            "activity": activity,
            "footprint": footprint_per_day,
        },
        "meta": {
            "days": days,
            "start": start.strftime(DT_FMT),
            "stop": stop.strftime(DT_FMT),
            "users": team_users
        }
    }


@app.get("/distribution/cpu/", tags=["CPU"])
async def get_cpu_usage(start: str | None = None,
                        stop: str | None = None,
                        days: int = settings.days):
    con = sqlite3.connect(settings.database)
    start, stop = get_interval(con, start, stop, days)
    start = floor2hour(start)
    stop = floor2hour(stop)
    cpu_dist = [0] * 100
    for dt_str, ts, _, jobs_data in iter_usage(con, start, stop):
        for i, v in enumerate(jobs_data["cpueff"]):
            cpu_dist[i] += v

    con.close()

    return {
        "data": {
            "dist": cpu_dist,
        },
        "meta": {
            "days": days,
            "start": start.strftime(DT_FMT),
            "stop": stop.strftime(DT_FMT)
        }
    }


@app.get("/distribution/memory/", tags=["Memory"])
async def get_memory_usage(start: str | None = None,
                           stop: str | None = None,
                           days: int = settings.days):
    con = sqlite3.connect(settings.database)
    start, stop = get_interval(con, start, stop, days)
    start = floor2hour(start)
    stop = floor2hour(stop)
    co2e = cost = 0
    mem_dist = [0] * 100
    for dt_str, ts, _, jobs_data in iter_usage(con, start, stop):
        for i, v in enumerate(jobs_data["memeff"]["dist"]):
            mem_dist[i] += v

        co2e += jobs_data["memeff"]["co2e"]
        cost += jobs_data["memeff"]["cost"]

    con.close()

    return {
        "data": {
            "dist": mem_dist,
            "wasted": {
                "co2e": co2e,
                "cost": cost,
            }
        },
        "meta": {
            "days": days,
            "start": start.strftime(DT_FMT),
            "stop": stop.strftime(DT_FMT)
        }
    }


@app.get("/distribution/runtime/", tags=["Runtimes"])
async def get_runtimes(start: str | None = None,
                       stop: str | None = None,
                       days: int = settings.days):
    con = sqlite3.connect(settings.database)
    start, stop = get_interval(con, start, stop, days)
    start = floor2hour(start)
    stop = floor2hour(stop)
    runtimes = [
        ["&le; 1 min", 0],
        ["1 - 10 min", 0],
        ["10 min - 1 h", 0],
        ["1 - 3 h", 0],
        ["3 - 6 h", 0],
        ["6 - 12 h", 0],
        ["12 h - 1 d", 0],
        ["1 - 2 d", 0],
        ["2 - 3 d", 0],
        ["3 - 7 d", 0],
        ["&gt; 7 d", 0],
    ]
    for dt_str, ts, _, jobs_data in iter_usage(con, start, stop):
        for i, v in enumerate(jobs_data["runtimes"]):
            runtimes[i][1] += v

    con.close()

    return {
        "data": {
            "dist": runtimes,
        },
        "meta": {
            "days": days,
            "start": start.strftime(DT_FMT),
            "stop": stop.strftime(DT_FMT)
        }
    }


@app.get("/statuses/", tags=["Statuses"])
async def get_job_statuses(start: str | None = None,
                           stop: str | None = None,
                           days: int = settings.days):
    con = sqlite3.connect(settings.database)
    start, stop = get_interval(con, start, stop, days)
    start = floor2hour(start)
    stop = floor2hour(stop)
    done = failed = co2e = cost = 0
    for dt_str, ts, _, jobs_data in iter_usage(con, start, stop):
        done += jobs_data["done"]
        failed += jobs_data["failed"]["count"]
        co2e += jobs_data["failed"]["co2e"]
        cost += jobs_data["failed"]["cost"]

    con.close()

    return {
        "data": {
            "jobs": {
                "done": done,
                "exit": failed
            },
            "wasted": {
                "co2e": co2e,
                "cost": cost
            }
        },
        "meta": {
            "days": days,
            "start": start.strftime(DT_FMT),
            "stop": stop.strftime(DT_FMT)
        }
    }


def get_last_update(con: sqlite3.Connection) -> datetime:
    time, = con.execute("SELECT value FROM metadata "
                        "WHERE key = 'jobs'").fetchone()
    return datetime.strptime(time, "%Y-%m-%d %H:%M:%S")


def iter_usage(con: sqlite3.Connection, start: datetime, stop: datetime):
    sql = """
        SELECT time, users_data, jobs_data 
        FROM usage
        WHERE time >= ? AND time < ?
        ORDER BY time
    """
    params = [start.strftime(DT_FMT), stop.strftime(DT_FMT)]
    for row in con.execute(sql, params):
        dt_str = row[0]
        ts = math.floor(strptime(dt_str).timestamp()) * 1000
        yield dt_str, ts, json.loads(row[1]), json.loads(row[2])


def floor2hour(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, dt.day, dt.hour)


def floor2day(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, dt.day)


def filter_events(events: dict, min_interval_ms: int = 1 * 3600 * 1000):
    main_events = []
    for e in sorted(events.values(), key=lambda e: -e["delta"]):
        for o in main_events:
            if abs(e["x"] - o["x"]) < min_interval_ms:
                break
        else:
            main_events.append(e)

    for e in main_events:
        del e["delta"]

    return sorted(main_events, key=lambda xe: xe["x"])


def find_events(windows: list[tuple[int, dict, dict]], cores_events: dict,
                mem_events: dict, min_growth: float):
    ts1, user_cores1, user_mem1 = windows[0]
    cores1 = sum(user_cores1.values())
    mem1 = sum(user_mem1.values())
    max_delta_cores = 0
    max_delta_cores_idx = 0
    max_delta_mem = 0
    max_delta_mem_idx = 0

    for i, (ts2, user_cores2, user_mem2) in enumerate(windows[1:]):
        cores2 = sum(user_cores2.values())
        mem2 = sum(user_mem2.values())
        delta = cores2 - cores1
        if delta > max_delta_cores:
            max_delta_cores = delta
            max_delta_cores_idx = i + 1

        delta = mem2 - mem1
        if delta > max_delta_mem:
            max_delta_mem = delta
            max_delta_mem_idx = i + 1

    growth = (cores1 + max_delta_cores) / cores1
    if growth >= min_growth:
        ts2, user_cores2, _ = windows[max_delta_cores_idx]
        users_delta = {}
        for user, count in user_cores2.items():
            users_delta[user] = count - user_cores1.get(user, 0)

        user, count = sorted(users_delta.items(), key=lambda x: -x[1])[0]
        if ts2 not in cores_events or count > cores_events[ts2]["delta"]:
            cores_events[ts2] = {
                "x": ts2,
                "y": cores1 + max_delta_cores,
                "text": f"{user}: +{count:,.0f}",
                "delta": count,
            }

    if (mem1 + max_delta_mem) / mem1 >= min_growth:
        ts2, user_mem2, _ = windows[max_delta_mem_idx]
        users_delta = {}
        for user, count in user_mem2.items():
            users_delta[user] = count - user_mem1.get(user, 0)

        user, count = sorted(users_delta.items(), key=lambda x: -x[1])[0]
        if ts2 not in mem_events or max_delta_mem > mem_events[ts2]["delta"]:
            mem_events[ts2] = {
                "x": ts2,
                "y": (mem1 + max_delta_mem),
                "text": f"{user}: +{count:,.0f} TB",
                "delta": max_delta_mem
            }


def load_users(con: sqlite3.Connection) -> list[dict]:
    data = []
    for row in con.execute("SELECT login, name, teams, photo_url FROM user"):
        data.append({
            "id": row[0],
            "name": row[1],
            "teams": json.loads(row[2]),
            "photoUrl": row[3]
        })

    return data


def strptime(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%d%H%M")


def get_interval(con: sqlite3.Connection, start: str | None, stop: str | None,
                 days: int) -> tuple[datetime, datetime]:
    if start and stop:
        try:
            start = strptime(start)
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "status": "400",
                "title": "Bad Request",
                "detail": "'start' query parameter has an invalid time format "
                          "(expected: YYYYMMDDHHMM)"
            })

        try:
            stop = strptime(stop)
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "status": "400",
                "title": "Bad Request",
                "detail": "'stop' query parameter has an invalid time format "
                          "(expected: YYYYMMDDHHMM)"
            })
    else:
        stop = get_last_update(con)
        start = stop - timedelta(days=days)

    return start, stop
