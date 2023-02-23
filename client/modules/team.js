import {Table} from "./table.js";
import {renderCo2Emissions, renderCost, round} from "./utils.js";

async function fetchTeamActivity(apiUrl, uuid, team) {
    const response = await fetch(`${apiUrl}/user/${uuid}/team/${encodeURIComponent(team)}/`);
    return await response.json();
}

async function showTeamFootprint(apiUrl, userId, uuid, team, elemId) {
    const payload = await fetchTeamActivity(apiUrl, uuid, team);

    // Create map of users carbon footprint
    let users = new Map(
        Object
            .entries(payload.meta.users)
            .map(([login, name]) => [login, {id: login, name: name, co2e: 0, cost: 0}])
    );
    let totalEmissions = 0;
    payload.data.footprint.forEach((item) => {
        Object.entries(item.users).forEach(([key, value]) => {
            const user = users.get(key);
            user.co2e += value.co2e;
            user.cost += value.cost;
            users.set(key, user);
            totalEmissions += value.co2e;
        });
    });

    // Transform the map in an array of objects, sorted from the biggest contributor to the least
    users = [...users.values()]
        .sort((a, b) => {
            if (a.id === userId)
                return -1;
            else if (b.id === userId)
                return 1;
            return b.co2e - a.co2e;
        });

    // Display the 10 top contributes, other users are grouped in an "others" series
    const series = users
        .filter((user) => user.id === userId || user.co2e > 0)
        .slice(0, 10)
        .map((user) => ({
            id: user.id,
            name: user.name !== null ? `${user.name} (${user.id})` : user.id,
            data: payload.data.footprint.map((item) => ([item.timestamp, 0])),
        }));
    const others = {
        name: 'Others',
        color: '#607d8b',
        data: payload.data.footprint.map((item) => ([item.timestamp, 0]))
    };

    const indices = series.map((series) => series.id);
    payload.data.footprint.forEach((item, j) => {
        Object.entries(item.users).forEach(([key, value]) => {
            const i = indices.indexOf(key);
            if (i >= 0)
                series[i].data[j][1] = value.co2e / 1e3;
            else
                others.data[j][1] += value.co2e / 1e3;
        });
    });

    Highcharts.chart(document.querySelector(`#${elemId} > div`), {
        chart: {
            type: 'area',
            height: 300,
        },
        xAxis: {
            type: 'datetime',
        },
        yAxis: {
            title: {
                text: 'Kilograms CO<sub>2</sub>-equivalent',
                useHTML: true
            }
        },
        tooltip: {
            shared: true,
            headerFormat: '<span style="font-size:10px">{point.key:%A, %b %d} &ndash; {point.total:,.1f} kg</span><br>',
            pointFormat: '<span style="color:{series.color}">\u25CF</span> {series.name}: <b>{point.y:,.2f} kg</b> ({point.percentage:.2f}%)<br>'
        },
        plotOptions: {
            area: {
                stacking: 'normal',
                marker: {
                    enabled: false
                }
            }
        },
        series: users.length > 10 ? series.concat([others]) : series
    });

    new Table({
        root: document.querySelector(`#${elemId} > table`),
        columns: [
            { data: 'id' },
            {
                data: 'name',
                render: function (value) {
                    return value || '';
                }
            },
            {
                data: 'co2e',
                searchable: false,
                render: (x) => renderCo2Emissions(x) + ' CO<sub>2</sub>e'
            },
            {
                data: 'cost',
                searchable: false,
                render: renderCost
            },
            {
                data: 'co2e',
                searchable: false,
                render: function(value) {
                    const contribution = value / totalEmissions * 100;
                    return contribution >= 0.1 ? contribution.toFixed(2) + '%' : '&lt; 0.1%';
                }
            },
        ],
        data: users,
        orderBy: 0
    });
}

