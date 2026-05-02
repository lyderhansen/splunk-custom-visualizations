/*
 * ACME Conversion Funnel — sequential drop-off.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-funnel-viz');
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
                return { stages: [] };
            }
            var stages = [];
            for (var i = 0; i < data.rows.length; i++) {
                var lab = String(data.rows[i][0]);
                var val = parseFloat(data.rows[i][1]);
                if (isNaN(val) || val < 0) val = 0;
                stages.push({ label: lab, value: val });
            }
            var result = { stages: stages };
            this._lastGoodData = result;
            return result;
        },

        updateView: function (data, config) {
            if (!data) data = this._lastGoodData || { stages: [] };
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = config[ns + 'theme'] || 'dark';
            var t = T.getTheme(themeName);
            var color = config[ns + 'color'] || t.s2;
            var dropoffWarn = parseFloat(config[ns + 'dropoffWarnThreshold'] || '30');
            // Expanded
            var labelWidth = parseInt(config[ns + 'labelWidth'] || '130', 10);
            var stepWidth = parseInt(config[ns + 'stepWidth'] || '64', 10);
            var barHeight = parseInt(config[ns + 'barHeight'] || '26', 10);
            var barRadius = parseFloat(config[ns + 'barRadius'] || '3');
            var sidePad = parseInt(config[ns + 'sidePadding'] || '14', 10);
            var showAbsoluteCount = String(config[ns + 'showAbsoluteCount'] || 'true') !== 'false';
            var showStepPercent = String(config[ns + 'showStepPercent'] || 'true') !== 'false';
            var labelColor = config[ns + 'labelColor'] || t.text;
            var trackColor = config[ns + 'trackColor'] || '';
            var fontSize = parseInt(config[ns + 'fontSize'] || '12', 10);
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var percentMode = config[ns + 'percentMode'] || 'fromPrev';
            var numberFormat = config[ns + 'numberFormat'] || 'auto';

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

            var stages = data.stages.slice();
            if (!stages.length) {
                stages = [
                    { label: 'Visitors', value: 48210 }, { label: 'Signups started', value: 21640 },
                    { label: 'Email verified', value: 18430 }, { label: 'Profile completed', value: 14820 },
                    { label: 'Subscribed', value: 9380 }, { label: 'Active 30d', value: 6210 }
                ];
            }
            var first = stages[0].value || 1;

            var topPad = 8, gap = 12;
            var rowsArea = rect.height - topPad * 2;
            var rowH = Math.min(38, rowsArea / stages.length);
            var trackX = sidePad + labelWidth + gap;
            var trackW = rect.width - sidePad * 2 - labelWidth - stepWidth - gap * 2;
            var actualBarH = Math.min(barHeight, rowH - 8);

            ctx.textBaseline = 'middle';

            for (var ri = 0; ri < stages.length; ri++) {
                var ry = topPad + ri * rowH + rowH / 2;
                ctx.fillStyle = labelColor;
                ctx.font = '500 ' + fontSize + 'px ' + T.FONTS.ui;
                ctx.textAlign = 'left';
                var lab = stages[ri].label;
                if (ctx.measureText(lab).width > labelWidth - 4) {
                    while (lab.length > 3 && ctx.measureText(lab + '…').width > labelWidth - 4) lab = lab.slice(0, -1);
                    lab += '…';
                }
                ctx.fillText(lab, sidePad, ry);

                T.roundRect(ctx, trackX, ry - actualBarH / 2, trackW, actualBarH, barRadius);
                ctx.fillStyle = trackColor || t.edge;
                ctx.fill();

                var w = (stages[ri].value / first) * trackW;
                if (w > 0) {
                    T.roundRect(ctx, trackX, ry - actualBarH / 2, Math.max(4, w), actualBarH, barRadius);
                    ctx.fillStyle = color;
                    ctx.fill();

                    if (showAbsoluteCount) {
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '600 ' + (fontSize - 1) + 'px ' + T.FONTS.mono;
                        ctx.textAlign = 'left';
                        var txt = numberFormat === 'compact' ? T.fmtNum(stages[ri].value, { compact: true }) : T.fmtNum(stages[ri].value, { compact: false });
                        ctx.fillText(txt, trackX + 10, ry);
                    }
                }

                if (showStepPercent) {
                    var stepPct;
                    if (percentMode === 'fromFirst') {
                        stepPct = (stages[ri].value / first) * 100;
                    } else {
                        stepPct = (ri === 0) ? 100 : (stages[ri - 1].value > 0
                            ? (stages[ri].value / stages[ri - 1].value) * 100 : 0);
                    }
                    ctx.font = '500 ' + fontSize + 'px ' + T.FONTS.mono;
                    ctx.fillStyle = (ri > 0 && stepPct < dropoffWarn) ? t.warn : t.text;
                    ctx.textAlign = 'right';
                    ctx.fillText(stepPct.toFixed(0) + '%', rect.width - sidePad, ry);
                }
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
