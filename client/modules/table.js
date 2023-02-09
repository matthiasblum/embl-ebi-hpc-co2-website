import {getValue} from "./utils.js";

export function Table({root, columns, data, orderBy, orderDir}) {
    this.root = root;
    this.columns = columns.map((col) => ({
        data: col.data,
        searchable: getValue(col.searchable, true),
        orderable: getValue(col.orderable, true),
        render: getValue(col.render, ((a) => a))
    }));
    this.rawData = JSON.parse(JSON.stringify(data));
    this.data = this.rawData;
    this.orderBy = getValue(orderBy, 0);
    this.orderDir = getValue(orderDir, 'asc');
    this.page = 1;
    this.pageSize = 10;
    this.searchQuery = null;
    this.pagination = null;

    this.search = function() {
        if (this.searchQuery === null) {
            this.data = this.rawData;
            return this;
        }

        const query = this.searchQuery.toLowerCase();
        const columns = this.columns.filter((col) => col.searchable === true).map((col) => col.data);
        this.data = this.rawData.filter((item) => {
            for (const key of columns) {
                if (item[key] && item[key].toLowerCase().includes(query))
                    return true;
            }
            return false;
        });

        return this;
    }
    this.sort = function () {
        const self = this;
        this.data.sort((a, b) => {
            let leftVal, rightVal, factor;
            const key = self.columns[self.orderBy].data;

            if (self.orderDir === 'asc') {
                leftVal = a[key]
                rightVal = b[key]
                factor = 1;
            } else {
                leftVal = b[key]
                rightVal = a[key]
                factor = -1;
            }

            if (leftVal === null) {
                return rightVal === null ? 0 : factor;
            } else if (rightVal === null)
                return -factor;

            if (typeof leftVal === "string")
                return leftVal.toLowerCase().localeCompare(rightVal.toLowerCase());
            else
                return leftVal - rightVal;
        });
        return this;
    }
    this.render = function() {
        const self = this;
        let html = '';
        this.data
            .slice((this.page-1) * this.pageSize, this.page * this.pageSize)
            .forEach((row) => {
                let rowHtml = '<tr>';
                self.columns.forEach((col) => {
                    const value = row[col.data];
                    rowHtml += `<td>${col.render(value, row)}</td>`;
                });

                html += rowHtml + '</tr>';
            });

        if (html.length === 0) {
            html = `<tr><td colspan="${this.columns.length}" class="center-align">No matching records found</td></tr>`;
        }

        this.root.querySelector('tbody').innerHTML = html;

        if (this.pagination === null) {
            this.pagination = document.createElement('ul');
            this.pagination.className = 'pagination';
            this.root.after(this.pagination);
        }

        let ellipsis = false
        html = '';
        for (let i = 1, p = this.page, n = Math.ceil(this.data.length / this.pageSize); i <= n; i++) {
            if (Math.abs(i - p) <= 1 || i === 1 || i === n) {
                if (i === p)
                    html += `<li class="active"><a href="#!">${i}</a></li>`;
                else
                    html += `<li><a href="#!">${i}</a></li>`;
                ellipsis = false;
            } else if (!ellipsis) {
                html += '<li class="ellipsis"><a href="#!">&hellip;</a></li>';
                ellipsis = true;
            }
        }

        this.pagination.innerHTML = html;
        this.pagination.querySelectorAll('li:not(.ellipsis) a')
            .forEach((elem) => {
                elem.addEventListener('click', (event) => {
                    self.page = parseInt(event.currentTarget.innerText, 10);
                    self.render();
                });
            })
    }

    const self = this;
    const headers = this.root.querySelectorAll('thead tr:first-child th');
    headers.forEach((elem, i) => {
        const column = self.columns[i];
        if (getValue(column.orderable, true)) {
            const classes = ['sortable'];

            if (i === self.orderBy) {
                classes.push(self.orderDir);
            }

            elem.className = classes.join(' ');
            elem.addEventListener('click', (event) => {
                if (i === self.orderBy) {
                    self.orderDir = self.orderDir === 'asc' ? 'desc' : 'asc';
                } else {
                    self.orderBy = i;
                    self.orderDir = 'asc';
                }

                headers.forEach((header) => {
                    if (header.className.includes('sortable'))
                        header.className = 'sortable';
                });

                elem.className = 'sortable ' + self.orderDir;
                self.sort();
                self.page = 1;
                self.render();

            });
        }
    })

    const searchElem = document.createElement('div');
    searchElem.className = 'input-field table-search'
    searchElem.innerHTML = `
        <input placeholder="Search" type="text">
    `;
    this.root.before(searchElem);
    let timeout = null;
    searchElem.querySelector('input')
        .addEventListener('input', (event) => {
            const input = event.currentTarget.value.trim();

            if (timeout !== null)
                clearTimeout(timeout);

            timeout = setTimeout(() => {
                self.searchQuery = input.length > 0 ? input : null;
                self.page = 1;
                self.search().sort().render();
            }, 350);
        });

    this.sort().render();
}