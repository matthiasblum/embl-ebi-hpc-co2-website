import {plotMemoryDist} from "./distribution.js";
import {SIGN_IN_KEY} from "./settings.js";
import {showTeamFootprint} from "./team.js";
import {renderCo2Emissions, renderCost, round, resetScrollspy} from "./utils.js";

let MODAL = null;
let SELECT_IS_INIT = false;
let OBSERVER = null;

function observerCallback(mutationList, observer) {
    for (const mutation of mutationList) {
        if (mutation.type === 'attributes') {
            // `mutation.attributeName` was modified
        }
    }
}

function startObserver() {
    stopObserver();

    if (OBSERVER === null) {
        OBSERVER = new MutationObserver(observerCallback);
    }

    document
        .querySelectorAll('#toc-wrapper ul ul li a')
        .forEach((target) => {
            OBSERVER.observe(target, { attributes: true });
        });
}

function stopObserver() {
    if (OBSERVER === null)
        return;

    OBSERVER.disconnect();
}

function signOut() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('uuid')) {
        [sessionStorage, localStorage].forEach((storage) => {
            storage.removeItem(SIGN_IN_KEY);
        });
    }

    document.getElementById('uuid').className = '';
    document.querySelector('#details > form').style.display = null;
    document.getElementById('user-details').style.display = 'none';
    document.querySelector('#toc-wrapper ul ul').style.display = 'none';
}

async function signIn(apiUrl, uuid) {
    const response = await fetch(`${apiUrl}/user/${uuid}/`);
    const payload = await response.json();
    if (response.ok)
        return payload.meta;

    const error = payload.detail;
    let errorMessage;
    if (typeof error === 'object')
        errorMessage = `${error.status} ${error.title}. ${error.detail}.`;
    else
        errorMessage = 'An unexpected error occurred.';
    throw new Error(errorMessage);
}

async function signUp(apiUrl, email) {
    const response = await fetch(`${apiUrl}/user/`, {
        method: 'POST',
        body: JSON.stringify({email: email}),
        headers: {
            'Content-Type': 'application/json'
        },
    });
    const payload = await response.json();
    return {ok: response.ok, payload: payload};
}

function switchSignForm(apiUrl) {
    if (MODAL === null) {
        const elem = document.getElementById('sign-up');
        MODAL = M.Modal.init(elem);

        elem.querySelector('form')
            .addEventListener('submit', (event) => {
                event.preventDefault();
                const input = event.target.querySelector('input');
                const helperText = input.parentNode.querySelector('.helper-text');

                const email = input.value.trim();
                if (!email.toLowerCase().match(/^[a-z0-9\-_]+@ebi.ac.uk$/)){
                    input.className = 'invalid validate';
                    helperText.dataset.error = 'Not an EMBL-EBI email address.'
                    return;
                }

                input.className = 'validate';
                helperText.innerHTML = 'Sending an email, hang tight...'

                signUp(apiUrl, email)
                    .then(({ok, payload}) => {
                        if (!ok) {
                            const error = payload.detail;
                            input.className = 'invalid validate';
                            helperText.dataset.error = `${error.status} ${error.title}. ${error.detail}.`;
                            return;
                        }

                        let sentTo = payload.meta.email;
                        let timeout = 10000;

                        if (payload.meta.sponsor) {
                            timeout = 20000;
                            MODAL.el.querySelector('.card-panel-wrapper').innerHTML = `
                                <div class="card-panel warning">
                                    <p>
                                        ${email} is a virtual account, and it's unlikely that you have access to its emails.
                                        The UUID has been sent to its sponsor.
                                    </p>
                                </div>                            
                            `;
                        }

                        MODAL.el.querySelector('button[type="submit"]').disabled = true;
                        input.className = 'valid validate';
                        const delay = 1000;
                        let intervalId = setInterval(() => {
                            helperText.dataset.success = `An email has been sent to ${sentTo}. This pop-up will close in ${Math.floor(timeout/1000)} seconds.`;
                            if (timeout === 0) {
                                clearInterval(intervalId);
                                MODAL.close();
                            }
                            timeout -= delay;
                        }, delay);
                    })
            });
    }
    MODAL.el.querySelector('button[type="submit"]').disabled = false;
    MODAL.el.querySelector('.card-panel-wrapper').innerHTML = '';
    const input = MODAL.el.querySelector('input');
    input.className = 'validate';
    input.value = null;
    MODAL.open();
}

