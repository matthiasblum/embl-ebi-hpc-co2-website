function round(value, precision) {
    const f = Math.pow(10, precision);
    return Math.floor(value * f) / f;
}

function getValue(value, defaultValue) {
    if (value === undefined || value === null)
        return defaultValue;
    return value;
}

function renderCost(value) {
    if (value > 100)
        return `£${round(value, 0).toLocaleString()}`;
    else if (value > 1)
        return `£${round(value, 2).toLocaleString()}`;
    return '&lt; £1';
}

function renderCo2Emissions(value, useTonne) {
    if (value >= 1e6) {
        if (useTonne)
            return round(value/1e6, 1).toLocaleString() + ' t';
        return round(value/1000, 0).toLocaleString() + ' kg';
    } else if (value >= 1000)
        return round(value/1000, 1).toLocaleString() + ' kg';
    else if (value >= 1)
        return round(value, 1).toLocaleString() + ' g';
    else if (value >= 0.001)
        return round(value * 1000, 1).toLocaleString() + ' mg';
    return '&lt; 1 mg'
}

function resetScrollspy() {
    const elems = document.querySelectorAll('.scrollspy');
    elems.forEach((elem) => {
        const instance = M.ScrollSpy.getInstance(elem);
        if (instance !== undefined)
            instance.destroy()
    });
    M.ScrollSpy.init(elems, {
        scrollOffset: 0
    });
}

function renderCpuTime(seconds) {
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

    for (const [unit, unitSeconds, precision] of times) {
        if (seconds >= unitSeconds) {
            const x = seconds / unitSeconds;
            return `${round(x, precision)} ${unit}${pluralize(x)}`;
        }
    }
    return `${round(seconds, 0)} second${pluralize(seconds)}`;
}

export {round, getValue, renderCost, renderCo2Emissions, resetScrollspy, renderCpuTime};