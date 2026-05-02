/*
 * ACME Heatmap Grid — categorical-Y by time-X density.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    function parseValueList(raw) {
        if (raw === undefined || raw === null) return [];
        var s = String(raw);
        var parts = s.split(',');
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var v = parseFloat(parts[i]);
            if (!isNaN(v)) out.push(v);
        }
        return out;
    }

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-heatmap-viz');
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
            var fields = [];
            for (var i = 0; i < data.fields.length; i++) fields.push(data.fields[i].name);
            var rows = [];
            for (var r = 0; r < data.rows.length; r++) {
                var row = data.rows[r];
                var label = String(row[0]);
                var values;
                if (data.fields.length >= 3 && fields[1] !== 'vals') {
                    values = [];
                    for (var c = 1; c < row.length; c++) {
                        var v = parseFloat(row[c]);
                        values.push(isNaN(v) ? 0 : v);
                    }
                } else {
                    values = parseValueList(row[1]);
                }
                rows.push({ label: label, values: values });
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
            var flavor = config[ns + 'flavor'] || 'mitre';
            var showCellValuesRaw = config[ns + 'showCellValues'];
            var showCellValues = (flavor === 'mitre');
            if (showCellValuesRaw !== undefined) showCellValues = String(showCellValuesRaw) === 'true';
            var cellHigh = config[ns + 'cellHigh'] || (flavor === 'mitre' ? '#ff6600' : '#2bbfb8');
            var cellExtreme = config[ns + 'cellExtreme'] || '#d41f1f';
            var legendLow = config[ns + 'legendLow'] || 'Less';
            var legendHigh = config[ns + 'legendHigh'] || 'More';
            // Expanded
            var cellLow = config[ns + 'cellLow'] || '';
            var cellMid = config[ns + 'cellMid'] || '';
            var cellPadding = parseFloat(config[ns + 'cellPadding'] || '3');
            var cellRadius = parseFloat(config[ns + 'cellRadius'] || '2');
            var labelColumnWidth = parseInt(config[ns + 'labelColumnWidth'] || (flavor === 'mitre' ? '130' : '32'), 10);
            var valueFontSize = parseInt(config[ns + 'valueFontSize'] || '10', 10);
            var labelFontSize = parseInt(config[ns + 'labelFontSize'] || '12', 10);
            var maxCellHeight = parseInt(config[ns + 'maxCellHeight'] || '22', 10);
            var sortOrder = config[ns + 'sortOrder'] || 'none';
            var showLegend = String(config[ns + 'showLegend'] || 'true') !== 'false';
            var bgColor = config[ns + 'bgColor'] || 'transparent';

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
                    { label: 'Initial Access', values: [0, 2, 1, 3, 0, 5, 2] },
                    { label: 'Execution', values: [1, 4, 2, 6, 3, 0, 4] },
                    { label: 'Persistence', values: [0, 1, 0, 2, 1, 0, 3] },
                    { label: 'Priv Esc', values: [2, 3, 1, 0, 4, 2, 5] },
                    { label: 'Defense Evasion', values: [3, 5, 4, 7, 2, 1, 6] },
                    { label: 'Credential', values: [1, 2, 0, 1, 3, 0, 2] },
                    { label: 'Discovery', values: [4, 3, 5, 2, 1, 3, 4] },
                    { label: 'Lateral', values: [0, 1, 2, 0, 3, 1, 2] }
                ];
            }
            if (sortOrder === 'desc' || sortOrder === 'asc') {
                rows.forEach(function (r) {
                    r._sum = r.values.reduce(function (a, b) { return a + b; }, 0);
                });
                rows.sort(function (a, b) { return sortOrder === 'desc' ? b._sum - a._sum : a._sum - b._sum; });
            }

            var maxCols = 0, globalMax = 0;
            for (var r = 0; r < rows.length; r++) {
                if (rows[r].values.length > maxCols) maxCols = rows[r].values.length;
                for (var c = 0; c < rows[r].values.length; c++) {
                    if (rows[r].values[c] > globalMax) globalMax = rows[r].values[c];
                }
            }
            if (globalMax === 0) globalMax = 1;

            var legendH = showLegend ? 28 : 0;
            var rowGap = 3;
            var topPad = 14, sidePad = 14;
            var availW = rect.width - sidePad * 2 - labelColumnWidth - 14;
            var availH = rect.height - topPad - legendH - 14;
            var cellW = (availW - cellPadding * (maxCols - 1)) / maxCols;
            var rowH = Math.min(maxCellHeight, (availH - rowGap * (rows.length - 1)) / rows.length);
            var x0 = sidePad + labelColumnWidth + 14;
            var y0 = topPad;

            var q1 = globalMax * 0.25, q2 = globalMax * 0.50, q3 = globalMax * 0.75;
            var lowC = cellLow || T.withAlpha(t.s4, 0.30);
            var midC = cellMid || T.withAlpha(t.s3, 0.55);

            ctx.font = '500 ' + labelFontSize + 'px ' + T.FONTS.ui;
            ctx.textBaseline = 'middle';
            for (var ri = 0; ri < rows.length; ri++) {
                var ry = y0 + ri * (rowH + rowGap);
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'right';
                ctx.fillText(rows[ri].label, x0 - 14, ry + rowH / 2);

                for (var ci = 0; ci < rows[ri].values.length; ci++) {
                    var v = rows[ri].values[ci];
                    var cx = x0 + ci * (cellW + cellPadding);
                    var cellColor;
                    if (v <= 0) cellColor = t.edge;
                    else if (v < q1) cellColor = lowC;
                    else if (v < q2) cellColor = midC;
                    else if (v < q3) cellColor = T.withAlpha(cellHigh, 0.78);
                    else cellColor = (v >= globalMax * 0.95 && flavor === 'mitre') ? cellExtreme : cellHigh;

                    T.roundRect(ctx, cx, ry, cellW, rowH, cellRadius);
                    ctx.fillStyle = cellColor;
                    ctx.fill();

                    if (showCellValues && v > 0) {
                        ctx.fillStyle = (v >= q2) ? '#ffffff' : t.textDim;
                        ctx.font = '600 ' + valueFontSize + 'px ' + T.FONTS.mono;
                        ctx.textAlign = 'center';
                        ctx.fillText(String(v), cx + cellW / 2, ry + rowH / 2);
                        ctx.font = '500 ' + labelFontSize + 'px ' + T.FONTS.ui;
                    }
                }
            }

            if (showLegend) {
                var ly = rect.height - legendH + 4;
                ctx.font = '400 11px ' + T.FONTS.ui;
                ctx.fillStyle = t.textFaint;
                ctx.textBaseline = 'middle';
                var legendStops = [t.edge, lowC, midC, T.withAlpha(cellHigh, 0.78), cellHigh];
                var swatchW = 14, swatchH = 12, swatchGap = 3;
                var legendW = ctx.measureText(legendLow).width + 6 +
                              legendStops.length * swatchW + (legendStops.length - 1) * swatchGap +
                              6 + ctx.measureText(legendHigh).width;
                var lx = rect.width - sidePad - legendW;
                ctx.textAlign = 'left';
                ctx.fillText(legendLow, lx, ly + swatchH / 2);
                lx += ctx.measureText(legendLow).width + 6;
                for (var sw = 0; sw < legendStops.length; sw++) {
                    T.roundRect(ctx, lx, ly, swatchW, swatchH, 2);
                    ctx.fillStyle = legendStops[sw];
                    ctx.fill();
                    lx += swatchW + swatchGap;
                }
                lx += 3;
                ctx.fillStyle = t.textFaint;
                ctx.fillText(legendHigh, lx, ly + swatchH / 2);
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
