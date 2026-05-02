/*
 * SUPER CO Design System — Canvas 2D Drawing Utilities
 * Shared across all visualizations in the super_co_viz app.
 */

function roundRect(ctx, x, y, w, h, r) {
    if (r > h / 2) r = h / 2;
    if (r > w / 2) r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

function roundRectTop(ctx, x, y, w, h, r) {
    if (r > h / 2) r = h / 2;
    if (r > w / 2) r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

function fitText(ctx, text, maxWidth, maxFontSize, fontFamily) {
    var size = maxFontSize;
    ctx.font = size + 'px ' + fontFamily;
    while (ctx.measureText(text).width > maxWidth && size > 6) {
        size--;
        ctx.font = size + 'px ' + fontFamily;
    }
    return size;
}

function drawArc(ctx, cx, cy, radius, startDeg, endDeg, color, lineWidth) {
    var startRad = (startDeg - 90) * Math.PI / 180;
    var endRad = (endDeg - 90) * Math.PI / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startRad, endRad, false);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
}

function drawLegend(ctx, items, x, y, fontSize, fontFamily) {
    var swatchSize = fontSize;
    var pad = fontSize * 0.5;
    var cx = x;
    ctx.font = fontSize + 'px ' + fontFamily;
    ctx.textBaseline = 'middle';
    for (var i = 0; i < items.length; i++) {
        ctx.fillStyle = items[i].color;
        roundRect(ctx, cx, y, swatchSize, swatchSize, 2);
        ctx.fill();
        cx += swatchSize + pad;
        ctx.fillStyle = items[i].textColor || '#999';
        ctx.fillText(items[i].label, cx, y + swatchSize / 2);
        cx += ctx.measureText(items[i].label).width + pad * 2;
    }
}

function gridLayout(totalWidth, totalHeight, rows, cols, padding) {
    var cellW = (totalWidth - padding * (cols + 1)) / cols;
    var cellH = (totalHeight - padding * (rows + 1)) / rows;
    var cells = [];
    for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
            cells.push({
                x: padding + c * (cellW + padding),
                y: padding + r * (cellH + padding),
                w: cellW,
                h: cellH
            });
        }
    }
    return { cells: cells, cellW: cellW, cellH: cellH };
}

function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    if (n % 1 !== 0) return n.toFixed(1);
    return String(n);
}

function ellipsis(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
        t = t.slice(0, -1);
    }
    return t + '…';
}

module.exports = {
    roundRect: roundRect,
    roundRectTop: roundRectTop,
    fitText: fitText,
    drawArc: drawArc,
    drawLegend: drawLegend,
    gridLayout: gridLayout,
    formatNumber: formatNumber,
    ellipsis: ellipsis
};
