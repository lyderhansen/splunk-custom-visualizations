/*
 * Red Bull Racing Viz Pack — design tokens.
 * ES5 only. All vizs import getTheme() from this module.
 *
 * F1 aesthetic: sharp, technical, flush with bg, no rounded chrome.
 * Inspired by F1 timing screens, telemetry overlays, instrument clusters.
 */

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function withAlpha(hex, alpha) {
    if (!hex) return 'rgba(0,0,0,' + alpha + ')';
    if (hex.indexOf('rgba') === 0 || hex.indexOf('rgb(') === 0) return hex;
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + clamp01(alpha) + ')';
}

function lerpColor(a, b, t) {
    var ah = a.replace('#',''), bh = b.replace('#','');
    if (ah.length === 3) ah = ah[0]+ah[0]+ah[1]+ah[1]+ah[2]+ah[2];
    if (bh.length === 3) bh = bh[0]+bh[0]+bh[1]+bh[1]+bh[2]+bh[2];
    var ar = parseInt(ah.substring(0,2),16), ag = parseInt(ah.substring(2,4),16), ab = parseInt(ah.substring(4,6),16);
    var br = parseInt(bh.substring(0,2),16), bg = parseInt(bh.substring(2,4),16), bb = parseInt(bh.substring(4,6),16);
    var r = Math.round(ar + (br - ar) * t);
    var g = Math.round(ag + (bg - ag) * t);
    var bl = Math.round(ab + (bb - ab) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

var DARK = {
    name: 'dark',
    bg: '#0B0E1A',
    panel: '#0F1320',
    panelHi: '#161C2E',
    edge: 'rgba(255,255,255,0.04)',
    edgeStrong: 'rgba(255,255,255,0.10)',
    grid: 'rgba(255,255,255,0.06)',
    text: '#E8ECF1',
    textDim: 'rgba(232,236,241,0.60)',
    textFaint: 'rgba(232,236,241,0.30)',
    red: '#DC0000',
    blue: '#1E3A6E',
    gold: '#FFC906',
    green: '#46D369',
    orange: '#FF6B35',
    accent: '#DC0000',
    success: '#46D369',
    warn: '#FFC906',
    danger: '#DC0000',
    purple: '#7B2FBE',
    invert: '#FFFFFF'
};

var LIGHT = {
    name: 'light',
    bg: '#F0F2F5',
    panel: '#FFFFFF',
    panelHi: '#F7F9FC',
    edge: 'rgba(0,0,0,0.06)',
    edgeStrong: 'rgba(0,0,0,0.14)',
    grid: 'rgba(0,0,0,0.06)',
    text: '#0B0E1A',
    textDim: 'rgba(11,14,26,0.60)',
    textFaint: 'rgba(11,14,26,0.30)',
    red: '#DC0000',
    blue: '#15305E',
    gold: '#D4A800',
    green: '#2D8F47',
    orange: '#D45A20',
    accent: '#DC0000',
    success: '#2D8F47',
    warn: '#D4A800',
    danger: '#DC0000',
    purple: '#5E1F9E',
    invert: '#000000'
};

function getTheme(name) { return (name === 'light') ? LIGHT : DARK; }

var FONTS = {
    data: '"SF Mono", "Fira Code", Menlo, Consolas, monospace',
    ui: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    display: '"Helvetica Neue", Helvetica, Arial, sans-serif'
};

var TYRE_COLORS = {
    'soft': '#DC0000',
    'medium': '#FFC906',
    'hard': '#FFFFFF',
    'intermediate': '#46D369',
    'wet': '#1E3A6E'
};

function tyreColor(compound) {
    return TYRE_COLORS[(compound || '').toLowerCase()] || '#6B7280';
}

function severityColor(t, sev) {
    var s = (sev || '').toString().toLowerCase();
    if (s === 'crit' || s === 'critical' || s === 'high' || s === 'danger' || s === 'error') return t.danger;
    if (s === 'warn' || s === 'warning' || s === 'med' || s === 'medium' || s === 'degraded') return t.warn;
    if (s === 'low' || s === 'info' || s === 'ok' || s === 'success' || s === 'healthy') return t.success;
    return t.textDim;
}

function fmtNum(v, opts) {
    opts = opts || {};
    if (v === null || v === undefined || isNaN(v)) return '—';
    var abs = Math.abs(v);
    if (opts.compact && abs >= 1000) {
        if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    }
    if (opts.fixed !== undefined) return v.toFixed(opts.fixed);
    return Math.round(v).toLocaleString('en-US');
}

function fmtLapTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return '—';
    var m = Math.floor(seconds / 60);
    var s = (seconds % 60).toFixed(3);
    if (parseFloat(s) < 10) s = '0' + s;
    return m + ':' + s;
}

function drawHGrid(ctx, t, x, y, w, h, divisions) {
    ctx.save();
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    for (var i = 0; i <= divisions; i++) {
        var gy = Math.round(y + (h * i) / divisions) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
        ctx.stroke();
    }
    ctx.restore();
}

function parseColors(raw, fallback) {
    if (!raw) return fallback || [];
    var parts = String(raw).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var c = parts[i].trim();
        if (c) out.push(c);
    }
    return out.length ? out : (fallback || []);
}

function parseInts(raw) {
    if (!raw) return [];
    var parts = String(raw).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var v = parseInt(parts[i], 10);
        if (!isNaN(v)) out.push(v);
    }
    return out;
}

module.exports = {
    getTheme: getTheme, withAlpha: withAlpha, lerpColor: lerpColor,
    severityColor: severityColor, tyreColor: tyreColor,
    fmtNum: fmtNum, fmtLapTime: fmtLapTime,
    drawHGrid: drawHGrid, parseColors: parseColors,
    parseInts: parseInts, FONTS: FONTS, TYRE_COLORS: TYRE_COLORS
};
