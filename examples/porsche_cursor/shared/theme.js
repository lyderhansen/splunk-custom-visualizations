/*
 * Porsche Taycan EV Telemetry — design tokens.
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
    if (hex.indexOf('rgba') === 0) return hex;
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
    bg: '#0A0A0F',
    panel: '#141419',
    panelHi: '#1C1C24',
    edge: 'rgba(255,255,255,0.06)',
    edgeStrong: 'rgba(255,255,255,0.12)',
    grid: 'rgba(255,255,255,0.04)',
    text: '#E8E6E3',
    textDim: 'rgba(232,230,227,0.55)',
    textFaint: 'rgba(232,230,227,0.28)',
    s1: '#00C9A7',
    s2: '#3B82F6',
    s3: '#C8A96E',
    s4: '#7C7C84',
    s5: '#A78BFA',
    accent: '#00C9A7',
    success: '#00C9A7',
    warn: '#F59E0B',
    danger: '#EF4444',
    invert: '#0A0A0F'
};

var LIGHT = {
    name: 'light',
    bg: '#F0F0F2',
    panel: '#FFFFFF',
    panelHi: '#FAFAFA',
    edge: 'rgba(10,10,15,0.08)',
    edgeStrong: 'rgba(10,10,15,0.15)',
    grid: 'rgba(10,10,15,0.06)',
    text: '#0A0A0F',
    textDim: 'rgba(10,10,15,0.55)',
    textFaint: 'rgba(10,10,15,0.28)',
    s1: '#00A88A',
    s2: '#2563EB',
    s3: '#A68A50',
    s4: '#6B6B73',
    s5: '#7C3AED',
    accent: '#00A88A',
    success: '#00A88A',
    warn: '#D97706',
    danger: '#DC2626',
    invert: '#FFFFFF'
};

function getTheme(name) {
    return (name === 'light') ? LIGHT : DARK;
}

var FONTS = {
    ui: '"Space Grotesk", sans-serif',
    mono: '"JetBrains Mono", monospace'
};

function severityColor(t, sev) {
    if (!sev) return t.s4;
    var s = String(sev).toLowerCase();
    if (s === 'critical' || s === 'danger' || s === 'error') return t.danger;
    if (s === 'warning' || s === 'warn') return t.warn;
    if (s === 'ok' || s === 'normal' || s === 'good' || s === 'success') return t.success;
    return t.s4;
}

function fmtNum(v, opts) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    opts = opts || {};
    var abs = Math.abs(v);
    if (opts.compact) {
        if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    }
    if (opts.decimals !== undefined && opts.decimals >= 0) {
        return v.toFixed(opts.decimals);
    }
    if (abs >= 100) return Math.round(v).toString();
    if (abs >= 10) return v.toFixed(1);
    return v.toFixed(2);
}

function roundRect(ctx, x, y, w, h, r) {
    if (typeof r === 'undefined') r = 0;
    r = Math.min(r, w / 2, h / 2);
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

function drawGlassPanel(ctx, t, x, y, w, h, r) {
    if (typeof r === 'undefined') r = 8;
    var panelRgb = hexToRgb(t.panel);
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(' + panelRgb.r + ',' + panelRgb.g + ',' + panelRgb.b + ',0.65)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    var topEdge = ctx.createLinearGradient(x, y, x + w, y);
    topEdge.addColorStop(0, 'rgba(255,255,255,0)');
    topEdge.addColorStop(0.3, 'rgba(255,255,255,0.10)');
    topEdge.addColorStop(0.7, 'rgba(255,255,255,0.10)');
    topEdge.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.moveTo(x + r, y + 0.5);
    ctx.lineTo(x + w - r, y + 0.5);
    ctx.strokeStyle = topEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

function drawHGrid(ctx, t, x, y, w, h, divisions) {
    if (!divisions) divisions = 4;
    ctx.save();
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    for (var i = 0; i <= divisions; i++) {
        var gy = y + (h / divisions) * i;
        ctx.beginPath();
        ctx.moveTo(x, Math.round(gy) + 0.5);
        ctx.lineTo(x + w, Math.round(gy) + 0.5);
        ctx.stroke();
    }
    ctx.restore();
}

function parseColors(raw, fallback) {
    if (!raw) return fallback || [];
    return raw.split(',').map(function(c) { return c.trim(); }).filter(function(c) { return c.length > 0; });
}

function parseInts(raw) {
    if (!raw) return [];
    return raw.split(',').map(function(v) { return parseInt(v.trim(), 10); }).filter(function(v) { return !isNaN(v); });
}

function parseNum(raw, fallback) {
    var v = parseFloat(raw);
    return isNaN(v) ? fallback : v;
}

function getOption(config, ns, key, defaultValue) {
    var v = config[ns + key];
    if (v !== undefined && v !== null) return v;
    v = config[key];
    if (v !== undefined && v !== null) return v;
    return defaultValue;
}

function getNS(viz) {
    try {
        var info = viz.getPropertyNamespaceInfo();
        if (info && info.propertyNamespace) return info.propertyNamespace;
    } catch (e) {}
    return '';
}

function fitText(ctx, text, maxWidth, startSize, minSize) {
    var size = startSize;
    var min = minSize || 8;
    ctx.font = 'bold ' + size + 'px ' + FONTS.mono;
    while (ctx.measureText(text).width > maxWidth && size > min) {
        size -= 1;
        ctx.font = 'bold ' + size + 'px ' + FONTS.mono;
    }
    return size;
}

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
        document.fonts.load('400 48px "Space Grotesk"');
        document.fonts.load('400 48px "JetBrains Mono"');
    }
    var attempts = 0;
    var poll = function() {
        attempts++;
        if (_fontReady || attempts > 30) {
            _fontReady = true;
            onReady();
            return;
        }
        document.fonts.load('400 48px "Space Grotesk"').then(function(fonts) {
            if (fonts && fonts.length > 0) {
                _fontReady = true;
                onReady();
            } else {
                setTimeout(poll, 100);
            }
        });
    };
    poll();
}

function resetShadow(ctx) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

module.exports = {
    getTheme: getTheme,
    withAlpha: withAlpha,
    lerpColor: lerpColor,
    hexToRgb: hexToRgb,
    severityColor: severityColor,
    fmtNum: fmtNum,
    roundRect: roundRect,
    drawGlassPanel: drawGlassPanel,
    drawHGrid: drawHGrid,
    parseColors: parseColors,
    parseInts: parseInts,
    parseNum: parseNum,
    getOption: getOption,
    getNS: getNS,
    fitText: fitText,
    loadFonts: loadFonts,
    resetShadow: resetShadow,
    FONTS: FONTS
};
