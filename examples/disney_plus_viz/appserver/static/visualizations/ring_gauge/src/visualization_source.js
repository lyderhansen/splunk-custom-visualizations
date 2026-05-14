/*
 * Disney+ Ring Gauge — Splunk Custom Visualization
 *
 * Arc gauge with Disney+ gradient coloring and center value.
 * Expected: value (0–maxValue), optional label.
 */
define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('../../shared/theme');

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

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;
            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 50
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Disney+ Gauge'
                );
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
            if (!data) return;
            this._lastData = data;
            this._lastConfig = config;
            this._render(data, config);
        },

        _render: function(data, config) {
            var el = this.el;
            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            var ns = getNS(this);
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));

            var valueField = getOption(config, ns, 'field', 'value');
            var maxValue = parseFloat(getOption(config, ns, 'maxValue', '100'));
            var unit = getOption(config, ns, 'unit', '%');
            var label = getOption(config, ns, 'label', '');
            var accentColor = getOption(config, ns, 'accentColor', t.accent);
            var showGlow = getOption(config, ns, 'showGlow', 'true');

            var row = data.rows[data.rows.length - 1];
            var colIdx = data.colIdx;
            var rawValue = (colIdx[valueField] !== undefined)
                ? parseFloat(row[colIdx[valueField]])
                : 0;
            if (isNaN(rawValue)) rawValue = 0;
            var pct = Math.max(0, Math.min(1, rawValue / maxValue));

            // Panel chrome
            theme.drawPanel(ctx, t, 0, 0, w, h);

            // Arc geometry
            var cx = w / 2;
            var cy = h * 0.52;
            var radius = Math.min(w, h) * 0.34;
            var lineWidth = radius * 0.16;
            var startAngle = Math.PI * 0.75;
            var endAngle = Math.PI * 2.25;
            var valueAngle = startAngle + (endAngle - startAngle) * pct;

            // Glow behind arc
            if (showGlow === 'true' && pct > 0.01) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAngle, valueAngle);
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = lineWidth + 8;
                ctx.lineCap = 'round';
                ctx.shadowColor = accentColor;
                ctx.shadowBlur = 16;
                ctx.globalAlpha = 0.3;
                ctx.stroke();
                ctx.restore();
                ctx.shadowBlur = 0;
                ctx.shadowColor = 'transparent';
            }

            // Background track
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.strokeStyle = t.edge;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Value arc with gradient
            if (pct > 0.01) {
                var grad = ctx.createLinearGradient(
                    cx - radius, cy, cx + radius, cy
                );
                grad.addColorStop(0, accentColor);
                grad.addColorStop(1, theme.lerpColor(accentColor, '#A78BFA', 0.4));
                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAngle, valueAngle);
                ctx.strokeStyle = grad;
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.stroke();
            }

            // Center value
            var displayVal = theme.fmtNum(rawValue, { compact: true });
            if (unit) displayVal = displayVal + unit;
            var valSize = Math.max(14, Math.min(48, radius * 0.5));
            ctx.font = 'bold ' + valSize + 'px ' + theme.FONTS.mono;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayVal, cx, cy);

            // Label below
            if (label) {
                var labelSize = Math.max(8, Math.min(16, radius * 0.18));
                ctx.font = labelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.fillText(label, cx, cy + radius * 0.5 + labelSize);
            }
        },

        reflow: function() {
            if (this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
