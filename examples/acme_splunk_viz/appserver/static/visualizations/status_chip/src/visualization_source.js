/*
 * ACME Status Chip — compact pill indicator.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-status-chip-viz');
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
            var variant = config[ns + 'variant'] || 'header';
            var label = config[ns + 'label'] || 'Notables';
            var valueField = config[ns + 'valueField'] || 'value';
            var color = config[ns + 'color'] || '#ff6600';
            // Expanded
            var fontSize = parseInt(config[ns + 'fontSize'] || '13', 10);
            var labelFontSize = parseInt(config[ns + 'labelFontSize'] || '12', 10);
            var dotSize = parseFloat(config[ns + 'dotSize'] || '4');
            var paddingX = parseInt(config[ns + 'paddingX'] || '12', 10);
            var paddingY = parseInt(config[ns + 'paddingY'] || '7', 10);
            var borderRadius = parseFloat(config[ns + 'borderRadius'] || '0');
            var alignH = config[ns + 'alignH'] || 'center';
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var labelColor = config[ns + 'labelColor'] || '';
            var valueColor = config[ns + 'valueColor'] || '';

            var t = T.getTheme(themeName);
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

            var valueText = '';
            if (data.row) {
                var idx = -1;
                for (var i = 0; i < data.fields.length; i++) {
                    if (data.fields[i] === valueField) { idx = i; break; }
                }
                if (idx >= 0) valueText = String(data.row[idx]);
            }
            if (!valueText) valueText = '0';

            var labelFont = '500 ' + labelFontSize + 'px ' + T.FONTS.ui;
            var valueFont = '600 ' + fontSize + 'px ' + T.FONTS.mono;

            ctx.font = labelFont;
            var labelW = ctx.measureText(label).width;
            ctx.font = valueFont;
            var valueW = ctx.measureText(valueText).width;

            var defaultRadius = (variant === 'badge') ? 3 : 4;
            var radius = borderRadius > 0 ? borderRadius : defaultRadius;
            var contentW = (variant === 'badge') ? labelW : (dotSize * 2 + 8 + labelW + 8 + valueW);
            var pillW = contentW + paddingX * 2;
            var pillH = Math.max(20, fontSize + paddingY * 2);
            var x = alignH === 'left' ? 10 : alignH === 'right' ? rect.width - pillW - 10 : (rect.width - pillW) / 2;
            var y = (rect.height - pillH) / 2;

            T.roundRect(ctx, x, y, pillW, pillH, radius);

            if (variant === 'header') {
                ctx.fillStyle = t.panel;
                ctx.fill();
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x + paddingX + dotSize, y + pillH / 2, dotSize, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = labelColor || t.textDim;
                ctx.font = labelFont;
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x + paddingX + dotSize * 2 + 8, y + pillH / 2);
                ctx.fillStyle = valueColor || t.text;
                ctx.font = valueFont;
                ctx.fillText(valueText, x + paddingX + dotSize * 2 + 8 + labelW + 8, y + pillH / 2);
            } else if (variant === 'badge') {
                ctx.fillStyle = color;
                ctx.fill();
                ctx.fillStyle = valueColor || '#ffffff';
                ctx.font = '600 ' + (labelFontSize - 1) + 'px ' + T.FONTS.ui;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                ctx.fillText(label, x + pillW / 2, y + pillH / 2);
                ctx.textAlign = 'start';
            } else {
                ctx.fillStyle = T.withAlpha(color, 0.13);
                ctx.fill();
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x + paddingX + dotSize, y + pillH / 2, dotSize, 0, Math.PI * 2);
                ctx.fill();
                ctx.font = labelFont;
                ctx.textBaseline = 'middle';
                ctx.fillStyle = labelColor || color;
                ctx.fillText(label, x + paddingX + dotSize * 2 + 8, y + pillH / 2);
                ctx.fillStyle = valueColor || t.text;
                ctx.font = valueFont;
                ctx.fillText(valueText, x + paddingX + dotSize * 2 + 8 + labelW + 8, y + pillH / 2);
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
