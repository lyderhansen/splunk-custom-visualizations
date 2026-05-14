/*
 * Netflix Viz Pack — Stranger Things edition — design tokens.
 * ES5 only — no const/let/arrow/template-literals.
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

/* ── Stranger Things Dark: near-black with warm red-tinted undertone ── */
var DARK = {
    name: 'dark',
    bg:        '#0A0A0F',
    panel:     '#141418',
    panelHi:   '#1C1C22',
    edge:      'rgba(229,9,20,0.12)',
    edgeStrong:'rgba(229,9,20,0.25)',
    grid:      'rgba(255,255,255,0.04)',
    text:      '#F5E6D3',
    textDim:   'rgba(245,230,211,0.60)',
    textFaint: 'rgba(245,230,211,0.30)',
    s1: '#E50914',
    s2: '#B81D24',
    s3: '#831010',
    s4: '#FF6B6B',
    s5: '#FFB347',
    accent:  '#E50914',
    success: '#46D369',
    warn:    '#F5A623',
    danger:  '#E50914',
    invert:  '#0A0A0F',
    glow:    '#E50914',
    glowDim: '#831010'
};

/* ── Light theme: warm cream with toned-down reds ── */
var LIGHT = {
    name: 'light',
    bg:        '#F5F0EB',
    panel:     '#FFFFFF',
    panelHi:   '#F0EBE5',
    edge:      'rgba(229,9,20,0.08)',
    edgeStrong:'rgba(229,9,20,0.15)',
    grid:      'rgba(0,0,0,0.06)',
    text:      '#1A1118',
    textDim:   'rgba(26,17,24,0.60)',
    textFaint: 'rgba(26,17,24,0.30)',
    s1: '#B81D24',
    s2: '#831010',
    s3: '#D44040',
    s4: '#FF8A8A',
    s5: '#D4940A',
    accent:  '#B81D24',
    success: '#2D9E49',
    warn:    '#D4880F',
    danger:  '#B81D24',
    invert:  '#FFFFFF',
    glow:    '#B81D24',
    glowDim: '#831010'
};

function getTheme(name) {
    return (name === 'light') ? LIGHT : DARK;
}

var FONTS = {
    ui: 'Georgia, "Times New Roman", serif',
    mono: '"SF Mono", "Cascadia Code", Menlo, Consolas, monospace'
};

function severityColor(t, sev) {
    var s = (sev || '').toString().toLowerCase();
    if (s === 'crit' || s === 'critical' || s === 'high' || s === 'danger' || s === 'error') return t.danger;
    if (s === 'warn' || s === 'warning' || s === 'med' || s === 'medium' || s === 'degraded') return t.warn;
    if (s === 'low' || s === 'info' || s === 'ok' || s === 'success' || s === 'healthy') return t.success;
    return t.textDim;
}

function fmtNum(v, opts) {
    opts = opts || {};
    if (v === null || v === undefined || isNaN(v)) return '\u2014';
    var abs = Math.abs(v);
    if (opts.compact && abs >= 1000) {
        if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    }
    if (opts.fixed !== undefined) return v.toFixed(opts.fixed);
    return Math.round(v).toLocaleString('en-US');
}

function roundRect(ctx, x, y, w, h, r) {
    if (r === undefined) r = 4;
    r = Math.min(r, w / 2, h / 2);
    if (r < 0) r = 0;
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

/* Panel chrome: clean dark card with subtle border — no default glow */
function drawPanel(ctx, t, x, y, w, h) {
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
    ctx.fillStyle = t.panel;
    ctx.fill();
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
    ctx.strokeStyle = t.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
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

/* Neon glow text — Stranger Things signature effect */
function drawGlowText(ctx, text, x, y, font, color, glowSize) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = glowSize || 12;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.fillText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, x, y);
    ctx.restore();
}

/* Subtle vignette — darkens edges for cinematic depth */
function drawVignette(ctx, w, h, strength) {
    var cx = w / 2, cy = h / 2;
    var r = Math.max(w, h) * 0.7;
    var grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, withAlpha('#000000', strength || 0.3));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

/* Sparkline for KPI tiles */
function drawSparkline(ctx, values, x, y, w, h, color, mode) {
    if (!values || values.length < 2) return;
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < values.length; i++) {
        if (values[i] < min) min = values[i];
        if (values[i] > max) max = values[i];
    }
    var range = max - min || 1;
    var step = w / (values.length - 1);
    ctx.save();
    ctx.beginPath();
    for (var j = 0; j < values.length; j++) {
        var px = x + j * step;
        var py = y + h - ((values[j] - min) / range) * h;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    if (mode === 'area') {
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fillStyle = withAlpha(color, 0.15);
        ctx.fill();
        ctx.beginPath();
        for (var k = 0; k < values.length; k++) {
            var px2 = x + k * step;
            var py2 = y + h - ((values[k] - min) / range) * h;
            if (k === 0) ctx.moveTo(px2, py2);
            else ctx.lineTo(px2, py2);
        }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

function fitText(ctx, text, maxWidth, startSize, minSize, family) {
    var size = startSize;
    var min = minSize || 8;
    ctx.font = 'bold ' + size + 'px ' + family;
    while (ctx.measureText(text).width > maxWidth && size > min) {
        size -= 1;
        ctx.font = 'bold ' + size + 'px ' + family;
    }
    return size;
}

function drawDelta(ctx, x, y, size, value, upColor, downColor) {
    var positive = value >= 0;
    ctx.fillStyle = positive ? upColor : downColor;
    ctx.beginPath();
    if (positive) {
        ctx.moveTo(x, y + size);
        ctx.lineTo(x + size / 2, y);
        ctx.lineTo(x + size, y + size);
    } else {
        ctx.moveTo(x, y);
        ctx.lineTo(x + size / 2, y + size);
        ctx.lineTo(x + size, y);
    }
    ctx.closePath();
    ctx.fill();
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

function parseBool(val, fallback) {
    if (val === undefined || val === null) return fallback;
    return val === 'true' || val === true || val === '1';
}

module.exports = {
    getTheme: getTheme,
    withAlpha: withAlpha,
    lerpColor: lerpColor,
    severityColor: severityColor,
    fmtNum: fmtNum,
    roundRect: roundRect,
    drawPanel: drawPanel,
    drawHGrid: drawHGrid,
    drawGlowText: drawGlowText,
    drawVignette: drawVignette,
    drawSparkline: drawSparkline,
    fitText: fitText,
    drawDelta: drawDelta,
    parseColors: parseColors,
    parseInts: parseInts,
    parseBool: parseBool,
    FONTS: FONTS
};
