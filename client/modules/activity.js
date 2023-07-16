import {fetchTeamActivity} from "./team.js";
import {renderCo2Emissions, renderCpuTime, round} from "./utils.js";

function updateOverallChart(categories, data, nSeries) {
    const series = data.slice(0, nSeries);
    const others = {
        name: nSeries > 0 ? 'Others' : 'EMBL-EBI',
        data: new Array(categories.length).fill(0),
        color: '#607d8b',
    };


    data
        .slice(nSeries)
        .forEach((team) => {
            team.data.forEach((v, i) => {
                others.data[i] += v;
            });
        });

    series.push(others);

    Highcharts.chart('overview-chart', {
        chart: {
            type: 'column',
            height: 400
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
        plotOptions: {
            column: {
                stacking: 'normal',
            }
        },
        series: series,
        xAxis: {
            type: 'category',
            categories: categories
        },
        yAxis: {
            title: {
                text: 'Tonnes CO<sub>2</sub>-equivalent',
                useHTML: true
            },
            reversedStacks: true
        },
        legend: { enabled: true },
    });
}

async function showOverallActivity(apiUrl) {
    const response = await fetch(`${apiUrl}/footprint/`);
    const payload = await response.json();

    let teams = new Map();

    payload.data.forEach(({month, footprint}, i, array) => {
        footprint.forEach(({team, jobs, cputime, co2e, cost}) => {
            if (!teams.has(team)) {
                teams.set(team, {
                    name: team,
                    data: new Array(array.length).fill(0),
                    total: 0
                });
            }

            const teamObj = teams.get(team);
            teamObj.data[i] = co2e / 1e6;
            teamObj.total += co2e;
        });
    });

    const categories = payload.data.map(({month}) => month);
    teams = [...teams.values()].sort((a, b) => b.total - a.total);

    const inputRange = document.querySelector('#overview input[type="range"]');
    const nSeries = Number.parseInt(inputRange.value, 0);

    updateOverallChart(categories, teams, nSeries);

    document.querySelector('#overview .months').innerHTML = payload.meta.months;

    inputRange.addEventListener('change', (e,) => {
        updateOverallChart(categories, teams, Number.parseInt(e.currentTarget.value, 10));
    });
}

async function showRecentActivity(apiUrl) {
    const response = await fetch(`${apiUrl}/activity/`);
    const payload = await response.json();

    document.querySelector('#activity .days').innerHTML = payload.meta.days;

    document.querySelector('#activity [data-stat="cpu"]').innerHTML = `
        ${renderCpuTime(payload.data.cputime)}
    `;
    document.querySelector('#activity [data-stat="co2e"]').innerHTML = `
        ${renderCo2Emissions(payload.data.co2e, true)} CO<sub>2</sub>e
    `;
    // https://calculator.carbonfootprint.com/calculator.aspx?tab=3
    const LondonToTokyo = 1410000;  // One way flight
    document.querySelector('#activity [data-stat="flight"]').innerHTML = `
        ${round(payload.data.co2e / LondonToTokyo, 1)} flights
    `;
    // https://www.eea.europa.eu/articles/forests-health-and-climate-change/key-facts/trees-help-tackle-climate-change
    const offsetPerYear = 22000;
    document.querySelector('#activity [data-stat="tree"]').innerHTML = `
        ${round(payload.data.co2e / offsetPerYear, 1)} tree-years
    `;

    const charts = [];
    let zoomedOnChartIndex = null;
    const setExtremes = (event, i) => {
        if (zoomedOnChartIndex !== null && zoomedOnChartIndex !== i)
            return;

        zoomedOnChartIndex = i;
        charts.forEach((chart, j) => {
            if (i !== j) {
                chart.xAxis[0].setExtremes(event.min, event.max);

                const showResetZoom = !(event.userMin === undefined && event.userMax === undefined);

                if (showResetZoom && !chart.resetZoomButton)
                    chart.showResetZoom();
                else if (!showResetZoom && chart.resetZoomButton)
                    chart.resetZoomButton = chart.resetZoomButton.destroy();
            }
        });

        zoomedOnChartIndex = null;
    };

    ['jobs', 'cores', 'memory'].forEach((dataType, i) => {
        let labels = [];
        if (payload.data.events[dataType] !== undefined) {
            labels = payload.data.events[dataType].map((event) => ({
                point: {
                    xAxis: 0,
                    yAxis: 0,
                    x: event.x,
                    y: dataType === 'cores' ? event.y : event.y / 1024
                },
                text: event.text
            }));
        }
        let getY;
        let tooltipSuffix = undefined;
        let title = undefined;
        let yAxisTitle = undefined;
        switch (dataType) {
            case 'jobs':
                getY = (x => x.jobs.submitted);
                title = 'Submitted jobs';
                yAxisTitle = 'Jobs';
                break
            case 'memory':
                getY = (x => round(x.memory / 1024, 3))
                tooltipSuffix = ' TB';
                title = 'Memory';
                yAxisTitle = 'Memory (TB)';
                break
            default:
                getY = (x => x[dataType]);
                title = 'Cores';
                yAxisTitle = 'Cores';
        }

        const chart = Highcharts.chart(`${dataType}-activity`, {
            chart: {
                type: 'area',
                height: 225,
                marginLeft: 100,
                zoomType: 'x'
            },
            title: {
                text: title,
                align: 'left',
                margin: 0,
                x: 30
            },
            plotOptions: {
                series: {
                    fillOpacity: 0.25,
                }
            },
            annotations: [{
                draggable: '',
                labelOptions: {
                    shape: 'connector',
                    align: 'right',
                    justify: false,
                    crop: true,
                    style: {
                        fontSize: '0.8em',
                        textOutline: '1px white'
                    }
                },
                labels: labels
            }],
            series: [{
                name: 'Total',
                color: '#a6cee3',
                data: payload.data.activity.map((x) => {
                    return [x.timestamp, getY(x)];
                }),
            }],
            tooltip: {
                positioner: function () {
                    return {
                        x: this.chart.chartWidth - this.label.width - 10,
                        y: -10
                    };
                },
                borderWidth: 0,
                backgroundColor: 'none',
                pointFormat: '{point.y}',
                headerFormat: '<span style="font-size: 10px">{point.key}</span><br/>',
                xDateFormat: '%A, %b %d, %H:%M',
                shadow: false,
                style: {
                    fontSize: '14px'
                },
                valueDecimals: 0,
                valueSuffix: tooltipSuffix
            },
            xAxis: {
                type: 'datetime',
                crosshair: true,
                events: {
                    afterSetExtremes: function (event) {
                        setExtremes(event, i);
                    }
                }
            },
            yAxis: [{
                title: {
                    text: yAxisTitle
                },
            }],
        });

        chart.pointer.reset = function () {
            return undefined;
        }

        charts.push(chart);
    });

    ['mousemove', 'touchmove', 'touchstart'].forEach((eventType) => {
        document.getElementById('activity-charts').addEventListener(eventType, (event) => {
            charts.forEach((chart) => {
                // Find coordinates within the chart
                const coordinates = chart.pointer.normalize(event);

                // Get the hovered point
                const point = chart.series[0].searchPoint(coordinates, true);

                if (point) {
                    // Highlight point
                    point.onMouseOver(); // Show the hover marker
                    //point.series.chart.tooltip.refresh(this); // Show the tooltip
                    point.series.chart.xAxis[0].drawCrosshair(coordinates, point); // Show the crosshair
                }
            });
        });
    });

    window.showTeamActivity = (uuid, team) => {
        if (charts[0].series.length > 1) {
            charts[0].series[1].remove();
            charts[1].series[1].remove();
        }

        if (team === null)
            return;

        fetchTeamActivity(apiUrl, uuid, team)
            .then((payload) => {
                const coresData = [];
                const memData = [];
                payload.data.activity.forEach((value) => {
                    coresData.push([value.timestamp, value.cores]);
                    memData.push([value.timestamp, round(value.memory / 1024, 3)]);
                });

                charts[1].addSeries({
                    data: coresData,
                    color: '#f44336'
                });
                charts[2].addSeries({
                    data: memData,
                    color: '#f44336'
                });
            });
    };
}

export {showOverallActivity, showRecentActivity};