/*
 * Sparkline — Splunk Custom Visualization
 *
 * Embedded micro-trend line. Pure SVG-style line on Canvas.
 * Chrome-free — no axes, no labels, no markers.
 *
 * Expected SPL: timechart count
 * First column is _time (ignored), second+ are values.
 * Uses the LAST numeric column or a configurable field.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var tokens = require('shared/tokens');


    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-sparkline-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data, config) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Sparkline'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            var result = {
                colIdx: colIdx,
                fields: fields,
                rows: data.rows
            };

            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            var el = this.el;
            var rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            var ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            var w = rect.width;
            var h = rect.height;

            // Read config
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var color = (config[ns + 'color'] || '#2bbfb8');
            var strokeWidth = parseFloat(config[ns + 'strokeWidth'] || '1.5');
            var showFill = (config[ns + 'showFill'] || 'true') === 'true';
            var fieldName = (config[ns + 'field'] || 'count');

            // Determine column index for the field
            var colIdx = data.colIdx;
            var rows = data.rows;
            var valIdx;

            if (colIdx[fieldName] !== undefined) {
                valIdx = colIdx[fieldName];
            } else {
                // Fall back to the last numeric column
                var fields = data.fields;
                valIdx = -1;
                for (var i = fields.length - 1; i >= 0; i--) {
                    var testVal = parseFloat(rows[0][i]);
                    if (!isNaN(testVal)) {
                        valIdx = i;
                        break;
                    }
                }
                if (valIdx === -1) return;
            }

            // Extract numeric values
            var values = [];
            for (var r = 0; r < rows.length; r++) {
                var v = parseFloat(rows[r][valIdx]);
                values.push(isNaN(v) ? 0 : v);
            }

            // Edge case: 0 data points
            if (values.length === 0) return;

            // Clear canvas
            ctx.clearRect(0, 0, w, h);

            // Compute Y range
            var minVal = values[0];
            var maxVal = values[0];
            for (var i = 1; i < values.length; i++) {
                if (values[i] < minVal) minVal = values[i];
                if (values[i] > maxVal) maxVal = values[i];
            }
            var yRange = maxVal - minVal;

            // Padding inside the canvas for the stroke
            var padX = strokeWidth;
            var padY = strokeWidth + 1;
            var plotW = w - padX * 2;
            var plotH = h - padY * 2;

            // Build point coordinates
            var n = values.length;
            var pts = [];

            if (n === 1 || yRange === 0) {
                // Flat line at midpoint
                var midY = padY + plotH / 2;
                if (n === 1) {
                    pts.push({ x: padX, y: midY });
                    pts.push({ x: padX + plotW, y: midY });
                } else {
                    for (var i = 0; i < n; i++) {
                        var px = padX + (n > 1 ? (i / (n - 1)) * plotW : 0);
                        pts.push({ x: px, y: midY });
                    }
                }
            } else {
                for (var i = 0; i < n; i++) {
                    var px = padX + (n > 1 ? (i / (n - 1)) * plotW : 0);
                    var ratio = (values[i] - minVal) / yRange;
                    var py = padY + plotH - ratio * plotH;
                    pts.push({ x: px, y: py });
                }
            }

            // Parse color for gradient
            var colorRgb = tokens.hexToRgb(color);

            // Draw area fill (gradient below the line)
            if (showFill && pts.length >= 2) {
                var grad = ctx.createLinearGradient(0, padY, 0, padY + plotH);
                grad.addColorStop(0, 'rgba(' + colorRgb.r + ',' + colorRgb.g + ',' + colorRgb.b + ',0.22)');
                grad.addColorStop(1, 'rgba(' + colorRgb.r + ',' + colorRgb.g + ',' + colorRgb.b + ',0)');

                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (var i = 1; i < pts.length; i++) {
                    ctx.lineTo(pts[i].x, pts[i].y);
                }
                ctx.lineTo(pts[pts.length - 1].x, padY + plotH);
                ctx.lineTo(pts[0].x, padY + plotH);
                ctx.closePath();
                ctx.fillStyle = grad;
                ctx.fill();
            }

            // Draw the line
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (var i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = strokeWidth;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
