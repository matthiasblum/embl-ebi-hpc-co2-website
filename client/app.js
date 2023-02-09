import {showOverallActivity} from "./modules/activity.js";
import {
    showCPUDist,
    showRuntimes,
    showMemoryDist
} from "./modules/distribution.js";
import {API_URL, SIGN_IN_KEY} from "./modules/settings.js";
import {showTeamsFootprint} from "./modules/team.js";
import {switchSignForm, signIn, initUser, signOut} from "./modules/user.js";
import {renderCost, renderCo2Emissions, resetScrollspy} from "./modules/utils.js";

Highcharts.setOptions({
    chart: {
        height: 350,
        style: {
            fontFamily: "'IPM Plex Sans', sans-serif",
            fontSize: '14px'
        }
    },
    lang: { thousandsSep: ',' },
    legend: { enabled: false },
    credits: { enabled: false },
    title: { text: null },
    subtitle: { text: null },
    accessibility: { enabled: false }
});

document.addEventListener('DOMContentLoaded', () => {
    testApi(API_URL)
        .then(({email, slack, updated}) => {
            initApp(API_URL, updated, email, slack);
        })
        .catch((error) => {
            const elem = document.querySelector('#loader .col');
            elem.className = elem.className.split(/\s+/).filter((cls) => cls !== 'center').join(' ');
            elem.innerHTML = `
                <div class="card-panel alert">
                    <h5>Service temporarily unavailable</h5>
                    <p>
                        The REST API could not be reached. Please try again later, and if the problem persists, contact us.
                    </p>
                </div>
            `;
        });
});

async function testApi(url) {
    const response = await fetch(url);
    if (response.ok) {
        const payload = await response.json();
        if (payload?.meta?.updated !== undefined) {
            return payload.meta;
        }
    }

    throw new Error();
}

async function initApp(apiUrl, lastUpdated, contactEmail, contactSlack) {
    document.getElementById('last-updated').innerHTML = lastUpdated;
    document.getElementById('openapi').href = `${apiUrl}/docs/`;
    document.getElementById('openapi').innerHTML = `${apiUrl.split('//')[1]}/docs`;

    const promises = [
        showOverallActivity(apiUrl),
        showTeamsFootprint(apiUrl),
        showMemoryDist(apiUrl),
        showCPUDist(apiUrl),
        showRuntimes(apiUrl),
        plotJobStatuses(apiUrl),
    ];

    document.getElementById('contact-email').href = `mailto:${contactEmail}`;
    if (contactSlack !== null) {
        document.getElementById('contact-slack').innerHTML = ` or on <a href="${contactSlack}">Slack</a>`;
    }

    await Promise.all(promises);
    document.getElementById('loader').style.display = 'none';
    resetScrollspy();
    M.Pushpin.init(document.getElementById('toc-wrapper'), {
        top: 150,
        offset: 0
    });

    document.querySelector('#details > form')
        .addEventListener('submit', (event) => {
            event.preventDefault();
            const form = event.target;
            const input = document.getElementById('uuid');
            const uuid = input.value.trim();
            const rememberMe = form.querySelector('input[type="checkbox"]').checked;

            signIn(apiUrl, uuid)
                .then((user) => {
                    input.className = '';
                    sessionStorage.setItem(SIGN_IN_KEY, uuid);
                    input.value = null;

                    if (rememberMe)
                        localStorage.setItem(SIGN_IN_KEY, uuid);
                    else
                        localStorage.removeItem(SIGN_IN_KEY);

                    input.className = 'valid';
                    input.parentNode.querySelector('.helper-text').dataset.success = 'Getting your data. Hang tight...';

                    initUser(apiUrl, uuid, user);
                })
                .catch((error) => {
                    input.className = 'invalid';
                    input.parentNode.querySelector('.helper-text').dataset.error = error.message;
                });
        });

    document.querySelector('a[data-action="sign-up"]')
        .addEventListener('click', (event) => {
            event.preventDefault();
            switchSignForm(apiUrl);
        });

    const uuid = localStorage.getItem(SIGN_IN_KEY) || sessionStorage.getItem(SIGN_IN_KEY);
    if (uuid !== null) {
        if (/^[a-z0-9]+$/.test(uuid)) {
            signIn(apiUrl, uuid)
                .then((user) => {
                    initUser(apiUrl, uuid, user);
                });
        } else {
            // Legacy stored data (JSON): force sign out
            signOut();
        }
    }

    document.getElementById('sign-out')
        .addEventListener('click', (event) => {
            signOut();
        });
}

async function plotJobStatuses(apiUrl) {
    const response = await fetch(`${apiUrl}/statuses/`);
    const payload = await response.json();

    document.querySelector('#status .count').innerHTML = (payload.data.jobs.done + payload.data.jobs.exit).toLocaleString();
    document.querySelector('#status .days').innerHTML = payload.meta.days;
    document.querySelector('#status .co2-wasted').innerHTML = `${renderCo2Emissions(payload.data.wasted.co2e)} CO<sub>2</sub>e`;
    document.querySelector('#status .cost-wasted').innerHTML = renderCost(payload.data.wasted.cost);

    Highcharts.chart('status-chart', {
        chart: {
            plotBackgroundColor: null,
            plotBorderWidth: 0,
            plotShadow: false
        },
        tooltip: {
            headerFormat: '',
            pointFormat: '<span style="color:{point.color}">\u25CF</span> <b> {point.name}</b><br/>' +
                'Jobs: <b>{point.y} ({point.percentage:.1f}%)</b>'
        },
        plotOptions: {
            pie: {
                startAngle: -90,
                endAngle: 90,
                center: ['50%', '75%'],
                size: '110%'
            }
        },
        series: [{
            type: 'pie',
            name: 'Jobs',
            innerSize: '50%',
            data: [{
                name: 'Done',
                y: payload.data.jobs.done,
                color: '#4caf50',
            }, {
                name: 'Failed',
                y: payload.data.jobs.exit,
                color: '#f44336',
            }/*, {
                name: 'Others',
                y: payload.data.jobs.total - payload.data.jobs.done - payload.data.jobs.exit,
                color: '#9e9e9e',
            }*/]
        }]
    });
}