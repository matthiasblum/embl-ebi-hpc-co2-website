import {showOverallActivity, showRecentActivity} from "./modules/activity.js";
import {
    showCPUDist,
    showRuntimes,
    showMemoryDist
} from "./modules/distribution.js";
import {API_URL, SIGN_IN_KEY} from "./modules/settings.js";
import {showTeamsFootprint} from "./modules/team.js";
import {switchSignForm, signIn, initUser, signOut} from "./modules/user.js";
import {
    renderCost,
    renderCo2Emissions,
    resetScrollspy
} from "./modules/utils.js";

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
        showRecentActivity(apiUrl),
        showTeamsFootprint(apiUrl),
        showMemoryDist(apiUrl),
        showCPUDist(apiUrl),
        showRuntimes(apiUrl),
        plotJobStatuses(apiUrl),
    ];

    document.getElementById('contact-email').href = `mailto:${contactEmail}`;
    if (contactSlack !== null || 1) {
        document.getElementById('contact-slack').innerHTML = ` 
            or on <a href="${contactSlack}"><i class="fa-brands fa-slack"></i> Slack</a>
        `;
    }

    await Promise.all(promises);
    document.getElementById('loader').style.display = 'none';
    resetScrollspy();
    M.Pushpin.init(document.getElementById('toc-wrapper'), {
        top: 150,
        offset: 0
    });
    M.Tooltip.init(document.querySelectorAll('.fa-circle-question'), {});

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

    const params = new URLSearchParams(window.location.search);
    const uuid = params.get('uuid') || localStorage.getItem(SIGN_IN_KEY) || sessionStorage.getItem(SIGN_IN_KEY);
    if (uuid !== null) {
        if (/^[a-z0-9]+$/.test(uuid)) {
            signIn(apiUrl, uuid)
                .then((user) => {
                    initUser(apiUrl, uuid, user, params.get('report'));
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
    document.querySelector('#status .count').innerHTML = (payload.data.done.total + payload.data.exit.total).toLocaleString();
    document.querySelector('#status .days').innerHTML = payload.meta.days;

    const wastedCo2Pc = payload.data.exit.co2e * 100 / (payload.data.done.co2e + payload.data.exit.co2e);
    const more1hPc = payload.data.exit.more1h * 100 / payload.data.exit.total;
    const more1hCo2ePc = payload.data.exit.more1hCo2e * 100 / (payload.data.done.co2e + payload.data.exit.co2e);
    document.querySelector('#status-info').innerHTML = `
        Failed jobs represent ${renderCo2Emissions(payload.data.exit.co2e)} of CO<sub>2</sub>e and a cost of ${renderCost(payload.data.exit.cost)}. 
        They are responsible for ${wastedCo2Pc.toFixed(1)}% of the overall carbon footprint.<br>
        ${more1hPc.toFixed(1)}% of failed jobs ran for at least an hour before failing, and are 
        reponsible for ${more1hCo2ePc.toFixed(1)}% of the overall carbon footprint.
    `;

    Highcharts.chart('status-chart', {
        chart: {
            height: 250,
            margin: [-75, 0, -20, 0],
            plotBackgroundColor: null,
            plotBorderWidth: 0,
            plotShadow: false,
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
                center: ['50%', '90%'],
                size: '100%'
            }
        },
        series: [{
            type: 'pie',
            name: 'Jobs',
            innerSize: '50%',
            data: [{
                name: 'Done',
                color: '#2ECC71',
                y: payload.data.done.total,
            }, {
                name: 'Failed (mem. limit)',
                color: '#E74C3C',
                y: payload.data.exit.memlim
            }, {
                name: 'Failed (other)',
                color: '#C0392B',
                y: payload.data.exit.total - payload.data.exit.memlim
            }]
        }]
    });
}