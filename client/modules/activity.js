import {fetchTeamActivity} from "./team.js";
import {round} from "./utils.js";

async function showOverallActivity(apiUrl) {
    const response = await fetch(`${apiUrl}/activity/`);
    const payload = await response.json();

    document.querySelector('#activity .days').innerHTML = payload.meta.days;

    const charts = [];
    let zoomedOnChartIndex = null;
    const setExtremes = (event, index) => {
        if (zoomedOnChartIndex !== null && zoomedOnChartIndex !== index)
            return;

        zoomedOnChartIndex = index;
        const chart = index === 0 ? charts[1] : charts[0];

        chart.xAxis[0].setExtremes(event.min, event.max);

        const showResetZoom = !(event.userMin === undefined && event.userMax === undefined);

        if (showResetZoom && !chart.resetZoomButton)
            chart.showResetZoom();
        else if (!showResetZoom && chart.resetZoomButton)
            chart.resetZoomButton = chart.resetZoomButton.destroy();

        zoomedOnChartIndex = null;
    };

    ['cores', 'memory'].forEach((dataType, i) => {
        const labels = payload.data.events[dataType].map((event) => ({
            point: {
                xAxis: 0,
                yAxis: 0,
                x: event.x,
                y: dataType === 'cores' ? event.y : event.y / 1024
            },
            text: event.text
        }));

        const chart = Highcharts.chart(`${dataType}-activity`, {
            chart: {
                type: 'area',
                height: 300,
                marginLeft: 100,
                zoomType: 'x'
            },
            title: {
                text: dataType.charAt(0).toUpperCase() + dataType.slice(1),
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
                    if (dataType === 'cores')
                        return [x.timestamp, x[dataType]];
                    return [x.timestamp, round(x[dataType] / 1024, 3)]
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
                valueSuffix: dataType === 'cores' ? undefined : ' TB'
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
                    text: dataType === 'cores' ? 'Cores' : 'Memory (TB)'
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