async function showTeamsFootprint(apiUrl) {
    const response = await fetch(`${apiUrl}/footprint/teams/`);
    const payload = await response.json();
    const showTopNTeams = 15;

    const teams = payload.data.teams
        .sort((a, b) => b.co2e - a.co2e);

    let series = [];
    let others = {
        name: 'Others',
        data: [],
        color: '#607d8b'
    };

    teams.forEach((team, i) => {
        if (i < showTopNTeams) {
            series.push({
                name: team.name,
                data: [{
                    x: i,
                    y: team.co2e / 1e6,
                    name: team.name
                }]
            });
        } else {
            if (others.data.length === 0) {
                others.data.push({
                    x: i,
                    y: 0,
                    name: 'Others'
                });
            }
            others.data[0].y += team.co2e / 1e6;
        }
    });

    document.querySelector(`#groups .days`).innerHTML = payload.meta.days;

    Highcharts.chart('teams-main-contrib', {
        chart: {
            type: 'column',
            height: 400
        },
        title: {
            // text: "Main contributors to EMBL-EBI's carbon footprint",
            text: null,
            align: 'left',
        },
        xAxis: {
            type: 'category',
            title: { text: null },
        },
        yAxis: [{
            title: {
                text: 'Tonnes CO<sub>2</sub>-equivalent',
                useHTML: true
            },
        }],
        plotOptions: {
            column: {
                stacking: 'normal'
            }
        },
        tooltip: {
            formatter: function() {
                let value;
                if (this.y > 1)
                    value = `${round(this.y, 2)} t`;
                else
                    value = `${round(this.y * 1000, 0)} kg`;

                return `
                    <span style="font-size: 11px">${this.series.name}</span><br>
                    CO<sub>2</sub>e: <strong>${value}</strong>
                `;
            }
        },
        // series: series.concat(...others)
        series: series.concat([others])
    });

    const mainContributors = payload.data.teams
        .sort((a, b) => b.co2e - a.co2e)
        .slice(0, showTopNTeams)
        .map((a) => a.name);

    series = mainContributors.map((name) => ({
        name: name,
        data: payload.data.activity.map((item) => ([item.timestamp, 0]))
    }));
    others = {
        name: 'Others',
        color: '#607d8b',
        data: payload.data.activity.map((item) => ([item.timestamp, 0]))
    };

    payload.data.activity.forEach((item, j) => {
        Object.entries(item.teams).forEach(([team, co2e]) => {
            const i = mainContributors.indexOf(team);
            if (i >= 0)
                series[i].data[j][1] = co2e / 1e3;
            else
                others.data[j][1] += co2e / 1e3;
        });
    });

    Highcharts.chart('teams-daily', {
        chart: {
            type: 'area',
            height: 300,
            zoomType: 'x'
        },
        xAxis: {
            type: 'datetime',
        },
        yAxis: {
            title: {
                text: 'Kilograms CO<sub>2</sub>-equivalent',
                useHTML: true
            }
        },
        tooltip: {
            shared: true,
            headerFormat: '<span style="font-size:10px">{point.key:%A, %b %d} &ndash; {point.total:,.1f} kg</span><br>',
            pointFormat: '<span style="color:{series.color}">\u25CF</span> {series.name}: <b>{point.y:,.1f} kg</b> ({point.percentage:.1f}%)<br>'
        },
        plotOptions: {
            area: {
                stacking: 'normal',
                //stacking: 'percent',
                marker: {
                    enabled: false
                }
            }
        },
        series: series.concat([others])
    });

    const totalEmissions = payload.data.teams
        .map((a) => a.co2e)
        .reduce((previousValue, currentValue) => previousValue + currentValue);

    const times = [
        // unit, number of seconds, precision
        ['year', 3600 * 24 * 365, 2],
        ['month', 3600 * 24 * 30, 2],
        ['week', 3600 * 24 * 7, 1],
        ['day', 3600 * 24, 1],
        ['hour', 3600, 0],
        ['minute', 60, 0],
    ]
    const pluralize = (x => x >= 2 ? 's' : '');

    new Table({
        root: document.getElementById('teams-table'),
        columns: [
            { data: 'name' },
            // {
            //     data: 'cputime',
            //     searchable: false,
            //     render: function (value) {
            //         for (const [unit, seconds, precision] of times) {
            //             if (value >= seconds) {
            //                 const x = value / seconds;
            //                 return `${round(x, precision)} ${unit}${pluralize(x)}`;
            //             }
            //         }
            //         return `${round(value, 0)} second${pluralize(value)}`;
            //     }
            // },
            {
                data: 'co2e',
                searchable: false,
                render: (x) => renderCo2Emissions(x) + ' CO<sub>2</sub>e'
            },
            {
                data: 'cost',
                searchable: false,
                render: renderCost
            },
            {
                data: 'co2e',
                searchable: false,
                render: function(value) {
                    const contribution = value / totalEmissions * 100;
                    return contribution >= 0.1 ? contribution.toFixed(2) + '%' : '&lt; 0.1%';
                }
            }
        ],
        data: payload.data.teams
    });
}

export {fetchTeamActivity, showTeamFootprint, showTeamsFootprint};
