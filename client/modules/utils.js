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

function renderCo2Emissions(value) {
    if (value >= 1e6)
        return round(value/1000, 0).toLocaleString() + ' kg';
    else if (value >= 1000)
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

export {round, getValue, renderCost, renderCo2Emissions, resetScrollspy};