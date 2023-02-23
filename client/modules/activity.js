import {fetchTeamActivity} from "./team.js";
import {round} from "./utils.js";

async function showOverallActivity(apiUrl) {
    const response = await fetch(`${apiUrl}/activity/`);
    const payload = await response.json();

    document.querySelector('#activity .days').innerHTML = payload.meta.days;

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

                charts[0].addSeries({
                    data: coresData,
                    color: '#f44336'
                });
                charts[1].addSeries({
                    data: memData,
                    color: '#f44336'
                });
            });
    };
}

export {showOverallActivity};