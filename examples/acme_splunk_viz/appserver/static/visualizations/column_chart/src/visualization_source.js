/*
 * ACME Column Bar Chart — vertical bars with optional highlighted index.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

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
            this.el.classList.add('acme-column-chart-viz');
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
                if (isNaN(val)) val = 0;
                rows.push({ label: lab, value: val });
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
            var color = config[ns + 'color'] || t.s2;
            var hlColor = config[ns + 'highlightColor'] || t.orange;
            var hlIdx = parseInt(config[ns + 'highlightIndex'] || '-1', 10);
            var gridY = parseInt(config[ns + 'gridY'] || '4', 10);
            var maxBarW = parseInt(config[ns + 'maxBarWidth'] || '20', 10);
            // Expanded
            var barRadius = parseFloat(config[ns + 'barRadius'] || '2');
            var showValues = String(config[ns + 'showValueLabels'] || 'false') === 'true';
            var valueLabelColor = config[ns + 'valueLabelColor'] || t.text;
            var sortOrder = config[ns + 'sortOrder'] || 'none';
            var showGrid = String(config[ns + 'showGrid'] || 'true') !== 'false';
            var showXAxis = String(config[ns + 'showXAxis'] || 'true') !== 'false';
            var showYAxis = String(config[ns + 'showYAxis'] || 'true') !== 'false';
            var xLabelRotation = parseFloat(config[ns + 'xLabelRotation'] || '0');
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var padTop = parseInt(config[ns + 'padTop'] || '10', 10);
            var padRight = parseInt(config[ns + 'padRight'] || '16', 10);
            var padBottom = parseInt(config[ns + 'padBottom'] || '26', 10);
            var padLeft = parseInt(config[ns + 'padLeft'] || '44', 10);
            var yUnit = config[ns + 'yUnit'] || '';
            var yMaxOverride = parseFloat(config[ns + 'yMaxOverride'] || '0');

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
                rows = [];
                for (var d = 0; d < 12; d++) rows.push({ label: 'D' + (d + 1), value: 60 + 30 * Math.sin(d / 2.0) + (d * 13) % 20 });
            }
            if (sortOrder === 'asc') rows.sort(function (a, b) { return a.value - b.value; });
            else if (sortOrder === 'desc') rows.sort(function (a, b) { return b.value - a.value; });
            var n = rows.length;
            var globalMax = 0;
            for (var i = 0; i < n; i++) if (rows[i].value > globalMax) globalMax = rows[i].value;
            var yMax = yMaxOverride > 0 ? yMaxOverride : niceMax(globalMax * 1.1);

            if (!showYAxis) padLeft = 8;
            if (!showXAxis) padBottom = 10;
            var cw = rect.width - padLeft - padRight;
            var ch = rect.height - padTop - padBottom;
            var x0 = padLeft, y0 = padTop;

            if (showGrid) T.drawHGrid(ctx, t, x0, y0, cw, ch, gridY);

            if (showYAxis) {
                ctx.fillStyle = t.textFaint;
                ctx.font = '500 11px ' + T.FONTS.ui;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                for (var g = 0; g <= gridY; g++) {
                    var yv = yMax - (yMax * g) / gridY;
                    var py = y0 + (ch * g) / gridY;
                    ctx.fillText(T.fmtNum(yv, { compact: true }) + (yUnit || ''), x0 - 8, py);
                }
            }

            var slot = cw / n;
            var barW = Math.min(maxBarW, slot * 0.6);

            for (var b = 0; b < n; b++) {
                var bx = x0 + slot * b + (slot - barW) / 2;
                var bh = (rows[b].value / yMax) * ch;
                var by = y0 + ch - bh;
                var fill = (b === hlIdx) ? hlColor : color;
                T.roundRect(ctx, bx, by, barW, bh, barRadius);
                ctx.fillStyle = fill;
                ctx.fill();
                if (showValues) {
                    ctx.fillStyle = valueLabelColor;
                    ctx.font = '600 11px ' + T.FONTS.mono;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(T.fmtNum(rows[b].value, { compact: true }), bx + barW / 2, by - 3);
                }
            }

            if (showXAxis) {
                ctx.textBaseline = 'top';
                ctx.font = '400 11px ' + T.FONTS.ui;
                for (var xl = 0; xl < n; xl++) {
                    var hl = (xl === hlIdx);
                    ctx.fillStyle = hl ? t.text : t.textFaint;
                    ctx.font = (hl ? '600 ' : '400 ') + '11px ' + T.FONTS.ui;
                    var lx = x0 + slot * xl + slot / 2;
                    var ly = y0 + ch + 8;
                    if (xLabelRotation !== 0) {
                        ctx.save();
                        ctx.translate(lx, ly);
                        ctx.rotate((xLabelRotation * Math.PI) / 180);
                        ctx.textAlign = xLabelRotation < 0 ? 'right' : 'left';
                        ctx.fillText(String(rows[xl].label), 0, 0);
                        ctx.restore();
                    } else {
                        ctx.textAlign = 'center';
                        ctx.fillText(String(rows[xl].label), lx, ly);
                    }
                }
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
