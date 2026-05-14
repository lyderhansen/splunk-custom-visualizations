/*
 * Netflix Trend Spark — mini sparkline trend card (Stranger Things neon aesthetic).
 * Multi-row time-series: all rows plot the sparkline; last row supplies the headline value.
 */
define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('shared/theme');

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
        } catch (e1) {}
        return '';
    }

    function fmtDisplayValue(raw, decimals, unit) {
        var displayValue;
        if (raw === null || raw === undefined || isNaN(raw)) {
            displayValue = '\u2014';
        } else if (decimals >= 0) {
            displayValue = theme.fmtNum(raw, { fixed: decimals });
        } else {
            displayValue = theme.fmtNum(raw, { compact: true });
        }
        if (unit && !(raw === null || raw === undefined || isNaN(raw))) {
            displayValue = displayValue + unit;
        }
        return displayValue;
    }

    function extractValues(rows, colIdx, fieldName) {
        var idx = colIdx[fieldName];
        if (idx === undefined) return [];
        var out = [];
        var r;
        for (r = 0; r < rows.length; r++) {
            var v = parseFloat(rows[r][idx]);
            out.push(isNaN(v) ? 0 : v);
        }
        return out;
    }

    function nearestIndex(mx, geom) {
        if (!geom || geom.n < 1) return -1;
        if (mx < geom.x || mx > geom.x + geom.w) return -1;
        if (geom.n === 1) return 0;
        var t = (mx - geom.x) / geom.w;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        return Math.round(t * (geom.n - 1));
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('netflix-viz-trend-spark');
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';

            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            var tip = document.createElement('div');
            tip.className = 'netflix-trend-spark-tooltip';
            tip.style.display = 'none';
            this.el.appendChild(tip);
            this._tooltip = tip;

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this._hoverIx = -1;
            this._sparkGeom = null;
            this._boundMove = this._onCanvasMove.bind(this);
            this._boundLeave = this._onCanvasLeave.bind(this);
            canvas.addEventListener('mousemove', this._boundMove);
            canvas.addEventListener('mouseleave', this._boundLeave);
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Netflix Trend Spark'
                );
            }
            var fields = data.fields;
            var colIdx = {};
            var i;
            for (i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }
            var result = { colIdx: colIdx, rows: data.rows };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!data) return;
            this._lastData = data;
            this._lastConfig = config;
            this._render(data, config);
        },

        _onCanvasMove: function(ev) {
            var rect = this.canvas.getBoundingClientRect();
            var mx = ev.clientX - rect.left;
            var my = ev.clientY - rect.top;
            var ix = this._hitTest(mx, my);
            var changed = ix !== this._hoverIx;
            this._hoverIx = ix;
            if (changed) {
                this.invalidateUpdateView();
            }
            this._positionTooltip(ev, ix);
        },

        _onCanvasLeave: function() {
            this._hoverIx = -1;
            if (this._tooltip) {
                this._tooltip.style.display = 'none';
            }
            this.invalidateUpdateView();
        },

        _positionTooltip: function(ev, ix) {
            var tip = this._tooltip;
            if (!tip) return;
            if (ix < 0 || !this._sparkGeom || !this._lastData) {
                tip.style.display = 'none';
                return;
            }
            var vals = this._sparkGeom.values;
            if (!vals || ix >= vals.length) {
                tip.style.display = 'none';
                return;
            }
            var ns = getNS(this);
            var cfg = this._lastConfig || {};
            var decimals = parseInt(getOption(cfg, ns, 'decimals', '2'), 10);
            var unit = getOption(cfg, ns, 'unit', '');
            var v = vals[ix];
            var txt = 'Index ' + (ix + 1) + ': ' + fmtDisplayValue(v, decimals, unit);
            tip.textContent = txt;
            tip.style.display = 'block';
            var rect = this.el.getBoundingClientRect();
            var lx = ev.clientX - rect.left + 12;
            var ly = ev.clientY - rect.top + 12;
            tip.style.left = lx + 'px';
            tip.style.top = ly + 'px';
        },

        _hideTooltip: function() {
            if (this._tooltip) this._tooltip.style.display = 'none';
        },

        _hitTest: function(cssX, cssY) {
            var g = this._sparkGeom;
            if (!g) return -1;
            if (cssY < g.y || cssY > g.y + g.h) return -1;
            return nearestIndex(cssX, g);
        },

        _render: function(data, config) {
            var el = this.el;
            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            var ns = getNS(this);
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));
            var fieldName = getOption(config, ns, 'field', 'value');
            var labelText = getOption(config, ns, 'label', '');
            var unit = getOption(config, ns, 'unit', '');
            var decimals = parseInt(getOption(config, ns, 'decimals', '2'), 10);
            var lineColor = getOption(config, ns, 'lineColor', '#E50914');
            var showArea = theme.parseBool(getOption(config, ns, 'showArea', 'true'), true);

            var rows = data.rows;
            var colIdx = data.colIdx;
            var values = extractValues(rows, colIdx, fieldName);
            if (values.length === 0) {
                ctx.fillStyle = t.textDim;
                ctx.font = '12px ' + theme.FONTS.ui;
                ctx.fillText('No numeric column: ' + fieldName, 12, 20);
                this._sparkGeom = null;
                return;
            }
            if (values.length === 1) {
                values.push(values[0]);
            }

            var lastVal = values[values.length - 1];
            var pad = Math.max(8, Math.min(w, h) * 0.04);
            theme.drawPanel(ctx, t, pad, pad, w - pad * 2, h - pad * 2);
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';

            var innerX = pad + 10;
            var innerY = pad + 10;
            var innerW = w - pad * 2 - 20;
            var innerH = h - pad * 2 - 20;

            if (labelText) {
                ctx.save();
                ctx.font = Math.max(9, Math.min(14, innerH * 0.08)) + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.text;
                ctx.globalAlpha = 0.55;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(labelText, innerX, innerY);
                ctx.globalAlpha = 1;
                ctx.restore();
            }

            var headlineY = innerY + (labelText ? innerH * 0.14 : innerH * 0.06);
            var sparkH = innerH * 0.38;
            var sparkY = innerY + innerH - sparkH;
            var sparkX = innerX;
            var sparkW = innerW;

            var cx = innerX + innerW / 2;
            var cy = headlineY + (sparkY - headlineY) * 0.45;
            var displayValue = fmtDisplayValue(lastVal, decimals, unit);
            var valSize = theme.fitText(ctx, displayValue, innerW * 0.92, Math.min(w, h) * 0.22, 14, theme.FONTS.mono);

            ctx.save();
            ctx.font = 'bold ' + valSize + 'px ' + theme.FONTS.mono;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = lineColor;
            ctx.shadowBlur = 16;
            ctx.fillStyle = t.text;
            ctx.fillText(displayValue, cx, cy);
            ctx.restore();
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';

            var sparkMode = showArea ? 'area' : 'line';
            theme.drawSparkline(ctx, values, sparkX, sparkY, sparkW, sparkH, lineColor, sparkMode);
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';

            this._sparkGeom = {
                x: sparkX,
                y: sparkY,
                w: sparkW,
                h: sparkH,
                n: values.length,
                values: values
            };

            var hix = this._hoverIx;
            if (hix >= 0 && hix < values.length && values.length >= 2) {
                var minV = Infinity;
                var maxV = -Infinity;
                var ii;
                for (ii = 0; ii < values.length; ii++) {
                    if (values[ii] < minV) minV = values[ii];
                    if (values[ii] > maxV) maxV = values[ii];
                }
                var rng = maxV - minV || 1;
                var step = sparkW / (values.length - 1);
                var px = sparkX + hix * step;
                var py = sparkY + sparkH - ((values[hix] - minV) / rng) * sparkH;

                ctx.save();
                ctx.strokeStyle = theme.withAlpha(t.text, 0.35);
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(px, sparkY);
                ctx.lineTo(px, sparkY + sparkH);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();

                ctx.save();
                ctx.fillStyle = t.panel;
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(px, py, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
                ctx.shadowBlur = 0;
            }
        },

        reflow: function() {
            if (this._lastData && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }
        },

        destroy: function() {
            if (this.canvas && this._boundMove) {
                this.canvas.removeEventListener('mousemove', this._boundMove);
                this.canvas.removeEventListener('mouseleave', this._boundLeave);
            }
            if (this._tooltip && this._tooltip.parentNode) {
                this._tooltip.parentNode.removeChild(this._tooltip);
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
