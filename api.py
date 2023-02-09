import json
import sqlite3
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formatdate
from math import floor
from smtplib import SMTP

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, BaseSettings


class Settings(BaseSettings):
    database: str
    admin_email: list[str]
    smtp_host: str
    smtp_port: int
    admin_slack: str = None
    days: int = 14
    notify_on_signup: bool = False

    class Config:
        @classmethod
        def parse_env_var(cls, field_name: str, raw_val: str):
            if field_name == 'admin_email':
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
async def get_overall_activity(days: int = settings.days):
    activity = []

    sliding_window = []
    core_events = {}
    mem_events = {}
    con = sqlite3.connect(settings.database)
    for dt_str, ts, users_data, _ in iter_usage(con, days):
        user_cores = {}
        user_memory = {}
        for user, values in users_data.items():
            user_cores[user] = values[1]
            user_memory[user] = values[2]

        activity.append({
            "timestamp": ts,
            "cores": sum(user_cores.values()),
            "memory": sum(user_memory.values()),
        })

        if len(sliding_window) == 8:  # 8 * 15min: window of 2h
            sliding_window.pop(0)

        sliding_window.append((ts, user_cores, user_memory))

        # find_events(sliding_window, core_events, mem_events, min_growth=1.5)

    con.close()

    return {
        "data": {
            "activity": activity,
            "events": {
                "cores": filter_events(core_events),
                "memory": filter_events(mem_events),
            },
        },
        "meta": {
            "days": days
        }
    }


@app.get("/footprint/teams/", tags=["Teams carbon footprint"])
async def get_daily_team_footprint(days: int = settings.days):
    con = sqlite3.connect(settings.database)
    user2teams = {}
    teams = {}
    for u in load_users(con):
        user2teams[u["id"]] = u["teams"]

        for team in u["teams"]:
            teams[team] = {
                "name": team,
                "co2e": 0,
                "cost": 0
            }

    activity = []
    _teams = {}
    day = day_ts = None
    for dt_str, ts, users_data, _ in iter_usage(con, days, full_day=True):
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
            co2e = values[3]
            cost = values[4]

            try:
                user_teams = user2teams[user]
            except KeyError:
                continue

            for team in user_teams:
                team_obj = teams[team]
                team_obj["co2e"] += co2e / len(user_teams)
                team_obj["cost"] += cost / len(user_teams)

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


def send_email(login: str, name: str | None, uuid: str, recipient: str):
    content = f"""\
Dear {name or login},

You, or someone posing as you, has requested to receive your UUID for the \
EMBL-EBI LSF carbon footprint monitoring website.

Your UUID is: {uuid}

It allows you to find out your recent activity and carbon footprint.

(This is an automated email)
    """

    msg = EmailMessage()
    msg["Subject"] = "EMBL-EBI LSF carbon footprint: UUID reminder"
    msg["To"] = recipient
    msg["From"] = settings.admin_email[0]
    msg["Date"] = formatdate(localtime=True)
    msg.set_content(content)

    with SMTP(host=settings.smtp_host, port=settings.smtp_port) as server:
        server.send_message(msg)

    if settings.notify_on_signup:
        msg = EmailMessage()
        msg["Subject"] = "EMBL-EBI LSF carbon footprint: UUID requested"
        msg["To"] = settings.admin_email[0]
        msg["From"] = settings.admin_email[0]
        msg["Date"] = formatdate(localtime=True)
        msg.set_content(
            f"""\
Someone asked for a UUID reminder.
Email: {recipient}
Name:  {name or 'N/A'}
            """
        )

        try:
            with SMTP(host=settings.smtp_host,
                      port=settings.smtp_port) as server:
                server.send_message(msg)
        except:
            pass


@app.post("/user/", tags=["Sign up"])
async def sign_up(user: User):
    login = user.email.split("@")[0]
    con = sqlite3.connect(settings.database)
    row = con.execute("SELECT name, uuid FROM user "
                      "WHERE login=?", [login]).fetchone()
    con.close()

    if row is None:
        raise HTTPException(status_code=400, detail={
            "status": "400",
            "title": "Bad Request",
            "detail": f"No user found with e-mail address {user.email}"
        })

    name, uuid = row

    try:
        send_email(login, name, uuid, user.email)
    except:
        raise HTTPException(status_code=500, detail={
            "status": "500",
            "title": "Internal Server Error",
            "detail": f"Could not send email to {user.email}"
        })


