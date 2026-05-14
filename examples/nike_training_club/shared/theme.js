/*
 * Nike Training Club — design tokens.
 * ES5 only — no const/let/arrow/template-literals.
 *
 * Mood: Speed + Power
 * Tone: Bold, kinetic, empowering
 * Palette: Black canvas, volt (#CDFF00) accent, system fonts
 */

/* ── Utility ────────────────────────────────────────────────── */

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    var n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
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

/* ── Palettes ───────────────────────────────────────────────── */

var DARK = {
    name: 'dark',
    bg: '#0A0A0A',
    panel: '#151515',
    panelHi: '#1C1C1C',
    edge: 'rgba(205,255,0,0.10)',
    edgeStrong: 'rgba(205,255,0,0.25)',
    grid: 'rgba(255,255,255,0.05)',
    text: '#F0F0F0',
    textDim: 'rgba(240,240,240,0.50)',
    textFaint: 'rgba(240,240,240,0.25)',
    s1: '#CDFF00',
    s2: '#A3CC00',
    s3: '#7A9900',
    s4: '#526600',
    s5: '#293300',
    accent: '#CDFF00',
    success: '#CDFF00',
    warn: '#FFB800',
    danger: '#FF4444',
    invert: '#111111'
};

var LIGHT = {
    name: 'light',
    bg: '#F5F5F5',
    panel: '#FFFFFF',
    panelHi: '#FAFAFA',
    edge: 'rgba(138,184,0,0.12)',
    edgeStrong: 'rgba(138,184,0,0.30)',
    grid: 'rgba(0,0,0,0.06)',
    text: '#111111',
    textDim: 'rgba(17,17,17,0.55)',
    textFaint: 'rgba(17,17,17,0.25)',
    s1: '#8AB800',
    s2: '#6E9300',
    s3: '#536E00',
    s4: '#384A00',
    s5: '#1C2500',
    accent: '#8AB800',
    success: '#8AB800',
    warn: '#CC9300',
    danger: '#CC3333',
    invert: '#F0F0F0'
};

function getTheme(name) {
    return (name === 'light') ? LIGHT : DARK;
}

/* ── Fonts ──────────────────────────────────────────────────── */

var FONTS = {
    data: '"SF Mono", Menlo, Consolas, monospace',
    ui: '"Helvetica Neue", Helvetica, Arial, sans-serif'
};

/* ── Severity / status ──────────────────────────────────────── */

function severityColor(t, sev) {
    var s = String(sev).toLowerCase();
    if (s === 'critical' || s === 'crit' || s === 'danger' || s === 'low') return t.danger;
    if (s === 'warning' || s === 'warn' || s === 'medium') return t.warn;
    if (s === 'ok' || s === 'good' || s === 'success' || s === 'high') return t.success;
    return t.textDim;
}

/* ── Number formatting ──────────────────────────────────────── */

function fmtNum(v, opts) {
    opts = opts || {};
    var n = parseFloat(v);
    if (isNaN(n)) return String(v);
    if (opts.compact) {
        var abs = Math.abs(n);
        if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    }
    if (typeof opts.decimals === 'number' && opts.decimals >= 0) {
        return n.toFixed(opts.decimals);
    }
    return String(n);
}

/* ── Canvas helpers ─────────────────────────────────────────── */

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

function drawPanel(ctx, t, x, y, w, h) {
    /* Nike panel chrome: 2px volt left bar, flush card */
    ctx.fillStyle = t.panel;
    roundRect(ctx, x, y, w, h, 2);
    ctx.fill();
    ctx.fillStyle = t.accent;
    ctx.fillRect(x, y + 2, 2, h - 4);
}

function drawHGrid(ctx, t, x, y, w, h, divisions) {
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    for (var i = 1; i < divisions; i++) {
        var gy = y + (h / divisions) * i;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
        ctx.stroke();
    }
}

function parseColors(raw, fallback) {
    if (!raw) return fallback || [];
    var arr = String(raw).split(',');
    var result = [];
    for (var i = 0; i < arr.length; i++) {
        var c = arr[i].replace(/\s/g, '');
        if (c && c[0] === '#') result.push(c);
    }
    return result.length > 0 ? result : (fallback || []);
}

function parseInts(raw) {
    if (!raw) return [];
    var arr = String(raw).split(',');
    var result = [];
    for (var i = 0; i < arr.length; i++) {
        var n = parseInt(arr[i], 10);
        if (!isNaN(n)) result.push(n);
    }
    return result;
}

/* ── Config helpers (B3, B10) ───────────────────────────────── */

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

function parseNum(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
}

/* ── Font loading (B1) ──────────────────────────────────────── */

var _fontReady = {};
var _fontPending = {};

function loadFonts(fontFamily, callback) {
    if (_fontReady[fontFamily]) { callback(); return; }
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) {
        setTimeout(callback, 200);
        return;
    }
    if (!_fontPending[fontFamily]) {
        _fontPending[fontFamily] = true;
        document.fonts.load('400 48px ' + fontFamily).then(function() {
            _fontReady[fontFamily] = true;
        });
    }
    var attempts = 0;
    var poll = function() {
        attempts++;
        if (_fontReady[fontFamily] || attempts > 30) {
            _fontReady[fontFamily] = true;
            callback();
            return;
        }
        setTimeout(poll, 100);
    };
    poll();
}

/* ── Canvas setup (B2, B17) ─────────────────────────────────── */

function setupCanvas(el) {
    var canvas = el.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        el.appendChild(canvas);
    }
    var rect = el.getBoundingClientRect();
    var w = Math.floor(rect.width) || 300;
    var h = Math.floor(rect.height) || 200;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { canvas: canvas, ctx: ctx, w: w, h: h, dpr: dpr };
}

/* ── Exports ────────────────────────────────────────────────── */

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
    getNS: getNS,
    getOption: getOption,
    parseNum: parseNum,
    loadFonts: loadFonts,
    setupCanvas: setupCanvas,
    FONTS: FONTS
};
