/*
 * HBO Max Churn Gauge — ES5 270° ring gauge.
 */
define([
    'api/SplunkVisualizationBase'
], function (SplunkVisualizationBase) {
    var theme = require('shared/theme');

    function getOption(config, ns, key, defaultValue) {
        var v = config[ns + key];
        if (v !== undefined && v !== null) return v;
        v = config[key];
        if (v !== undefined && v !== null) return v;
        return defaultValue;
    }

    function fieldIndex(fields, name) {
        var i;
        for (i = 0; i < fields.length; i++) {
            if (fields[i].name === name) return i;
        }
        return -1;
    }

    function parseNumber(v) {
        if (v === null || v === undefined || v === '') return NaN;
        return parseFloat(v);
    }

    function clamp(x, lo, hi) {
        if (x < lo) return lo;
        if (x > hi) return hi;
        return x;
    }

    function formatValue(n, decimals) {
        if (n === null || n === undefined || isNaN(n)) return '\u2014';
        if (decimals < 0) {
            var abs = Math.abs(n);
            if (abs >= 100) return n.toFixed(1);
            if (abs >= 10) return n.toFixed(2);
            return n.toFixed(2);
        }
        return n.toFixed(decimals);
    }

    function arcColor(u) {
        if (u <= 0) u = 0;
        if (u > 1) u = 1;
        if (u <= 0.5) return theme.lerpColor('#7B61FF', '#4F6984', u * 2);
        return theme.lerpColor('#4F6984', '#EF4444', (u - 0.5) * 2);
    }

    function lastRowValue(data, col) {
        var fields = data.fields || [];
        var rows = data.rows || [];
        var idx = fieldIndex(fields, col);
        if (idx < 0 || rows.length === 0) return null;
        return rows[rows.length - 1][idx];
    }

    return SplunkVisualizationBase.extend({
        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this._canvas = null;
            this._ctx = null;
            this._tooltip = null;
            this._layout = { w: 0, h: 0, dpr: 1 };
            this._hover = false;
            this._tipHtml = '';
        },

        reflow: function () {
            this.invalidateUpdateView();
        },

        _ensureUi: function (root) {
            if (this._canvas) return;
            var wrap = document.createElement('div');
            wrap.style.position = 'relative';
            wrap.style.width = '100%';
            wrap.style.height = '100%';
            this._canvas = document.createElement('canvas');
            this._canvas.style.display = 'block';
            this._canvas.style.width = '100%';
            this._canvas.style.height = '100%';
            wrap.appendChild(this._canvas);
            root.appendChild(wrap);
            this._ctx = this._canvas.getContext('2d');

            this._tooltip = document.createElement('div');
            this._tooltip.setAttribute('role', 'tooltip');
            this._tooltip.style.cssText = [
                'position:absolute',
                'z-index:50',
                'pointer-events:none',
                'display:none',
                'max-width:320px',
                'padding:8px 10px',
                'border-radius:6px',
                'font:12px ' + theme.FONTS.ui.replace(/"/g, ''),
                'box-shadow:0 6px 24px rgba(0,0,0,0.35)',
                'white-space:pre-wrap'
            ].join(';');
            wrap.appendChild(this._tooltip);

            var self = this;
            this._canvas.addEventListener('mousemove', function (ev) {
                self._onMove(ev);
            });
            this._canvas.addEventListener('mouseleave', function () {
                self._hover = false;
                if (self._tooltip) self._tooltip.style.display = 'none';
            });
        },

        _hitTest: function (x, y, w, h) {
            return x >= 0 && y >= 0 && x <= w && y <= h;
        },

        _onMove: function (ev) {
            var rect = this._canvas.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var y = ev.clientY - rect.top;
            var w = rect.width;
            var h = rect.height;
            this._hover = this._hitTest(x, y, w, h);
            if (!this._hover || !this._tooltip) return;
            this._tooltip.innerHTML = this._tipHtml;
            this._tooltip.style.display = this._tipHtml ? 'block' : 'none';
            var tx = x + 12;
            var ty = y + 12;
            if (tx + 220 > w) tx = x - 220;
            if (ty + 90 > h) ty = y - 90;
            this._tooltip.style.left = Math.round(tx) + 'px';
            this._tooltip.style.top = Math.round(ty) + 'px';
        },

        updateView: function (data, config) {
            var root = this.el;
            if (!root) return;
            this._ensureUi(root);

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var fieldName = getOption(config, ns, 'field', 'value');
            var maxRaw = getOption(config, ns, 'maxValue', '100');
            var maxValue = parseFloat(maxRaw);
            if (isNaN(maxValue) || maxValue === 0) maxValue = 100;
            var unit = getOption(config, ns, 'unit', '%');
            var label = getOption(config, ns, 'label', '');
            var decRaw = getOption(config, ns, 'decimals', '-1');
            var decimals = parseInt(decRaw, 10);
            if (isNaN(decimals)) decimals = -1;
            var showGlowStr = getOption(config, ns, 'showGlow', 'true');
            var showGlow = String(showGlowStr) === 'true' || showGlowStr === true;
            var themeName = getOption(config, ns, 'theme', 'dark');
            var th = theme.getTheme(themeName === 'light' ? 'light' : 'dark');

            var cr = root.getBoundingClientRect();
            var cssW = Math.max(1, Math.floor(cr.width));
            var cssH = Math.max(1, Math.floor(cr.height));
            var dpr = window.devicePixelRatio || 1;
            if (this._layout.w !== cssW || this._layout.h !== cssH || this._layout.dpr !== dpr) {
                this._canvas.width = Math.floor(cssW * dpr);
                this._canvas.height = Math.floor(cssH * dpr);
                this._canvas.style.width = cssW + 'px';
                this._canvas.style.height = cssH + 'px';
                this._layout = { w: cssW, h: cssH, dpr: dpr };
            }

            this._tooltip.style.background = th.panelHi;
            this._tooltip.style.color = th.text;
            this._tooltip.style.border = '1px solid ' + th.edgeStrong;

            var ctx = this._ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            var w = cssW;
            var h = cssH;
            theme.drawPanel(ctx, th, 0, 0, w, h);

            var rawVal = lastRowValue(data, fieldName);
            var numVal = parseNumber(rawVal);
            var pct = clamp(isNaN(numVal) ? 0 : numVal / maxValue, 0, 1);

            var cx = w * 0.5;
            var cy = h * 0.52;
            var R = Math.min(w, h) * 0.38;
            var lineW = Math.max(8, Math.min(18, Math.min(w, h) * 0.055));
            var start = Math.PI * 0.75;
            var sweep = Math.PI * 1.5;

            ctx.lineCap = 'round';
            ctx.lineWidth = lineW;
            ctx.strokeStyle = th.edge;
            ctx.beginPath();
            ctx.arc(cx, cy, R, start, start + sweep, false);
            ctx.stroke();

            var totalSegs = 72;
            var tickLen = Math.max(6, lineW * 0.35);
            var g;

            ctx.lineJoin = 'round';
            for (g = 0; g < totalSegs; g++) {
                var u0 = g / totalSegs;
                var u1 = (g + 1) / totalSegs;
                if (u0 >= pct) break;
                if (u1 > pct) u1 = pct;
                var a0 = start + sweep * u0;
                var a1 = start + sweep * u1;
                if (a1 <= a0) break;
                ctx.beginPath();
                ctx.arc(cx, cy, R, a0, a1, false);
                var um = (u0 + u1) * 0.5;
                ctx.strokeStyle = arcColor(um);
                if (showGlow) {
                    ctx.shadowColor = theme.withAlpha('#7B61FF', 0.55);
                    ctx.shadowBlur = 10;
                } else {
                    ctx.shadowBlur = 0;
                }
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            ctx.lineWidth = 1;
            ctx.strokeStyle = th.edgeStrong;
            var ticks = [0, 0.25, 0.5, 0.75, 1];
            var t;
            for (t = 0; t < ticks.length; t++) {
                var u = ticks[t];
                var ang = start + sweep * u;
                var ix = cx + Math.cos(ang) * (R - lineW * 0.5);
                var iy = cy + Math.sin(ang) * (R - lineW * 0.5);
                var ox = cx + Math.cos(ang) * (R + tickLen);
                var oy = cy + Math.sin(ang) * (R + tickLen);
                ctx.beginPath();
                ctx.moveTo(ix, iy);
                ctx.lineTo(ox, oy);
                ctx.stroke();
            }

            var valStr = formatValue(numVal, decimals);
            var unitStr = unit ? String(unit) : '';
            var centerTxt = valStr + unitStr;

            var size0 = Math.max(14, Math.min(56, Math.min(w, h) * 0.22));
            var fitSz = theme.fitText(ctx, centerTxt, R * 1.85, size0, 12, theme.FONTS.mono);
            ctx.font = '600 ' + fitSz + 'px ' + theme.FONTS.mono;
            ctx.fillStyle = th.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(centerTxt, cx, cy - (label ? fitSz * 0.15 : 0));

            if (label) {
                var lblSz = Math.max(9, Math.min(18, Math.min(w, h) * 0.065));
                ctx.font = '500 ' + lblSz + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = th.textDim;
                ctx.fillText(String(label), cx, cy + fitSz * 0.65);
            }

            var pctStr = (isNaN(numVal) ? '0' : (pct * 100).toFixed(1)) + '%';
            var tip = '<b>' + String(fieldName) + '</b><br/>';
            tip += 'Value: ' + valStr + (unitStr ? ' ' + unitStr : '') + '<br/>';
            tip += 'Fill: ' + pctStr + '<br/>';
            tip += 'Max: ' + String(maxValue) + (unitStr ? ' ' + unitStr : '');
            if (label) tip += '<br/><span style="opacity:0.85">' + String(label) + '</span>';
            this._tipHtml = tip;
            if (this._hover && this._tooltip) {
                this._tooltip.innerHTML = this._tipHtml;
            }
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 5000 };
        },

        formatData: function (data) {
            return data;
        }
    });
});