@app.get("/user/{uuid}/footprint/", tags=["User footprint"])
async def get_user_footprint(uuid: str, days: int = settings.days):
    con = sqlite3.connect(settings.database)
    user = get_user(con, uuid)
    username = user["login"]

    activity = []
    jobs = submitted = done = failed = co2e = cost = 0
    memdist = [0] * 5
    for dt_str, ts, users_data, _ in iter_usage(con, days):
        try:
            values = users_data[username]
        except KeyError:
            cores = mem = 0
        else:
            jobs += values[0]
            cores = values[1]
            mem = values[2]
            co2e += values[3]
            cost += values[4]
            submitted += values[5]
            done += values[6]
            for i, v in enumerate(values[7]):
                memdist[i] += v
            failed += values[9]

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
async def get_team_activity(uuid: str, team: str, days: int = settings.days):
    con = sqlite3.connect(settings.database)
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
    for dt_str, ts, users_data, _ in iter_usage(con, days, full_day=True):
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

            cores = values[1] / num_teams
            memory = values[2] / num_teams
            co2e = values[3] / num_teams
            cost = values[4] / num_teams

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
            "users": team_users
        }
    }


@app.get("/distribution/cpu/", tags=["CPU"])
async def get_cpu_usage(days: int = settings.days):
    con = sqlite3.connect(settings.database)

    cpu_dist = [0] * 100
    for dt_str, ts, _, jobs_data in iter_usage(con, days):
        for i, v in enumerate(jobs_data[2]):
            cpu_dist[i] += v

    con.close()

    return {
        "data": {
            "dist": cpu_dist,
        },
        "meta": {
            "days": days
        }
    }


@app.get("/distribution/memory/", tags=["Memory"])
async def get_memory_usage(days: int = settings.days):
    con = sqlite3.connect(settings.database)

    co2e = cost = 0
    mem_dist = [0] * 100
    for dt_str, ts, _, jobs_data in iter_usage(con, days):
        for i, v in enumerate(jobs_data[1]):
            mem_dist[i] += v

        co2e += jobs_data[4]
        cost += jobs_data[5]

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
            "days": days
        }
    }


@app.get("/distribution/runtime/", tags=["Runtimes"])
async def get_runtimes(days: int = settings.days):
    con = sqlite3.connect(settings.database)

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
    for dt_str, ts, _, jobs_data in iter_usage(con, days):
        for i, v in enumerate(jobs_data[3]):
            runtimes[i][1] += v

    con.close()

    return {
        "data": {
            "dist": runtimes,
        },
        "meta": {
            "days": days
        }
    }


@app.get("/statuses/", tags=["Statuses"])
async def get_job_statuses(days: int = settings.days):
    con = sqlite3.connect(settings.database)

    done = failed = co2e = cost = 0
    for dt_str, ts, _, jobs_data in iter_usage(con, days):
        done += jobs_data[0]
        failed += jobs_data[6]
        co2e += jobs_data[7]
        cost += jobs_data[8]

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
            "days": days
        }
    }


def get_last_update(con: sqlite3.Connection) -> datetime:
    time, = con.execute("SELECT value FROM metadata "
                        "WHERE key = 'updated'").fetchone()
    return datetime.strptime(time, "%Y-%m-%d %H:%M:%S")


def iter_usage(con: sqlite3.Connection, days: int, full_day: bool = False):
    stop = get_last_update(con)

    sql = "SELECT time, users_data, jobs_data FROM usage"
    dt_fmt = "%Y%m%d%H%M"
    if days > 0:
        start = stop - timedelta(days=days)
        if full_day:
            start = floor2day(start)
        else:
            start = floor2hour(start)

        sql += " WHERE time >= ? AND time <= ?"
        params = [start.strftime(dt_fmt), floor2hour(stop).strftime(dt_fmt)]
    else:
        sql += " WHERE time <= ?"
        params = [floor2hour(stop).strftime(dt_fmt)]

    sql += " ORDER BY time"

    for row in con.execute(sql, params):
        dt_str = row[0]
        ts = floor(datetime.strptime(dt_str, dt_fmt).timestamp()) * 1000
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
