/*
 * Disney+ Content Donut — Splunk Custom Visualization
 *
 * Part-to-whole donut with Disney+ palette and right-side legend.
 * Expected: category (string), value (number).
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

    var DISNEY_PALETTE = [
        '#0063E5', '#0080FF', '#4DA3FF', '#A78BFA',
        '#2BBFB8', '#FF6600', '#F73873'
    ];

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
                count: 10000
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Disney+ Donut'
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

            var catField = getOption(config, ns, 'categoryField', 'category');
            var valField = getOption(config, ns, 'valueField', 'value');
            var showLegend = getOption(config, ns, 'showLegend', 'true');
            var showTotal = getOption(config, ns, 'showTotal', 'true');
            var colors = theme.parseColors(
                getOption(config, ns, 'colors', ''),
                DISNEY_PALETTE
            );

            // Parse data
            var colIdx = data.colIdx;
            var items = [];
            var total = 0;
            for (var i = 0; i < data.rows.length; i++) {
                var row = data.rows[i];
                var cat = (colIdx[catField] !== undefined)
                    ? String(row[colIdx[catField]])
                    : 'Unknown';
                var val = (colIdx[valField] !== undefined)
                    ? parseFloat(row[colIdx[valField]])
                    : 0;
                if (isNaN(val)) val = 0;
                items.push({ category: cat, value: val });
                total += val;
            }

            // Panel chrome
            theme.drawPanel(ctx, t, 0, 0, w, h);

            // Layout: donut on left, legend on right
            var legendW = (showLegend === 'true') ? Math.min(200, w * 0.4) : 0;
            var donutAreaW = w - legendW;
            var cx = donutAreaW / 2;
            var cy = h / 2;
            var outerR = Math.min(donutAreaW, h) * 0.38;
            var innerR = outerR * 0.6;

            // Draw donut segments
            var angle = -Math.PI / 2;
            for (var j = 0; j < items.length; j++) {
                var slice = (total > 0) ? (items[j].value / total) * Math.PI * 2 : 0;
                if (slice < 0.001) continue;
                var color = colors[j % colors.length];

                ctx.beginPath();
                ctx.arc(cx, cy, outerR, angle, angle + slice);
                ctx.arc(cx, cy, innerR, angle + slice, angle, true);
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();

                // Thin separator
                ctx.strokeStyle = t.panel;
                ctx.lineWidth = 2;
                ctx.stroke();

                angle += slice;
            }

            // Center total
            if (showTotal === 'true') {
                var totalStr = theme.fmtNum(total, { compact: true });
                var totalSize = Math.max(12, Math.min(36, innerR * 0.45));
                ctx.font = 'bold ' + totalSize + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(totalStr, cx, cy - totalSize * 0.2);

                var subSize = Math.max(8, totalSize * 0.4);
                ctx.font = subSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.fillText('TOTAL', cx, cy + totalSize * 0.5);
            }

            // Legend
            if (showLegend === 'true' && items.length > 0) {
                var legendX = donutAreaW + 12;
                var lineH = Math.max(18, Math.min(28, h / (items.length + 1)));
                var legendStartY = Math.max(16, (h - items.length * lineH) / 2);
                var dotR = Math.max(4, lineH * 0.2);
                var labelSize = Math.max(9, Math.min(13, lineH * 0.5));

                for (var k = 0; k < items.length; k++) {
                    var ly = legendStartY + k * lineH;
                    var lColor = colors[k % colors.length];

                    // Color dot
                    ctx.beginPath();
                    ctx.arc(legendX + dotR, ly + lineH / 2, dotR, 0, Math.PI * 2);
                    ctx.fillStyle = lColor;
                    ctx.fill();

                    // Category name
                    ctx.font = labelSize + 'px ' + theme.FONTS.ui;
                    ctx.fillStyle = t.text;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(items[k].category, legendX + dotR * 3, ly + lineH / 2);

                    // Value right-aligned
                    var valStr = theme.fmtNum(items[k].value, { compact: true });
                    ctx.font = labelSize + 'px ' + theme.FONTS.mono;
                    ctx.fillStyle = t.textDim;
                    ctx.textAlign = 'right';
                    ctx.fillText(valStr, w - 12, ly + lineH / 2);
                }
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