async function getUserReport(apiUrl, uuid, month) {
    const response = await fetch(`${apiUrl}/user/${uuid}/report/${month}/`);
    const payload = await response.json();

    const targetDiv = document.getElementById('user-report');
    let suffix = 'th';
    let i = payload.data.rank % 10;
    let j = payload.data.rank % 100;
    if (i === 1 && j !== 11)
        suffix = 'st';
    else if (i === 2 && j !== 12)
        suffix = 'nd';
    else if (i === 3 && j !== 13)
        suffix = 'rd';

    let tbody = payload.data.teams
        .map(({name, co2e, cost, users}) => {
            let contribution = co2e * 100 / payload.data.totalCo2e;
            contribution = contribution >= 0.1 ? contribution.toFixed(2) + '%' : '&lt; 0.1%';

            let content = `
                <tr>
                    <td>${name}</td>
                    <td>${renderCo2Emissions(co2e)} CO<sub>2</sub>e</td>
                    <td>${renderCost(cost)}</td>
                    <td>${contribution}</td>
                </tr>
            `;

            if (users.length !== 0) {
                const tbody = users
                    .map(({id, name, co2e, cost, success}) => `
                        <tr>
                            <td>${name || id}</td>
                            <td>${renderCo2Emissions(co2e)} CO<sub>2</sub>e</td>
                            <td>${renderCost(cost)}</td>
                            <td>${round(success, 1)}%</td>
                        </tr>
                    `)
                    .join('');

                content += `
                    <tr>
                        <td class="details" colspan="4">
                            <span>
                                There ${users.length > 1 ? 'are' : 'is'} ${users.length} member${users.length > 1 ? 's' : ''} 
                                of this group with a significant carbon footprint:
                            </span>
                            <table class="celled">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Carbon footprint</th>
                                        <th>Cost</th>
                                        <th>Success rate</th>
                                    </tr>
                                </thead>
                                <tbody>${tbody}</tbody>
                            </table>
                        </td>
                    </tr>
                `;
            }

            return content;
        })
        .join('');

    if (tbody.length === 0) {
        tbody = '<tr><td colspan="4">No data</td></tr>'
    }

    let contribution = payload.data.co2e / payload.data.totalCo2e * 100;
    if (contribution < 0.01)
        contribution = '&lt; 0.01';
    else
        contribution = round(contribution, 2);

    targetDiv.innerHTML = `
        <p>
            In ${payload.meta.month}, your ${payload.data.jobs.total.toLocaleString()} 
            jobs emmited <b>${renderCo2Emissions(payload.data.co2e)} of CO<sub>2</sub></b> 
            for an estimated cost of <b>${renderCost(payload.data.cost)}</b>.
            You ranked <b>${payload.data.rank}${suffix}</b> among all users and 
            you are responsible for <b>${contribution}%</b> of the overall carbon footprint.
        </p>
        <h6>Memory efficiency</h6>
        <p>Only jobs with a memory request of at least 4GB were considered.</p>
        <div class="memory"></div>
        <h6>Groups</h6>
        <p>The footprint of the groups you belong to is displayed in the table below.</p>
        <table>
            <thead>
                <tr>
                    <th>Group</th>
                    <th>Carbon footprint</th>
                    <th>Cost</th>
                    <th>
                        Contribution
                        <i class="fa-solid fa-circle-question"
                           data-position="top"
                           data-tooltip="Contribution to the overall EMBL-EBI footprint"></i>
                    </th>
                </tr>
            </thead>
            <tbody>${tbody}</tbody>
        </table>        
    `;

    plotMemoryDist(payload.data.memory, false, targetDiv.querySelector('.memory'));

    targetDiv.style.display = null;
    M.Tooltip.init(targetDiv.querySelector('.fa-circle-question'), {});
}

