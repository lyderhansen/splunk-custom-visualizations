/*
 * ACME Sparkline — chrome-free micro-trend.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-sparkline-viz');
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.el.appendChild(this.canvas);
            this._lastGoodData = null;
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 10000 };
        },

        formatData: function (data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                return { fields: [], rows: [] };
            }
            var fields = [];
            for (var i = 0; i < data.fields.length; i++) fields.push(data.fields[i].name);
            var result = { fields: fields, rows: data.rows.slice() };
            this._lastGoodData = result;
            return result;
        },

        updateView: function (data, config) {
            if (!data) data = this._lastGoodData || { fields: [], rows: [] };

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = config[ns + 'theme'] || 'dark';
            var fieldName = config[ns + 'field'] || 'count';
            var color = config[ns + 'color'] || '#2bbfb8';
            var fill = String(config[ns + 'fill'] || 'true') !== 'false';
            var strokeWidth = parseFloat(config[ns + 'strokeWidth'] || '1.5');
            // Expanded settings
            var padding = parseFloat(config[ns + 'padding'] || '2');
            var showMarkers = String(config[ns + 'showMarkers'] || 'false') === 'true';
            var markerSize = parseFloat(config[ns + 'markerSize'] || '3');
            var smooth = String(config[ns + 'smooth'] || 'false') === 'true';
            var fillOpacity = parseFloat(config[ns + 'fillOpacity'] || '0.22');
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var lineCap = config[ns + 'lineCap'] || 'round';
            var showLastDot = String(config[ns + 'showLastDot'] || 'false') === 'true';
            var lastDotColor = config[ns + 'lastDotColor'] || color;

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

            if (bgColor && bgColor !== 'transparent') {
                ctx.fillStyle = bgColor;
                ctx.fillRect(0, 0, rect.width, rect.height);
            }

            var values = [];
            var idx = -1;
            for (var i = 0; i < data.fields.length; i++) {
                if (data.fields[i] === fieldName) { idx = i; break; }
            }
            if (idx < 0 && data.fields.length) {
                for (var j = 0; j < data.fields.length; j++) {
                    var name = data.fields[j];
                    if (name !== '_time' && name !== '_span') { idx = j; break; }
                }
            }
            if (idx >= 0) {
                for (var k = 0; k < data.rows.length; k++) {
                    var v = parseFloat(data.rows[k][idx]);
                    if (!isNaN(v)) values.push(v);
                }
            }
            if (values.length === 0) {
                for (var p = 0; p < 24; p++) values.push(50 + 25 * Math.sin(p / 3.5) + 10 * Math.cos(p / 1.7));
            }

            var x = padding, y = padding;
            var w = rect.width - padding * 2;
            var h = rect.height - padding * 2;

            var min = values[0], max = values[0];
            for (var ii = 1; ii < values.length; ii++) {
                if (values[ii] < min) min = values[ii];
                if (values[ii] > max) max = values[ii];
            }
            var range = max - min;
            if (range === 0) {
                ctx.strokeStyle = color;
                ctx.lineWidth = strokeWidth;
                ctx.lineCap = lineCap;
                ctx.beginPath();
                ctx.moveTo(x, y + h / 2);
                ctx.lineTo(x + w, y + h / 2);
                ctx.stroke();
                return;
            }
            var n = values.length;
            var pts = [];
            for (var jj = 0; jj < n; jj++) {
                var px = (n === 1) ? x + w / 2 : x + (w * jj) / (n - 1);
                var py = y + h - ((values[jj] - min) / range) * h;
                pts.push({ x: px, y: py });
            }

            function curve() {
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                if (smooth && pts.length > 2) {
                    for (var s = 1; s < pts.length - 1; s++) {
                        var xc = (pts[s].x + pts[s + 1].x) / 2;
                        var yc = (pts[s].y + pts[s + 1].y) / 2;
                        ctx.quadraticCurveTo(pts[s].x, pts[s].y, xc, yc);
                    }
                    ctx.quadraticCurveTo(pts[pts.length - 2].x, pts[pts.length - 2].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
                } else {
                    for (var m = 1; m < pts.length; m++) ctx.lineTo(pts[m].x, pts[m].y);
                }
            }

            if (fill) {
                var grad = ctx.createLinearGradient(0, y, 0, y + h);
                grad.addColorStop(0, T.withAlpha(color, fillOpacity));
                grad.addColorStop(1, T.withAlpha(color, 0));
                ctx.fillStyle = grad;
                curve();
                ctx.lineTo(pts[pts.length - 1].x, y + h);
                ctx.lineTo(pts[0].x, y + h);
                ctx.closePath();
                ctx.fill();
            }

            ctx.strokeStyle = color;
            ctx.lineWidth = strokeWidth;
            ctx.lineCap = lineCap;
            ctx.lineJoin = 'round';
            curve();
            ctx.stroke();

            if (showMarkers) {
                ctx.fillStyle = color;
                for (var mi = 0; mi < pts.length; mi++) {
                    ctx.beginPath();
                    ctx.arc(pts[mi].x, pts[mi].y, markerSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            if (showLastDot) {
                var last = pts[pts.length - 1];
                ctx.fillStyle = lastDotColor;
                ctx.beginPath();
                ctx.arc(last.x, last.y, markerSize + 1, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = t.panel;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
