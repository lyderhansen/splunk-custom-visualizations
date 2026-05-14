/*
 * Nike Training Club — KPI Tile
 * Bold single-value with trend delta and optional sparkline.
 * ES5 only. Canvas 2D. No jQuery.
 */
var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var theme = require('shared/theme');

module.exports = SplunkVisualizationBase.extend({

    initialize: function() {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.style.overflow = 'hidden';
        this._tooltip = document.createElement('div');
        this._tooltip.style.cssText =
            'position:absolute;display:none;padding:6px 10px;' +
            'background:rgba(0,0,0,0.90);color:#fff;font-size:12px;' +
            'border-radius:3px;pointer-events:none;white-space:nowrap;' +
            'z-index:100;font-family:' + theme.FONTS.ui + ';';
        this.el.style.position = 'relative';
        this.el.appendChild(this._tooltip);
        var self = this;
        this.el.addEventListener('mousemove', function(e) {
            self._onHover(e);
        });
        this.el.addEventListener('mouseleave', function() {
            self._tooltip.style.display = 'none';
        });
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
            return data;
        }
        var fields = data.fields;
        var colIdx = {};
        for (var i = 0; i < fields.length; i++) {
            colIdx[fields[i].name] = i;
        }
        var result = { colIdx: colIdx, rows: data.rows };
        this._lastGoodData = result;
        return result;
    },

    updateView: function(data, config) {
        if (!data || !data.colIdx) return;
        this._lastData = data;
        this._lastConfig = config;
        this._render(data, config);
    },

    _render: function(data, config) {
        var ns = theme.getNS(this);
        var t = theme.getTheme(theme.getOption(config, ns, 'theme', 'dark'));
        var gi = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '50'), 50) / 50;

        var valueField = theme.getOption(config, ns, 'valueField', 'value');
        var labelField = theme.getOption(config, ns, 'labelField', 'metric');
        var trendField = theme.getOption(config, ns, 'trendField', 'delta');
        var unitField = theme.getOption(config, ns, 'unitField', 'unit');
        var sparklineField = theme.getOption(config, ns, 'sparklineField', 'sparkline');
        var decimals = theme.parseNum(theme.getOption(config, ns, 'decimals', '0'), 0);
        var unitPosition = theme.getOption(config, ns, 'unitPosition', 'after');
        var accentColor = theme.getOption(config, ns, 'accentColor', t.accent);

        var setup = theme.setupCanvas(this.el);
        var ctx = setup.ctx;
        var w = setup.w;
        var h = setup.h;
        this._canvas = setup.canvas;

        ctx.clearRect(0, 0, w, h);

        // Panel chrome — 2px volt left bar
        ctx.fillStyle = t.panel;
        theme.roundRect(ctx, 0, 0, w, h, 2);
        ctx.fill();
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 2, 2, h - 4);

        var row = data.rows[0];
        var ci = data.colIdx;

        var rawVal = ci[valueField] !== undefined ? row[ci[valueField]] : '';
        var label = ci[labelField] !== undefined ? row[ci[labelField]] : '';
        var trendVal = ci[trendField] !== undefined ? parseFloat(row[ci[trendField]]) : NaN;
        var unit = ci[unitField] !== undefined ? row[ci[unitField]] : '';
        var sparkRaw = ci[sparklineField] !== undefined ? row[ci[sparklineField]] : '';

        // Format value
        var numVal = parseFloat(rawVal);
        var displayValue;
        if (!isNaN(numVal)) {
            displayValue = theme.fmtNum(numVal, { compact: numVal >= 10000, decimals: decimals });
        } else {
            displayValue = String(rawVal);
        }

        // Unit
        var fullValue;
        if (unit && unitPosition === 'before') {
            fullValue = unit + displayValue;
        } else if (unit) {
            fullValue = displayValue + unit;
        } else {
            fullValue = displayValue;
        }

        // Layout
        var pad = Math.max(8, Math.round(w * 0.06));
        var valSize = Math.max(18, Math.round(h * 0.35));
        var labelSize = Math.max(7, Math.round(h * 0.08));
        var trendSize = Math.max(8, Math.round(h * 0.10));

        // Value
        ctx.font = '800 ' + valSize + 'px ' + theme.FONTS.ui;
        ctx.fillStyle = t.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        var valY = h * 0.38;
        ctx.fillText(fullValue, pad + 6, valY);

        // Label (ALL CAPS, letter-spaced)
        ctx.font = '500 ' + labelSize + 'px ' + theme.FONTS.ui;
        ctx.fillStyle = t.textDim;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        var labelY = valY + valSize * 0.45;
        // Manual letter-spacing
        var labelText = String(label).toUpperCase();
        var lx = pad + 6;
        var spacing = 2;
        for (var li = 0; li < labelText.length; li++) {
            ctx.fillText(labelText[li], lx, labelY);
            lx += ctx.measureText(labelText[li]).width + spacing;
        }

        // Trend arrow + delta
        if (!isNaN(trendVal) && trendVal !== 0) {
            var isUp = trendVal > 0;
            var trendColor = isUp ? accentColor : t.danger;
            var arrow = isUp ? '▲' : '▼';
            var trendText = arrow + ' ' + Math.abs(trendVal).toFixed(1) + '%';

            ctx.font = '600 ' + trendSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = trendColor;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(trendText, w - pad, valY);
        }

        // Sparkline
        if (sparkRaw) {
            var sparkVals = String(sparkRaw).split(',');
            var sparkNums = [];
            for (var si = 0; si < sparkVals.length; si++) {
                var sv = parseFloat(sparkVals[si]);
                if (!isNaN(sv)) sparkNums.push(sv);
            }
            if (sparkNums.length > 1) {
                var sparkH = Math.max(12, h * 0.15);
                var sparkY = h - sparkH - 4;
                var sparkW = w - pad * 2 - 12;
                var sparkMin = sparkNums[0];
                var sparkMax = sparkNums[0];
                for (var sk = 1; sk < sparkNums.length; sk++) {
                    if (sparkNums[sk] < sparkMin) sparkMin = sparkNums[sk];
                    if (sparkNums[sk] > sparkMax) sparkMax = sparkNums[sk];
                }
                var sparkRange = sparkMax - sparkMin || 1;

                ctx.beginPath();
                for (var sp = 0; sp < sparkNums.length; sp++) {
                    var sx = pad + 6 + (sp / (sparkNums.length - 1)) * sparkW;
                    var sy = sparkY + sparkH - ((sparkNums[sp] - sparkMin) / sparkRange) * sparkH;
                    if (sp === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                }
                ctx.strokeStyle = theme.withAlpha(accentColor, 0.6 * gi);
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        // Glow on accent bar
        if (gi > 0) {
            ctx.save();
            ctx.shadowBlur = 8 * gi;
            ctx.shadowColor = theme.withAlpha(accentColor, 0.4 * gi);
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 0;
            ctx.fillStyle = accentColor;
            ctx.fillRect(0, 2, 2, h - 4);
            ctx.restore();
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }
    },

    _onHover: function(e) {
        if (!this._lastData || !this._lastData.rows) return;
        var ns = theme.getNS(this);
        var config = this._lastConfig || {};
        var labelField = theme.getOption(config, ns, 'labelField', 'metric');
        var valueField = theme.getOption(config, ns, 'valueField', 'value');
        var row = this._lastData.rows[0];
        var ci = this._lastData.colIdx;
        var label = ci[labelField] !== undefined ? row[ci[labelField]] : '';
        var val = ci[valueField] !== undefined ? row[ci[valueField]] : '';
        this._tooltip.textContent = label + ': ' + val;
        this._tooltip.style.display = 'block';
        var rect = this.el.getBoundingClientRect();
        this._tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
        this._tooltip.style.top = (e.clientY - rect.top - 8) + 'px';
    },

    reflow: function() {
        if (this._lastData && this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    destroy: function() {
        if (this._tooltip && this._tooltip.parentNode) {
            this._tooltip.parentNode.removeChild(this._tooltip);
        }
        SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
    }
});