async function initUser(apiUrl, uuid, user, month) {
    document.querySelector('#user-info img').src = user.photoUrl || 'https://content.embl.org/sites/default/files/default_images/vf-icon--avatar.png';

    if (user.name !== null)
        document.querySelector('#user-info h6').innerHTML = `${user.name} (${user.login})`;
    else
        document.querySelector('#user-info h6').innerHTML = user.login;

    if (user.position !== null) {
        const block = document.querySelector('#user-info [data-info="position"]');
        block.innerHTML = user.position;
        block.style.display = null;
    } else
        document.querySelector('#user-info [data-info="position"]').style.display = 'none';

    const promises = [
        getUserActivity(apiUrl, uuid)
    ];

    if (user.reports.length > 0) {
        document.getElementById('select-report').innerHTML = user.reports
            .map(([reportId, reportDate], index) => {
                if (index === 0) {
                    return `
                        <option value="" disabled selected>Select a monthly report</option>
                        <option value="${reportId}">${reportDate}</option>
                    `;
                } else
                    return `<option value="${reportId}">${reportDate}</option>`;
            })
            .join('');
    } else
        document.getElementById('select-report').innerHTML = '<option value="" disabled selected>No report available</option>'

    const userTeams = document.getElementById('user-groups');
    const tabs = userTeams.querySelector('.tabs');
    if (tabs !== null) {
        const instance = M.Tabs.getInstance(tabs)
        if (instance !== null) {
            instance.destroy();
        }
    }

    if (user.teams.length > 0) {
        let listItems = '';
        let tabItems = '';
        user.teams.forEach((team) => {
            const teamId = team.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
            listItems += `<li class="tab col l3"><a href="#${teamId}">${team}</a></li>`;
            tabItems += `
                <div id="${teamId}" class="col l12">
                    <h6>Daily carbon footprint</h6>
                    <div></div>
                    <h6>Members</h6>
                    <table>
                        <thead>
                            <tr>
                                <th>Login</th>
                                <th>Name</th>
                                <th>Carbon footprint</th>
                                <th>Cost</th>
                                <th>
                                    Contribution
                                    <i class="fa-solid fa-circle-question"
                                       data-position="top"
                                       data-tooltip="Contribution to the group's footprint"></i>
                                </th>
                            </tr>                        
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            `;
            promises.push(showTeamFootprint(apiUrl, user.login, uuid, team, teamId));
        });

        userTeams.innerHTML = `
            <h5>Groups</h5>
            <div class="row">
                <div class="col l12">
                    <ul class="tabs">
                        ${listItems}
                    </ul>
                </div>
                ${tabItems}            
            </div>
        `;
    } else
        userTeams.innerHTML = '';

    if (!SELECT_IS_INIT) {
        SELECT_IS_INIT = true;
        document
            .getElementById('select-report')
            .addEventListener('change', (event) => {
                const reportId = event.currentTarget.value;
                if (reportId.length !== 0) {
                    getUserReport(apiUrl, uuid, reportId);
                }
            });
    }

    await Promise.all(promises);

    document.querySelector('#details > form').style.display = 'none';
    document.getElementById('user-details').style.display = null;
    document.getElementById('user-report').style.display = 'none';
    document.querySelector('#toc-wrapper a[href="#details"] + ul').style.display = null;
    // startObserver();
    M.Tabs.init(userTeams.querySelector('.tabs'));
    M.Tooltip.init(userTeams.querySelectorAll('.fa-circle-question'), {});
    resetScrollspy();

    if (month !== null && month !== undefined) {
        getUserReport(apiUrl, uuid, month);
        document.getElementById('select-report').value = month;
        document.querySelector('a[href="#user-reports"]').click();
    }
}

