/*
 * Porsche GT3 Viz — design tokens.
 * ES5 only — no const/let/arrow/template-literals.
 */

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
    };
}

function withAlpha(hex, alpha) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp01(alpha) + ')';
}

function lerpColor(a, b, t) {
    var ca = hexToRgb(a);
    var cb = hexToRgb(b);
    t = clamp01(t);
    var r = Math.round(ca.r + (cb.r - ca.r) * t);
    var g = Math.round(ca.g + (cb.g - ca.g) * t);
    var bl = Math.round(ca.b + (cb.b - ca.b) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

var DARK = {
    name: 'dark',
    bg: '#0A0A0A',
    panel: '#141414',
    panelHi: '#1A1A1A',
    edge: '#2A2A2A',
    edgeStrong: '#3A3A3A',
    grid: '#1E1E1E',
    text: '#E8E8E8',
    textDim: '#707070',
    textFaint: '#505050',
    s1: '#FA2223',
    s2: '#FFB800',
    s3: '#3B82F6',
    s4: '#A855F7',
    s5: '#00D26A',
    accent: '#FA2223',
    success: '#00D26A',
    warn: '#FFB800',
    danger: '#FA2223',
    invert: '#FFFFFF',
    // Porsche-specific tokens
    guardsRed: '#FA2223',
    guardsRedMuted: '#8B1A1A',
    guardsRedGlow: 'rgba(250, 34, 35, 0.15)',
    tyreSoft: '#FA2223',
    tyreMedium: '#FFB800',
    tyreHard: '#E8E8E8',
    tyreWet: '#3B82F6',
    personalBest: '#A855F7',
    sessionBest: '#00D26A'
};

var LIGHT = {
    name: 'light',
    bg: '#F5F5F5',
    panel: '#FFFFFF',
    panelHi: '#FAFAFA',
    edge: '#E0E0E0',
    edgeStrong: '#CCCCCC',
    grid: '#EEEEEE',
    text: '#1A1A1A',
    textDim: '#6B6B6B',
    textFaint: '#999999',
    s1: '#D5001C',
    s2: '#D97706',
    s3: '#2563EB',
    s4: '#7C3AED',
    s5: '#059669',
    accent: '#D5001C',
    success: '#059669',
    warn: '#D97706',
    danger: '#D5001C',
    invert: '#000000',
    guardsRed: '#D5001C',
    guardsRedMuted: '#FEE2E2',
    guardsRedGlow: 'rgba(213, 0, 28, 0.08)',
    tyreSoft: '#D5001C',
    tyreMedium: '#D97706',
    tyreHard: '#374151',
    tyreWet: '#2563EB',
    personalBest: '#7C3AED',
    sessionBest: '#059669'
};

function getTheme(name) {
    return (name === 'light') ? LIGHT : DARK;
}

var FONTS = {
    ui: 'Geist, -apple-system, BlinkMacSystemFont, sans-serif',
    mono: 'JetBrains Mono, SF Mono, Menlo, monospace'
};

var SIZING = {
    heroValue: 48,
    kpiValue: 32,
    dataValue: 14,
    labelSize: 11,
    labelSpacing: 0.08,
    cornerRadius: 0,
    panelGap: 4
};

function severityColor(t, sev) {
    if (sev === 'critical' || sev === 'danger') return t.danger;
    if (sev === 'warning' || sev === 'warn') return t.warn;
    return t.success;
}

function fmtNum(v, opts) {
    opts = opts || {};
    var decimals = opts.decimals !== undefined ? opts.decimals : 0;
    var compact = opts.compact !== false;
    var abs = Math.abs(v);
    if (compact && abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (compact && abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (compact && abs >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return v.toFixed(decimals);
}

function fmtLapTime(seconds) {
    if (seconds == null || isNaN(seconds)) return '--:--.---';
    var mins = Math.floor(seconds / 60);
    var secs = (seconds % 60).toFixed(3);
    if (parseFloat(secs) < 10) secs = '0' + secs;
    return mins + ':' + secs;
}

function fmtGap(seconds) {
    if (seconds == null || isNaN(seconds)) return '---';
    var sign = seconds >= 0 ? '+' : '-';
    return sign + Math.abs(seconds).toFixed(3);
}

function roundRect(ctx, x, y, w, h, r) {
    if (r === 0) {
        ctx.rect(x, y, w, h);
        return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawPanel(ctx, t, x, y, w, h) {
    ctx.fillStyle = t.panel;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = t.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawFlushPanel(ctx, t, x, y, w, h) {
    ctx.fillStyle = t.panel;
    ctx.fillRect(x, y, w, h);
    // Bottom hairline only
    ctx.strokeStyle = t.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + h - 0.5);
    ctx.lineTo(x + w, y + h - 0.5);
    ctx.stroke();
}

function drawHGrid(ctx, t, x, y, w, h, divisions) {
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    var step = h / divisions;
    for (var i = 1; i < divisions; i++) {
        var gy = Math.round(y + step * i) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
        ctx.stroke();
    }
}

function parseColors(raw, fallback) {
    if (!raw) return fallback || [];
    return raw.split(',').map(function(s) { return s.trim(); });
}

function parseInts(raw) {
    if (!raw) return [];
    return raw.split(',').map(function(s) { return parseInt(s.trim(), 10); });
}

function tempToColor(t, temp, minTemp, maxTemp, optimalMin, optimalMax) {
    if (temp < optimalMin) {
        var coldRatio = clamp01((optimalMin - temp) / (optimalMin - minTemp));
        return lerpColor(t.success, t.s3, coldRatio);
    }
    if (temp > optimalMax) {
        var hotRatio = clamp01((temp - optimalMax) / (maxTemp - optimalMax));
        return lerpColor(t.warn, t.danger, hotRatio);
    }
    return t.success;
}

function compoundColor(t, compound) {
    compound = (compound || '').toLowerCase();
    if (compound === 'soft') return t.tyreSoft;
    if (compound === 'medium') return t.tyreMedium;
    if (compound === 'hard') return t.tyreHard;
    if (compound === 'wet' || compound === 'inter') return t.tyreWet;
    return t.textDim;
}

module.exports = {
    getTheme: getTheme,
    withAlpha: withAlpha,
    lerpColor: lerpColor,
    hexToRgb: hexToRgb,
    severityColor: severityColor,
    fmtNum: fmtNum,
    fmtLapTime: fmtLapTime,
    fmtGap: fmtGap,
    roundRect: roundRect,
    drawPanel: drawPanel,
    drawFlushPanel: drawFlushPanel,
    drawHGrid: drawHGrid,
    parseColors: parseColors,
    parseInts: parseInts,
    tempToColor: tempToColor,
    compoundColor: compoundColor,
    FONTS: FONTS,
    SIZING: SIZING
};
