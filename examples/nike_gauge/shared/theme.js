/*
 * Nike Gauge — design tokens.
 * ES5 only — no const/let/arrow/template-literals.
 */

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
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
    t = clamp01(t);
    var ca = hexToRgb(a);
    var cb = hexToRgb(b);
    var r = Math.round(ca.r + (cb.r - ca.r) * t);
    var g = Math.round(ca.g + (cb.g - ca.g) * t);
    var bl = Math.round(ca.b + (cb.b - ca.b) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

var DARK = {
    name: 'dark',
    bg: '#0A0A0A',
    panel: '#111111',
    panelHi: '#1A1A1A',
    edge: 'rgba(255,255,255,0.06)',
    edgeStrong: 'rgba(255,255,255,0.12)',
    grid: 'rgba(255,255,255,0.05)',
    text: '#FFFFFF',
    textDim: '#999999',
    textFaint: '#555555',
    s1: '#CDFF00',
    s2: '#A8D600',
    s3: '#7BAA00',
    s4: '#4E7D00',
    s5: '#335200',
    accent: '#CDFF00',
    success: '#CDFF00',
    warn: '#FF6B00',
    danger: '#FF2D55',
    invert: '#000000'
};

var LIGHT = {
    name: 'light',
    bg: '#F5F5F5',
    panel: '#FFFFFF',
    panelHi: '#FAFAFA',
    edge: 'rgba(0,0,0,0.08)',
    edgeStrong: 'rgba(0,0,0,0.15)',
    grid: 'rgba(0,0,0,0.06)',
    text: '#111111',
    textDim: '#666666',
    textFaint: '#AAAAAA',
    s1: '#8AB300',
    s2: '#6E8F00',
    s3: '#536B00',
    s4: '#384800',
    s5: '#1D2400',
    accent: '#8AB300',
    success: '#5C8A00',
    warn: '#CC5500',
    danger: '#CC1133',
    invert: '#FFFFFF'
};

function getTheme(name) {
    return (name === 'light') ? LIGHT : DARK;
}

var FONTS = {
    data: '"SF Mono", "Fira Code", Menlo, Consolas, monospace',
    ui: '"Helvetica Neue", "Arial Black", Helvetica, Arial, sans-serif'
};

var _fontReady = false;
var _fontPending = false;

function loadFonts(onReady) {
    if (_fontReady) { onReady(); return; }
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) {
        setTimeout(onReady, 200);
        return;
    }
    if (!_fontPending) {
        _fontPending = true;
        document.fonts.load('700 48px ' + FONTS.ui).then(function() {
            _fontReady = true;
        });
    }
    var attempts = 0;
    var poll = function() {
        attempts++;
        if (_fontReady || attempts > 30) {
            _fontReady = true;
            onReady();
            return;
        }
        setTimeout(poll, 100);
    };
    poll();
}

function getNS(viz) {
    try {
        var info = viz.getPropertyNamespaceInfo();
        if (info && info.propertyNamespace) return info.propertyNamespace;
    } catch (e) {}
    return '';
}

function getOption(config, ns, key, defaultValue) {
    var v = config[ns + key];
    if (v !== undefined && v !== null) return v;
    v = config[key];
    if (v !== undefined && v !== null) return v;
    return defaultValue;
}

function parseNum(raw, fallback) {
    var n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
}

function fmtNum(v, opts) {
    if (v == null || isNaN(v)) return '—';
    var abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    if (abs < 10) return v.toFixed(1);
    return Math.round(v).toString();
}

function severityColor(t, sev) {
    if (!sev) return t.textDim;
    var s = String(sev).toLowerCase();
    if (s === 'critical' || s === 'crit' || s === 'high') return t.danger;
    if (s === 'warning' || s === 'warn' || s === 'medium') return t.warn;
    if (s === 'ok' || s === 'low' || s === 'info') return t.success;
    return t.textDim;
}

function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawPanel(ctx, t, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 6);
    ctx.fillStyle = t.panel;
    ctx.fill();
    ctx.strokeStyle = t.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawHGrid(ctx, t, x, y, w, h, divisions) {
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 1; i < divisions; i++) {
        var gy = y + (h / divisions) * i;
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
    }
    ctx.stroke();
}

function parseColors(raw, fallback) {
    if (!raw || typeof raw !== 'string') return fallback;
    var parts = raw.split(',');
    var result = [];
    for (var i = 0; i < parts.length; i++) {
        var c = parts[i].replace(/\s/g, '');
        if (/^#[0-9a-fA-F]{3,8}$/.test(c)) result.push(c);
    }
    return result.length > 0 ? result : fallback;
}

function parseInts(raw) {
    if (!raw || typeof raw !== 'string') return [];
    var parts = raw.split(',');
    var result = [];
    for (var i = 0; i < parts.length; i++) {
        var n = parseInt(parts[i], 10);
        if (!isNaN(n)) result.push(n);
    }
    return result;
}

module.exports = {
    getTheme: getTheme,
    withAlpha: withAlpha,
    lerpColor: lerpColor,
    hexToRgb: hexToRgb,
    severityColor: severityColor,
    fmtNum: fmtNum,
    roundRect: roundRect,
    drawPanel: drawPanel,
    drawHGrid: drawHGrid,
    parseColors: parseColors,
    parseInts: parseInts,
    parseNum: parseNum,
    getNS: getNS,
    getOption: getOption,
    loadFonts: loadFonts,
    FONTS: FONTS
};
