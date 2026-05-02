/*
 * ACME Ring Gauge — radial gauge.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-ring-gauge-viz');
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.el.appendChild(this.canvas);
            this._lastGoodData = null;
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 50 };
        },

        formatData: function (data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                return { fields: [], row: null };
            }
            var fields = [];
            for (var i = 0; i < data.fields.length; i++) fields.push(data.fields[i].name);
            var result = { fields: fields, row: data.rows[data.rows.length - 1] };
            this._lastGoodData = result;
            return result;
        },

        updateView: function (data, config) {
            if (!data) data = this._lastGoodData || { fields: [], row: null };

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = config[ns + 'theme'] || 'dark';
            var t = T.getTheme(themeName);
            var fieldName = config[ns + 'field'] || 'value';
            var max = parseFloat(config[ns + 'max'] || '100');
            var minVal = parseFloat(config[ns + 'min'] || '0');
            var thick = parseFloat(config[ns + 'thick'] || '11');
            var label = config[ns + 'label'] || '';
            var sub = config[ns + 'sub'] || '';
            var color = config[ns + 'color'] || t.orange;
            var half = String(config[ns + 'half'] || 'false') === 'true';
            var showLegend = String(config[ns + 'showLegend'] || 'true') !== 'false';
            var unit = config[ns + 'unit'] || '';
            // Expanded
            var trackColor = config[ns + 'trackColor'] || '';
            var valueFontSize = parseInt(config[ns + 'valueFontSize'] || '0', 10);
            var labelFontSize = parseInt(config[ns + 'labelFontSize'] || '13', 10);
            var subFontSize = parseInt(config[ns + 'subFontSize'] || '11', 10);
            var labelColor = config[ns + 'labelColor'] || t.textDim;
            var valueColor = config[ns + 'valueColor'] || t.text;
            var precision = parseInt(config[ns + 'precision'] || '0', 10);
            var displayMode = config[ns + 'displayMode'] || 'auto';
            var legendLow = config[ns + 'legendLow'] || 'Low 0–39';
            var legendMed = config[ns + 'legendMed'] || 'Med 40–69';
            var legendHigh = config[ns + 'legendHigh'] || 'High 70+';
            var legendLowColor = config[ns + 'legendLowColor'] || t.success;
            var legendMedColor = config[ns + 'legendMedColor'] || t.warn;
            var legendHighColor = config[ns + 'legendHighColor'] || t.danger;
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var lineCap = config[ns + 'lineCap'] || 'round';

            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, rect.width, rect.height);
            if (bgColor && bgColor !== 'transparent') { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, rect.width, rect.height); }

            var value = 0;
            if (data.row) {
                var idx = -1;
                for (var i = 0; i < data.fields.length; i++) {
                    if (data.fields[i] === fieldName) { idx = i; break; }
                }
                if (idx >= 0) {
                    var v = parseFloat(data.row[idx]);
                    if (!isNaN(v)) value = v;
                }
            }
            var span = max - minVal;
            var pct = span > 0 ? Math.max(0, Math.min(1, (value - minVal) / span)) : 0;

            var labelH = label ? 22 : 0;
            var legendH = showLegend ? 64 : 0;
            var availH = rect.height - labelH - legendH - 12;
            var size = Math.min(rect.width - 24, availH * (half ? 1.6 : 1));
            if (size < 60) size = 60;
            var radius = size / 2;
            var cx = rect.width / 2;
            var cy = labelH + 12 + radius;

            if (label) {
                ctx.fillStyle = labelColor;
                ctx.font = '600 ' + labelFontSize + 'px ' + T.FONTS.ui;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(label, cx, 4);
            }

            ctx.lineCap = lineCap;
            ctx.lineWidth = thick;

            if (half) {
                ctx.strokeStyle = trackColor || t.edge;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, Math.PI, 0, false);
                ctx.stroke();
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * pct, false);
                ctx.stroke();
            } else {
                ctx.strokeStyle = trackColor || t.edge;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct, false);
                ctx.stroke();
            }

            var bigSize = valueFontSize > 0 ? valueFontSize : Math.max(14, Math.round(size * 0.24));
            ctx.fillStyle = valueColor;
            ctx.font = '600 ' + bigSize + 'px ' + T.FONTS.mono;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            var bigText;
            if (displayMode === 'percent' || (displayMode === 'auto' && minVal === 0 && max === 100 && !unit)) {
                bigText = Math.round(value) + '%';
            } else if (displayMode === 'fixed') {
                bigText = parseFloat(value).toFixed(precision) + (unit || '');
            } else {
                bigText = T.fmtNum(value, { compact: false }) + (unit || '');
            }
            ctx.fillText(bigText, cx, cy + (half ? -radius * 0.25 : 0));

            if (sub) {
                ctx.fillStyle = labelColor;
                ctx.font = '500 ' + subFontSize + 'px ' + T.FONTS.ui;
                ctx.fillText(sub, cx, cy + (half ? -radius * 0.05 : bigSize * 0.65));
            }

            if (showLegend) {
                var legY = rect.height - legendH + 6;
                var rows = [
                    { color: legendLowColor, label: legendLow },
                    { color: legendMedColor, label: legendMed },
                    { color: legendHighColor, label: legendHigh }
                ];
                ctx.font = '500 11px ' + T.FONTS.ui;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                for (var rr = 0; rr < rows.length; rr++) {
                    var ry = legY + rr * 18;
                    var lx = (rect.width - 96) / 2;
                    ctx.fillStyle = rows[rr].color;
                    ctx.beginPath();
                    ctx.arc(lx, ry + 6, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = labelColor;
                    ctx.fillText(rows[rr].label, lx + 12, ry + 6);
                }
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