async function getUserActivity(apiUrl, uuid) {
    const response = await fetch(`${apiUrl}/user/${uuid}/footprint/`);
    const payload = await response.json();

    document.querySelector('#user-info [data-info="footprint"]').innerHTML = `
        <span>
            Past ${payload.meta.days} days:
            ${payload.data.jobs.toLocaleString()} jobs &ndash;
            ${renderCo2Emissions(payload.data.co2e)} CO<sub>2</sub>e &ndash;
            ${renderCost(payload.data.cost)}
        </span>    
    `;

    let divisor = 1;
    let suffix = 'GB';
    const activity = payload.data.activity;
    if (Math.max(...activity.map((x) => x.memory)) >= 1024) {
        divisor = 1024;
        suffix = 'TB';
    }

    Highcharts.chart(document.querySelector('#user-activity > div'), {
        chart: {
            type: 'area',
            height: 300,
            zoomType: 'x'
        },
        plotOptions: {
            series: {
                fillOpacity: 0.25,
            }
        },
        series: [{
            name: 'Cores',
            color: '#34495E',
            data: activity.map((x) => ([x.timestamp, x.cores])),
        }, {
            name: 'Memory',
            color: '#3498DB',
            data: activity.map((x) => ([x.timestamp, x.memory/divisor])),
            yAxis: 1,
        }],
        tooltip: {
            shared: true,
            pointFormatter: function() {
                let value;
                if (this.series.name === 'Cores')
                    value = this.y.toLocaleString();
                else if (suffix === 'GB')
                    value =  round(this.y, 1).toLocaleString() + ' GB';
                else if (this.y < 1)
                    value =  round(this.y * 1024, 4).toLocaleString() + ' GB';
                else
                    value =  round(this.y, 3).toLocaleString() + ' TB';

                return `<span style="color:${this.color}">\u25CF</span> ${this.series.name}: <b>${value}</b><br>`;
            }
        },
        xAxis: {
            type: 'datetime',
        },
        yAxis: [{
            title: {
                text: 'Cores',
                style: {
                    color: '#34495E'
                }
            },
            labels: {
                style: {
                    color: '#34495E'
                }
            },
        }, {
            title: {
                text: `Memory (${suffix})`,
                style: {
                    color: '#3498DB'
                }
            },
            labels: {
                style: {
                    color: '#3498DB'
                }
            },
            gridLineWidth: 0,
            opposite: true
        }],
        legend: { enabled: true },
    });

    Highcharts.chart(document.querySelector('#user-memory > div'), {
        chart: { type: 'column',},
        // title: {
        //     text: `Memory efficiency of jobs successfully completed in the past ${payload.meta.days} days`,
        //     align: 'left'
        // },
        series: [{
            name: 'Jobs',
            data: [{
                name: '0-20%',
                y: payload.data.memory[0],
                color: '#f44336'
            }, {
                name: '20-40%',
                y: payload.data.memory[1],
                color: '#ff9800'
            }, {
                name: '40-60%',
                y: payload.data.memory[2],
                color: '#cddc39'
            }, {
                name: '60-80%',
                y: payload.data.memory[3],
                color: '#8bc34a'
            },{
                name: '80-100%',
                y: payload.data.memory[4],
                color: '#4caf50'
            }]
        }],
        tooltip: {
            shared: true,
        },
        xAxis: {
            type: 'category',
        },
        yAxis: [{
            title: {
                text: 'Jobs'
            },
        }],
    });

    Highcharts.chart(document.querySelector('#user-status > div'), {
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
                y: payload.data.done
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

export {signIn, signOut, switchSignForm, initUser};
