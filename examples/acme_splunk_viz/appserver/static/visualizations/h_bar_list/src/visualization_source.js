/*
 * ACME Horizontal Bar List — Top-N rows.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-h-bar-list-viz');
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
                var color = data.rows[i][2] || null;
                rows.push({ label: String(lab), value: val, color: color });
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
            var defaultColors = [t.s2, t.s3, t.s4];
            var tierColors = T.parseColors(config[ns + 'colors'], defaultColors);
            var spotlightIdx = parseInt(config[ns + 'spotlightIndex'] || '-1', 10);
            var spotlightColor = config[ns + 'spotlightColor'] || t.orange;
            var suffix = config[ns + 'suffix'] || '';
            var maxRows = parseInt(config[ns + 'maxRows'] || '7', 10);
            // Expanded
            var labelWidth = parseInt(config[ns + 'labelWidth'] || '130', 10);
            var valueWidth = parseInt(config[ns + 'valueWidth'] || '72', 10);
            var barHeight = parseInt(config[ns + 'barHeight'] || '8', 10);
            var barRadius = parseFloat(config[ns + 'barRadius'] || '4');
            var sortOrder = config[ns + 'sortOrder'] || 'none';
            var sidePad = parseInt(config[ns + 'sidePadding'] || '14', 10);
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var trackColor = config[ns + 'trackColor'] || '';
            var labelColor = config[ns + 'labelColor'] || t.text;
            var valueColor = config[ns + 'valueColor'] || t.text;
            var fontSize = parseInt(config[ns + 'fontSize'] || '13', 10);
            var numberFormat = config[ns + 'numberFormat'] || 'compact';

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
                    { label: 'firewall', value: 482 }, { label: 'proxy', value: 317 },
                    { label: 'edr', value: 268 }, { label: 'authentication', value: 214 },
                    { label: 'dns', value: 189 }, { label: 'vpn', value: 142 }, { label: 'wafs', value: 96 }
                ];
            }
            if (sortOrder === 'asc') rows.sort(function (a, b) { return a.value - b.value; });
            else if (sortOrder === 'desc') rows.sort(function (a, b) { return b.value - a.value; });
            rows = rows.slice(0, maxRows);

            var maxV = 0;
            for (var i = 0; i < rows.length; i++) if (rows[i].value > maxV) maxV = rows[i].value;
            if (maxV <= 0) maxV = 1;

            var topPad = 6, gap = 12;
            var rowsArea = rect.height - topPad * 2;
            var rowH = Math.min(34, rowsArea / rows.length);
            var trackX = sidePad + labelWidth + gap;
            var trackW = rect.width - sidePad * 2 - labelWidth - valueWidth - gap * 2;

            ctx.textBaseline = 'middle';

            function tierColor(idx, total) {
                if (idx < 2) return tierColors[0] || t.s2;
                if (idx < Math.min(5, total)) return tierColors[1 % tierColors.length] || t.s3;
                return tierColors[2 % tierColors.length] || t.s4;
            }

            for (var ri = 0; ri < rows.length; ri++) {
                var ry = topPad + ri * rowH + rowH / 2;
                var color = rows[ri].color || (ri === spotlightIdx ? spotlightColor : tierColor(ri, rows.length));

                ctx.fillStyle = labelColor;
                ctx.font = '500 ' + fontSize + 'px ' + T.FONTS.ui;
                ctx.textAlign = 'left';
                var lab = String(rows[ri].label);
                if (ctx.measureText(lab).width > labelWidth - 4) {
                    while (lab.length > 3 && ctx.measureText(lab + '…').width > labelWidth - 4) lab = lab.slice(0, -1);
                    lab += '…';
                }
                ctx.fillText(lab, sidePad, ry);

                T.roundRect(ctx, trackX, ry - barHeight / 2, trackW, barHeight, barRadius);
                ctx.fillStyle = trackColor || t.edge;
                ctx.fill();

                var fillW = (rows[ri].value / maxV) * trackW;
                if (fillW > 0) {
                    T.roundRect(ctx, trackX, ry - barHeight / 2, Math.max(2, fillW), barHeight, barRadius);
                    ctx.fillStyle = color;
                    ctx.fill();
                }

                ctx.fillStyle = valueColor;
                ctx.font = '500 ' + fontSize + 'px ' + T.FONTS.mono;
                ctx.textAlign = 'right';
                var formattedVal = numberFormat === 'compact' ? T.fmtNum(rows[ri].value, { compact: true })
                                  : numberFormat === 'raw' ? String(rows[ri].value)
                                  : T.fmtNum(rows[ri].value, { compact: false });
                ctx.fillText(formattedVal + (suffix || ''), rect.width - sidePad, ry);
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
