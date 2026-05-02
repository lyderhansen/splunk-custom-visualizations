/*
 * ACME Time-Series Area Chart — multi-series overlay area chart.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    function fmtTime(raw) {
        if (raw === undefined || raw === null) return '';
        var s = String(raw);
        if (/^\d{9,10}(\.\d+)?$/.test(s)) {
            var d = new Date(parseFloat(s) * 1000);
            return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        var d2 = new Date(s);
        if (!isNaN(d2.getTime())) return d2.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        return s;
    }

    function niceMax(v) {
        if (v <= 0) return 10;
        var pow = Math.pow(10, Math.floor(Math.log10(v)));
        var n = v / pow;
        if (n <= 1) return pow;
        if (n <= 2) return 2 * pow;
        if (n <= 5) return 5 * pow;
        return 10 * pow;
    }

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-area-chart-viz');
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
            var t = T.getTheme(themeName);
            var defaultColors = [t.s2, t.orange, t.s4, t.s5, t.s3, t.s1];
            var colors = T.parseColors(config[ns + 'colors'], defaultColors);
            var dashedSet = T.parseInts(config[ns + 'dashedSeries']);
            var noFillSet = T.parseInts(config[ns + 'noFillSeries']);
            var gridY = parseInt(config[ns + 'gridY'] || '4', 10);
            var markerIdx = parseInt(config[ns + 'markerIdx'] || '-1', 10);
            var markerSeries = parseInt(config[ns + 'markerSeries'] || '0', 10);
            var markerLabel = config[ns + 'markerLabel'] || '';
            var yUnit = config[ns + 'yUnit'] || '';
            // Expanded settings
            var lineWidth = parseFloat(config[ns + 'lineWidth'] || '1.75');
            var fillOpacity = parseFloat(config[ns + 'fillOpacity'] || '0.22');
            var showXAxis = String(config[ns + 'showXAxis'] || 'true') !== 'false';
            var showYAxis = String(config[ns + 'showYAxis'] || 'true') !== 'false';
            var showGrid = String(config[ns + 'showGrid'] || 'true') !== 'false';
            var showPoints = String(config[ns + 'showPoints'] || 'false') === 'true';
            var pointSize = parseFloat(config[ns + 'pointSize'] || '3');
            var smooth = String(config[ns + 'smooth'] || 'false') === 'true';
            var padTop = parseInt(config[ns + 'padTop'] || '10', 10);
            var padRight = parseInt(config[ns + 'padRight'] || '16', 10);
            var padBottom = parseInt(config[ns + 'padBottom'] || '26', 10);
            var padLeft = parseInt(config[ns + 'padLeft'] || '44', 10);
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var xTickCount = parseInt(config[ns + 'xTickCount'] || '6', 10);
            var yMaxOverride = parseFloat(config[ns + 'yMaxOverride'] || '0');
            var legendPos = config[ns + 'legendPosition'] || 'off';

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

            var rows = data.rows;
            var fields = data.fields;
            var seriesNames = [];
            for (var i = 1; i < fields.length; i++) seriesNames.push(fields[i]);
            if (rows.length === 0 || seriesNames.length === 0) {
                rows = [];
                seriesNames = ['notable', 'blocked', 'authfail'];
                fields = ['_time'].concat(seriesNames);
                for (var h = 0; h < 24; h++) {
                    var ep = Math.round(Date.now() / 1000) - (24 - h) * 3600;
                    rows.push([
                        ep,
                        Math.round(40 + 20 * Math.sin(h / 3.0) + (h * 7) % 10),
                        Math.round(80 + 30 * Math.cos(h / 4.0) + (h * 11) % 15),
                        Math.round(30 + 15 * Math.sin(h / 5.0) + (h * 5) % 8)
                    ]);
                }
            }

            var n = rows.length;
            var allSeries = [];
            var globalMax = 0;
            for (var s = 0; s < seriesNames.length; s++) {
                var arr = [];
                for (var r = 0; r < n; r++) {
                    var v = parseFloat(rows[r][s + 1]);
                    if (isNaN(v)) v = 0;
                    arr.push(v);
                    if (v > globalMax) globalMax = v;
                }
                allSeries.push(arr);
            }
            var yMax = yMaxOverride > 0 ? yMaxOverride : niceMax(globalMax * 1.1);

            var legendH = (legendPos === 'top' || legendPos === 'bottom') ? 22 : 0;
            var pad = { t: padTop + (legendPos === 'top' ? legendH : 0), r: padRight, b: padBottom + (legendPos === 'bottom' ? legendH : 0), l: padLeft };
            if (!showYAxis) pad.l = 8;
            if (!showXAxis) pad.b = 10;
            var cw = rect.width - pad.l - pad.r;
            var ch = rect.height - pad.t - pad.b;
            var x0 = pad.l, y0 = pad.t;

            if (showGrid) T.drawHGrid(ctx, t, x0, y0, cw, ch, gridY);

            if (showYAxis) {
                ctx.fillStyle = t.textFaint;
                ctx.font = '500 11px ' + T.FONTS.ui;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                for (var g = 0; g <= gridY; g++) {
                    var yv = yMax - (yMax * g) / gridY;
                    var py = y0 + (ch * g) / gridY;
                    var lab = T.fmtNum(yv, { compact: true });
                    if (yUnit) lab += yUnit;
                    ctx.fillText(lab, x0 - 8, py);
                }
            }

            if (showXAxis) {
                var xTicks = Math.min(xTickCount, n);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = t.textFaint;
                ctx.font = '400 11px ' + T.FONTS.ui;
                for (var xi = 0; xi < xTicks; xi++) {
                    var idx = (n === 1) ? 0 : Math.round(((n - 1) * xi) / (xTicks - 1));
                    var px = (n === 1) ? x0 + cw / 2 : x0 + (cw * idx) / (n - 1);
                    ctx.fillText(fmtTime(rows[idx][0]), px, y0 + ch + 8);
                }
            }

            function xFor(i) { return n === 1 ? x0 + cw / 2 : x0 + (cw * i) / (n - 1); }
            function yFor(v) { return y0 + ch - (v / yMax) * ch; }

            function curve(serIdx) {
                ctx.beginPath();
                var p0 = { x: xFor(0), y: yFor(allSeries[serIdx][0]) };
                ctx.moveTo(p0.x, p0.y);
                if (smooth && n > 2) {
                    for (var s2 = 1; s2 < n - 1; s2++) {
                        var x1 = xFor(s2), y1 = yFor(allSeries[serIdx][s2]);
                        var x2 = xFor(s2 + 1), y2 = yFor(allSeries[serIdx][s2 + 1]);
                        ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
                    }
                    ctx.quadraticCurveTo(xFor(n - 2), yFor(allSeries[serIdx][n - 2]), xFor(n - 1), yFor(allSeries[serIdx][n - 1]));
                } else {
                    for (var p = 1; p < n; p++) ctx.lineTo(xFor(p), yFor(allSeries[serIdx][p]));
                }
            }

            // Fills.
            for (var f = 0; f < allSeries.length; f++) {
                if (noFillSet.indexOf(f) !== -1 || dashedSet.indexOf(f) !== -1) continue;
                var color = colors[f % colors.length];
                var grad = ctx.createLinearGradient(0, y0, 0, y0 + ch);
                grad.addColorStop(0, T.withAlpha(color, fillOpacity));
                grad.addColorStop(1, T.withAlpha(color, 0));
                ctx.fillStyle = grad;
                curve(f);
                ctx.lineTo(xFor(n - 1), y0 + ch);
                ctx.lineTo(xFor(0), y0 + ch);
                ctx.closePath();
                ctx.fill();
            }

            // Strokes.
            for (var ff = 0; ff < allSeries.length; ff++) {
                var color2 = colors[ff % colors.length];
                var dashed = dashedSet.indexOf(ff) !== -1;
                ctx.save();
                ctx.strokeStyle = color2;
                ctx.lineWidth = dashed ? Math.max(1, lineWidth - 0.25) : lineWidth;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                if (dashed) ctx.setLineDash([5, 4]);
                curve(ff);
                ctx.stroke();
                ctx.restore();

                if (showPoints) {
                    ctx.fillStyle = color2;
                    for (var pp = 0; pp < n; pp++) {
                        ctx.beginPath();
                        ctx.arc(xFor(pp), yFor(allSeries[ff][pp]), pointSize, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            // Marker.
            if (markerIdx >= 0 && markerIdx < n && markerSeries < allSeries.length) {
                var mc = colors[markerSeries % colors.length];
                var mx = xFor(markerIdx);
                var my = yFor(allSeries[markerSeries][markerIdx]);
                ctx.save();
                ctx.strokeStyle = t.edgeStrong;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(mx, y0);
                ctx.lineTo(mx, y0 + ch);
                ctx.stroke();
                ctx.restore();
                ctx.beginPath();
                ctx.arc(mx, my, 4, 0, Math.PI * 2);
                ctx.fillStyle = t.panel;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = mc;
                ctx.stroke();
                var tipW = 120, tipH = 32;
                var tx2 = mx + 10;
                var ty = my - 30 - tipH;
                if (ty < y0) ty = my + 10;
                if (tx2 + tipW > x0 + cw) tx2 = mx - 10 - tipW;
                T.roundRect(ctx, tx2, ty, tipW, tipH, 4);
                ctx.fillStyle = t.panel;
                ctx.fill();
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = t.textDim;
                ctx.font = '500 10px ' + T.FONTS.ui;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(markerLabel || fmtTime(rows[markerIdx][0]), tx2 + 8, ty + 5);
                ctx.fillStyle = t.text;
                ctx.font = '600 12px ' + T.FONTS.mono;
                ctx.fillText(T.fmtNum(allSeries[markerSeries][markerIdx], { compact: true }) + (yUnit || ''), tx2 + 8, ty + 17);
            }

            // Legend.
            if (legendPos === 'top' || legendPos === 'bottom') {
                var ly = legendPos === 'top' ? padTop / 2 + 2 : rect.height - 14;
                ctx.font = '500 11px ' + T.FONTS.ui;
                ctx.textBaseline = 'middle';
                var totalW = 0;
                for (var lc = 0; lc < seriesNames.length; lc++) {
                    totalW += 16 + ctx.measureText(seriesNames[lc]).width + 16;
                }
                var lx = (rect.width - totalW) / 2;
                for (var li = 0; li < seriesNames.length; li++) {
                    ctx.fillStyle = colors[li % colors.length];
                    ctx.fillRect(lx, ly - 4, 10, 8);
                    ctx.fillStyle = t.textDim;
                    ctx.fillText(seriesNames[li], lx + 14, ly);
                    lx += 16 + ctx.measureText(seriesNames[li]).width + 16;
                }
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
