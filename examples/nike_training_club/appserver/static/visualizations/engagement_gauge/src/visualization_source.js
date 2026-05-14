/*
 * Nike Training Club — Engagement Gauge
 * 270-degree arc gauge with volt energy styling.
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
        this.el.addEventListener('mousemove', function(e) { self._onHover(e); });
        this.el.addEventListener('mouseleave', function() { self._tooltip.style.display = 'none'; });
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
        var targetField = theme.getOption(config, ns, 'targetField', 'target');
        var labelField = theme.getOption(config, ns, 'labelField', 'metric');
        var maxValue = theme.parseNum(theme.getOption(config, ns, 'maxValue', '100'), 100);
        var decimals = theme.parseNum(theme.getOption(config, ns, 'decimals', '0'), 0);
        var unitStr = theme.getOption(config, ns, 'unit', '%');
        var unitPosition = theme.getOption(config, ns, 'unitPosition', 'after');
        var accentColor = theme.getOption(config, ns, 'accentColor', t.accent);

        var setup = theme.setupCanvas(this.el);
        var ctx = setup.ctx;
        var w = setup.w;
        var h = setup.h;
        this._canvas = setup.canvas;

        ctx.clearRect(0, 0, w, h);

        var row = data.rows[0];
        var ci = data.colIdx;
        var value = ci[valueField] !== undefined ? parseFloat(row[ci[valueField]]) : 0;
        var target = ci[targetField] !== undefined ? parseFloat(row[ci[targetField]]) : NaN;
        var label = ci[labelField] !== undefined ? String(row[ci[labelField]]) : '';

        if (isNaN(value)) value = 0;
        var pct = Math.min(value / maxValue, 1);

        // Arc geometry
        var cx = w / 2;
        var cy = h * 0.52;
        var radius = Math.max(30, Math.min(w, h) * 0.35);
        var lineWidth = Math.max(6, radius * 0.12);
        var startAngle = Math.PI * 0.75;   // 135 degrees
        var totalArc = Math.PI * 1.5;       // 270 degrees
        var endAngle = startAngle + totalArc;
        var valueAngle = startAngle + totalArc * pct;

        // Track (unfilled)
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.strokeStyle = t.name === 'dark' ? '#2A2A2A' : 'rgba(0,0,0,0.08)';
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Filled arc — volt or danger if below target
        var belowTarget = !isNaN(target) && value < (target - 10);
        var arcColor = belowTarget ? t.danger : accentColor;

        // Glow
        if (gi > 0) {
            ctx.save();
            ctx.shadowBlur = 12 * gi;
            ctx.shadowColor = theme.withAlpha(arcColor, 0.5 * gi);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, valueAngle, false);
            ctx.strokeStyle = arcColor;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        } else {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, valueAngle, false);
            ctx.strokeStyle = arcColor;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // Target tick
        if (!isNaN(target)) {
            var tPct = Math.min(target / maxValue, 1);
            var tAngle = startAngle + totalArc * tPct;
            var tickInner = radius - lineWidth * 0.8;
            var tickOuter = radius + lineWidth * 0.8;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(tAngle) * tickInner, cy + Math.sin(tAngle) * tickInner);
            ctx.lineTo(cx + Math.cos(tAngle) * tickOuter, cy + Math.sin(tAngle) * tickOuter);
            ctx.strokeStyle = t.text;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // Center value
        var valSize = Math.max(18, Math.round(radius * 0.55));
        var displayVal = theme.fmtNum(value, { decimals: decimals });
        ctx.font = '800 ' + valSize + 'px ' + theme.FONTS.ui;
        ctx.fillStyle = t.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayVal, cx, cy - valSize * 0.1);

        // Unit next to value
        if (unitStr) {
            var unitSize = Math.max(10, Math.round(valSize * 0.35));
            ctx.font = '600 ' + unitSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = accentColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(unitStr, cx, cy + valSize * 0.35);
        }

        // Label below
        if (label) {
            var lblSize = Math.max(7, Math.round(radius * 0.10));
            ctx.font = '500 ' + lblSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            var lblText = label.toUpperCase();
            var lx = cx - (lblText.length * (lblSize * 0.5 + 2)) / 2;
            var ly = cy + radius + lineWidth + 8;
            for (var i = 0; i < lblText.length; i++) {
                ctx.fillText(lblText[i], lx, ly);
                lx += ctx.measureText(lblText[i]).width + 2;
            }
        }
    },

    _onHover: function(e) {
        if (!this._lastData || !this._lastData.rows) return;
        var ns = theme.getNS(this);
        var config = this._lastConfig || {};
        var valueField = theme.getOption(config, ns, 'valueField', 'value');
        var labelField = theme.getOption(config, ns, 'labelField', 'metric');
        var row = this._lastData.rows[0];
        var ci = this._lastData.colIdx;
        var val = ci[valueField] !== undefined ? row[ci[valueField]] : '';
        var label = ci[labelField] !== undefined ? row[ci[labelField]] : '';
        this._tooltip.textContent = label + ': ' + val + '%';
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
