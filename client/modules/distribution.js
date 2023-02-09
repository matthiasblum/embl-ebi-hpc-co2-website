import {renderCo2Emissions, renderCost, round} from "./utils.js";

function plotMemoryDist(data, inMillions, elem) {
    Highcharts.chart(elem, {
        chart: {
            type: 'column',
            height: 300
        },
        xAxis: {
            title: { text: 'Memory efficiency (%)' },
            type: 'category',
            labels: { step: 5 }
        },
        yAxis: {
            title: { text: 'Jobs' },
            labels: {
                formatter: function () {
                    if (this.value === 0)
                        return 0;
                    else if (inMillions)
                        return round(this.value / 1e6, 1) + 'M';
                    else
                        return this.value;
                }
            }
        },
        plotOptions: {
            column: {
                pointPadding: 0.1,
                borderWidth: 0,
                groupPadding: 0,
                shadow: false,
                cursor: 'pointer',
                stacking: 'normal',
            }
        },
        tooltip: {
            shared: true,
            formatter: function () {
                return `
                    <span style="font-size: 11px">Memory efficiency: ${this.x}-${this.x+1}%</span><br>
                    <b>${this.points[0].y.toLocaleString()}</b> jobs                    
                `;
            },
        },
        series: [{
            color: '#0074e8',
            data: data
        }]
    });
}

async function showMemoryDist(apiUrl) {
    const response = await fetch(`${apiUrl}/distribution/memory/`);
    const payload = await response.json();

    document.querySelector('#memory .count').innerHTML = payload.data.dist
        .reduce((accumulator, currentValue) => accumulator + currentValue)
        .toLocaleString();
    document.querySelector('#memory .days').innerHTML = payload.meta.days;
    document.querySelector('#memory .co2-wasted').innerHTML = `${renderCo2Emissions(payload.data.wasted.co2e)} less CO<sub>2</sub>e`;
    document.querySelector('#memory .cost-wasted').innerHTML = renderCost(payload.data.wasted.cost);

    plotMemoryDist(payload.data.dist, true, document.getElementById('memdist-chart'));
}

async function showCPUDist(apiUrl) {
    const response = await fetch(`${apiUrl}/distribution/cpu/`);
    const payload = await response.json();

    document.querySelector('#cpu .days').innerHTML = payload.meta.days;

    Highcharts.chart('cpudist-chart', {
        chart: {
            type: 'column',
            height: 300
        },
        xAxis: {
            title: { text: 'CPU efficiency (%)' },
            type: 'category',
            labels: { step: 5 }
        },
        yAxis: {
            title: { text: 'Jobs' },
            labels: {
                formatter: function () {
                    if (this.value === 0)
                        return 0;
                    return round(this.value / 1e6, 1) + 'M';
                }
            }
        },
        plotOptions: {
            column: {
                pointPadding: 0.1,
                borderWidth: 0,
                groupPadding: 0,
                shadow: false,
                cursor: 'pointer',
                stacking: 'normal',
            }
        },
        tooltip: {
            shared: true,
            formatter: function () {
                return `
                    <span style="font-size: 11px">CPU efficiency: ${this.x}-${this.x+1}%</span><br>
                    <b>${this.points[0].y.toLocaleString()}</b> jobs                    
                `;
            },
        },
        series: [{
            color: '#0074e8',
            data: payload.data.dist
        }]
    });
}

async function showRuntimes(apiUrl) {
    const response = await fetch(`${apiUrl}/distribution/runtime/`);
    const payload = await response.json();

    document.querySelector('#runtime .days').innerHTML = payload.meta.days;
    Highcharts.chart('runtimes-chart', {
        chart: { type: 'column', },
        xAxis: {
            title: { text: 'Runtime' },
            type: 'category',
        },
        yAxis: [{
            title: { text: 'Jobs' },
            labels: {
                formatter: function () {
                    if (this.value === 0)
                        return 0;
                    return round(this.value / 1e6, 1) + 'M';
                }
            }
        }],
        tooltip: {
            shared: true,
            headerFormat: 'Runtime: {point.key}<br>',
            pointFormat: '<b>{point.y}</b> jobs<br>'
        },
        series: [{
            color: '#0074e8',
            data: payload.data.dist
        }]
    });
}

export {plotMemoryDist, showCPUDist, showMemoryDist, showRuntimes};