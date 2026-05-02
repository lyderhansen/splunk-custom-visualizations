/*
 * ACME Donut — part-to-whole composition.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-donut-viz');
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
                return { rows: [] };
            }
            var rows = [];
            for (var i = 0; i < data.rows.length; i++) {
                var lab = data.rows[i][0];
                var val = parseFloat(data.rows[i][1]);
                if (isNaN(val) || val < 0) val = 0;
                rows.push({ label: String(lab), value: val });
            }
            var result = { rows: rows };
            this._lastGoodData = result;
            return result;
        },

        updateView: function (data, config) {
            if (!data) data = this._lastGoodData || { rows: [] };

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = config[ns + 'theme'] || 'dark';
            var t = T.getTheme(themeName);
            var defaultColors = [t.s2, t.s3, t.s4, t.s5, t.orange, t.s1];
            var colors = T.parseColors(config[ns + 'colors'], defaultColors);
            var centerLabel = config[ns + 'centerLabel'] || '';
            var centerSub = config[ns + 'centerSubLabel'] || '';
            var legendPos = config[ns + 'legendPosition'] || 'right';
            var unit = config[ns + 'unit'] || '';
            // Expanded
            var innerRatio = parseFloat(config[ns + 'innerRatio'] || '0.62');
            var segmentGap = parseFloat(config[ns + 'segmentGap'] || '0');
            var sortOrder = config[ns + 'sortOrder'] || 'none';
            var centerFontSize = parseInt(config[ns + 'centerFontSize'] || '22', 10);
            var centerSubFontSize = parseInt(config[ns + 'centerSubFontSize'] || '11', 10);
            var legendFontSize = parseInt(config[ns + 'legendFontSize'] || '12', 10);
            var showPercent = String(config[ns + 'showPercent'] || 'false') === 'true';
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var lineCap = config[ns + 'lineCap'] || 'butt';

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

            var rows = data.rows.slice();
            if (!rows.length) {
                rows = [
                    { label: 'Americas', value: 4250 }, { label: 'EMEA', value: 3120 },
                    { label: 'APAC', value: 2280 }, { label: 'Other', value: 1300 }
                ];
            }
            if (sortOrder === 'desc') rows.sort(function (a, b) { return b.value - a.value; });
            else if (sortOrder === 'asc') rows.sort(function (a, b) { return a.value - b.value; });

            var total = 0;
            for (var i = 0; i < rows.length; i++) total += rows[i].value;
            if (total === 0) total = 1;

            var donutSize, donutCx, donutCy, legendX, legendY, legendW;
            if (legendPos === 'right') {
                var legendMinW = 180;
                donutSize = Math.min(rect.height - 16, rect.width - legendMinW - 24);
                if (donutSize < 80) donutSize = 80;
                donutCx = donutSize / 2 + 12;
                donutCy = rect.height / 2;
                legendX = donutSize + 24;
                legendY = (rect.height - rows.length * 22) / 2;
                legendW = rect.width - legendX - 12;
            } else if (legendPos === 'bottom') {
                donutSize = Math.min(rect.width - 24, rect.height * 0.6);
                donutCx = rect.width / 2;
                donutCy = donutSize / 2 + 12;
                legendX = 12;
                legendY = donutSize + 28;
                legendW = rect.width - 24;
            } else { // off
                donutSize = Math.min(rect.width - 24, rect.height - 24);
                donutCx = rect.width / 2;
                donutCy = rect.height / 2;
                legendX = -1;
                legendY = -1;
                legendW = 0;
            }
            var donutR = donutSize / 2;
            var donutThick = Math.max(8, Math.round(donutR * (1 - innerRatio)));

            ctx.lineWidth = donutThick;
            ctx.lineCap = lineCap;
            var startA = -Math.PI / 2;
            var arcRadius = donutR - donutThick / 2;
            var gapRad = segmentGap > 0 ? (segmentGap / arcRadius) : 0;
            for (var s = 0; s < rows.length; s++) {
                var frac = rows[s].value / total;
                var endA = startA + frac * Math.PI * 2;
                ctx.strokeStyle = colors[s % colors.length];
                ctx.beginPath();
                ctx.arc(donutCx, donutCy, arcRadius, startA + gapRad / 2, endA - gapRad / 2, false);
                ctx.stroke();
                startA = endA;
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (centerLabel) {
                ctx.fillStyle = t.text;
                ctx.font = '600 ' + centerFontSize + 'px ' + T.FONTS.ui;
                ctx.fillText(centerLabel, donutCx, donutCy - 8);
            }
            if (centerSub) {
                ctx.fillStyle = t.textDim;
                ctx.font = '500 ' + centerSubFontSize + 'px ' + T.FONTS.ui;
                ctx.fillText(centerSub, donutCx, donutCy + 12);
            }

            if (legendPos !== 'off') {
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                for (var li = 0; li < rows.length; li++) {
                    var ly = legendY + li * 22 + 11;
                    T.roundRect(ctx, legendX, ly - 5, 10, 10, 2);
                    ctx.fillStyle = colors[li % colors.length];
                    ctx.fill();
                    ctx.font = '500 ' + legendFontSize + 'px ' + T.FONTS.ui;
                    ctx.fillStyle = t.textDim;
                    ctx.fillText(rows[li].label, legendX + 16, ly);
                    ctx.font = '600 ' + (legendFontSize + 1) + 'px ' + T.FONTS.mono;
                    ctx.fillStyle = t.text;
                    ctx.textAlign = 'right';
                    var legText = T.fmtNum(rows[li].value, { compact: true }) + (unit ? unit : '');
                    if (showPercent) legText += ' (' + Math.round((rows[li].value / total) * 100) + '%)';
                    ctx.fillText(legText, legendX + legendW, ly);
                    ctx.textAlign = 'left';
                }
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
