/*
 * HBO Max KPI Tile — ES5 Canvas viz (Splunk custom visualization).
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
        var n = parseFloat(v);
        return n;
    }

    function formatValue(n, decimals) {
        if (n === null || n === undefined || isNaN(n)) return '\u2014';
        if (decimals < 0) {
            var abs = Math.abs(n);
            if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
            if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
            if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
            if (abs >= 100) return n.toFixed(1);
            if (abs >= 10) return n.toFixed(2);
            return n.toFixed(2);
        }
        return n.toFixed(decimals);
    }

    function extractSparklineValues(data, sparklineField) {
        var fields = data.fields || [];
        var rows = data.rows || [];
        var idx = fieldIndex(fields, sparklineField);
        if (idx < 0) return [];
        if (rows.length > 1) {
            var out = [];
            var r;
            for (r = 0; r < rows.length; r++) {
                var pv = parseNumber(rows[r][idx]);
                if (!isNaN(pv)) out.push(pv);
            }
            return out;
        }
        if (rows.length === 1) {
            var cell = rows[0][idx];
            if (cell === null || cell === undefined) return [];
            var s = String(cell);
            if (s.indexOf(',') >= 0) {
                var parts = s.split(',');
                var vals = [];
                var p;
                for (p = 0; p < parts.length; p++) {
                    var x = parseNumber(parts[p]);
                    if (!isNaN(x)) vals.push(x);
                }
                return vals;
            }
            var one = parseNumber(s);
            return isNaN(one) ? [] : [one];
        }
        return [];
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
            if (ty + 80 > h) ty = y - 80;
            this._tooltip.style.left = Math.round(tx) + 'px';
            this._tooltip.style.top = Math.round(ty) + 'px';
        },

        updateView: function (data, config) {
            var root = this.el;
            if (!root) return;
            this._ensureUi(root);

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var fieldName = getOption(config, ns, 'field', 'value');
            var label = getOption(config, ns, 'label', '');
            var unit = getOption(config, ns, 'unit', '');
            var unitPos = getOption(config, ns, 'unitPosition', 'after');
            var decRaw = getOption(config, ns, 'decimals', '-1');
            var decimals = parseInt(decRaw, 10);
            if (isNaN(decimals)) decimals = -1;
            var valueColor = getOption(config, ns, 'valueColor', '#7B61FF');
            var showSparkStr = getOption(config, ns, 'showSparkline', 'false');
            var showSparkline = String(showSparkStr) === 'true' || showSparkStr === true;
            var sparklineField = getOption(config, ns, 'sparklineField', 'sparkline');
            var showDeltaStr = getOption(config, ns, 'showDelta', 'false');
            var showDelta = String(showDeltaStr) === 'true' || showDeltaStr === true;
            var deltaField = getOption(config, ns, 'deltaField', 'delta');
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
            var valueStr = formatValue(numVal, decimals);

            var deltaRaw = lastRowValue(data, deltaField);
            var deltaNum = parseNumber(deltaRaw);
            var hasDelta = showDelta && !isNaN(deltaNum);

            var sparkVals = showSparkline ? extractSparklineValues(data, sparklineField) : [];
            var hasSpark = sparkVals.length >= 2;

            var pad = Math.max(8, Math.min(w, h) * 0.04);
            var bottomReserve = hasSpark ? Math.max(28, h * 0.18) : pad;
            var centerY = (h - bottomReserve) * 0.5;

            if (showGlow && !isNaN(numVal)) {
                var grd = ctx.createRadialGradient(w * 0.5, centerY, 4, w * 0.5, centerY, Math.min(w, h) * 0.38);
                grd.addColorStop(0, theme.withAlpha(valueColor, 0.35));
                grd.addColorStop(0.45, theme.withAlpha(valueColor, 0.12));
                grd.addColorStop(1, theme.withAlpha(valueColor, 0));
                ctx.fillStyle = grd;
                ctx.fillRect(0, 0, w, h);
            }

            var unitStr = unit ? String(unit) : '';
            var mainText = valueStr;
            if (unitStr && unitPos === 'before') {
                mainText = unitStr + mainText;
            } else if (unitStr && unitPos === 'after') {
                mainText = mainText + unitStr;
            }

            var maxTextW = w - pad * 2 - (hasDelta ? 40 : 0);
            var startSize = Math.max(14, Math.min(72, Math.min(w, h) * 0.35));
            var valSize = theme.fitText(ctx, mainText, maxTextW, startSize, 14, theme.FONTS.mono);
            ctx.font = '600 ' + valSize + 'px ' + theme.FONTS.mono;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = valueColor;
            var tw = ctx.measureText(mainText).width;
            var groupW = tw + (hasDelta ? Math.max(10, Math.round(valSize * 0.28)) + 8 : 0);
            var bx = w * 0.5 - groupW * 0.5;
            ctx.textAlign = 'left';
            ctx.fillText(mainText, bx, centerY - 8);

            if (hasDelta) {
                var up = deltaNum > 0;
                var arr = up ? '\u25B2' : '\u25BC';
                var arrSize = Math.max(10, Math.round(valSize * 0.28));
                ctx.font = '600 ' + arrSize + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = up ? th.success : th.danger;
                ctx.fillText(arr, bx + tw + 8, centerY - 8);
            }
            ctx.textAlign = 'center';

            if (label) {
                var lblSize = Math.max(8, Math.min(20, Math.min(w, h) * 0.09));
                ctx.font = '500 ' + lblSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = th.textDim;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(label), w * 0.5, centerY + valSize * 0.55);
            }

            if (hasSpark) {
                var sx = pad;
                var sw = w - pad * 2;
                var sy = h - bottomReserve + 6;
                var sh = bottomReserve - 14;
                theme.drawSparkline(ctx, sparkVals, sx, sy, sw, sh, valueColor, 'area');
            }

            var tip = '<b>' + String(fieldName) + '</b><br/>' + valueStr;
            if (unitStr) tip += ' ' + String(unit);
            if (label) tip += '<br/><span style="opacity:0.8">' + String(label) + '</span>';
            if (hasDelta) tip += '<br/>' + String(deltaField) + ': ' + formatValue(deltaNum, decimals);
            if (showSparkline) tip += '<br/>' + String(sparklineField) + ': ' + sparkVals.length + ' pts';
            this._tipHtml = tip;
            if (this._hover && this._tooltip) {
                this._tooltip.innerHTML = this._tipHtml;
            }
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 10000 };
        },

        formatData: function (data) {
            return data;
        }
    });
});
