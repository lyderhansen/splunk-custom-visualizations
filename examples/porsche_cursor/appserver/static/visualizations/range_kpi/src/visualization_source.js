/*
 * Porsche Taycan — Range KPI with sparkline.
 * ES5 only. theme: shared/theme
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    void SplunkVisualizationUtils;

    var T = require('shared/theme');

    function parsePipeNumbers(s) {
        if (!s) return [];
        var parts = String(s).split('|');
        var out = [];
        var j;
        for (j = 0; j < parts.length; j++) {
            var pv = parseFloat(parts[j]);
            if (!isNaN(pv)) out.push(pv);
        }
        return out;
    }

    function buildRowMap(data) {
        var map = {};
        var row = data.rows[0];
        var i;
        for (i = 0; i < data.fields.length; i++) {
            map[data.fields[i].name] = row[i];
        }
        return map;
    }

    function drawVignette(ctx, w, h) {
        var r = Math.max(w, h) * 0.55;
        var g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.15, w * 0.5, h * 0.5, r);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.65, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.42)');
        ctx.save();
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }

    /** Smooth-looking sparkline: round joins on straight segments (stable through all points). */
    function traceSparkLine(ctx, xs, ys) {
        var n = xs.length;
        if (n < 2) return;
        var i;
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (i = 1; i < n; i++) {
            ctx.lineTo(xs[i], ys[i]);
        }
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';
            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this.setupView();
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 1
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError('Awaiting data — Range KPI');
            }
            var rowMap = buildRowMap(data);
            var sparkRaw = rowMap.sparkline !== undefined && rowMap.sparkline !== null
                ? String(rowMap.sparkline) : '';
            var sparkline = parsePipeNumbers(sparkRaw);
            var out = {
                rowMap: rowMap,
                value: rowMap.value,
                label: rowMap.label,
                delta: rowMap.delta,
                unit: rowMap.unit,
                sparkline: sparkline
            };
            this._lastGoodData = out;
            return out;
        },

        setupView: function() {
            if (this.canvas) {
                return;
            }
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;
            var self = this;
            T.loadFonts(function() {
                self.invalidateUpdateView();
            });
        },

        updateView: function(data, config) {
            if (!data || !data.rowMap) return;
            this._lastData = data;
            this._lastConfig = config;
            this._render(data, config);
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        _render: function(data, config) {
            var el = this.el;
            var canvas = this.canvas;
            if (!canvas) return;

            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            var ns = T.getNS(this);
            var t = T.getTheme('dark');
            var rm = data.rowMap;

            var fieldKey = T.getOption(config, ns, 'field', 'value');
            var labelKey = T.getOption(config, ns, 'labelField', 'label');
            var deltaKey = T.getOption(config, ns, 'deltaField', 'delta');
            var unitKey = T.getOption(config, ns, 'unitField', 'unit');
            var sparkKey = T.getOption(config, ns, 'sparklineField', 'sparkline');

            var titleFallback = T.getOption(config, ns, 'title', 'Estimated Range');
            var vf = parseInt(T.getOption(config, ns, 'valueFontSize', '0'), 10);
            var lf = parseInt(T.getOption(config, ns, 'labelFontSize', '0'), 10);
            var accentIntensity = parseFloat(T.getOption(config, ns, 'accentIntensity', '0.7'));
            if (isNaN(accentIntensity)) accentIntensity = 0.7;
            if (accentIntensity < 0) accentIntensity = 0;
            if (accentIntensity > 1) accentIntensity = 1;

            var valueColor = T.getOption(config, ns, 'valueColor', '#E8E6E3');
            var accentColor = T.getOption(config, ns, 'accentColor', '#00C9A7');

            var valRaw = rm[fieldKey];
            var labelRaw = rm[labelKey];
            var deltaRaw = rm[deltaKey];
            var unitRaw = rm[unitKey];
            var sparkCell = rm[sparkKey];

            var sparkVals = data.sparkline;
            if (sparkKey !== 'sparkline' && sparkCell !== undefined && sparkCell !== null) {
                sparkVals = parsePipeNumbers(String(sparkCell));
            }
            if (!sparkVals || sparkVals.length === 0) {
                sparkVals = [];
            }

            var pad = Math.max(8, Math.min(w, h) * 0.04);
            var innerW = w - pad * 2;
            var innerH = h - pad * 2;
            var gap = Math.max(4, Math.min(w, h) * 0.015);
            var leftFrac = 0.7;
            var leftW = innerW * leftFrac - gap * 0.5;
            var sparkW = innerW * (1 - leftFrac) - gap * 0.5;
            var leftX = pad;
            var sparkX = pad + leftW + gap;
            var rCard = Math.max(10, Math.min(w, h) * 0.03);

            T.drawGlassPanel(ctx, t, pad, pad, innerW, innerH, rCard);
            drawVignette(ctx, w, h);

            var labelText = (labelRaw !== undefined && labelRaw !== null && String(labelRaw).length > 0)
                ? String(labelRaw)
                : String(titleFallback);

            var labelSize = lf > 0 ? lf : Math.max(10, Math.min(16, Math.min(w, h) * 0.048));
            ctx.save();
            ctx.font = '600 ' + labelSize + 'px ' + T.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(labelText, leftX + pad * 0.15, pad + pad * 0.35);
            ctx.restore();

            var numVal = parseFloat(String(valRaw));
            var valueText;
            if (isNaN(numVal)) {
                valueText = valRaw === undefined || valRaw === null ? '—' : String(valRaw);
            } else {
                valueText = T.fmtNum(numVal, { decimals: 0 });
            }

            var unitText = unitRaw !== undefined && unitRaw !== null ? String(unitRaw) : '';

            var blockH = innerH - (labelSize + pad * 0.9);
            var valueY = pad + labelSize + blockH * 0.42;

            var valStart = vf > 0 ? vf : Math.max(20, Math.min(72, Math.min(w, h) * 0.22));
            var maxValueW = leftW - pad * 0.5;
            var fitted = T.fitText(ctx, valueText, maxValueW * 0.92, valStart, 16);
            ctx.save();
            ctx.font = 'bold ' + fitted + 'px ' + T.FONTS.mono;
            ctx.fillStyle = valueColor;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            var vx = leftX + pad * 0.15;
            ctx.fillText(valueText, vx, valueY);
            var vw = ctx.measureText(valueText).width;
            if (unitText) {
                var unitSize = Math.max(10, Math.min(20, fitted * 0.38));
                ctx.font = '500 ' + unitSize + 'px ' + T.FONTS.ui;
                ctx.fillStyle = T.withAlpha(valueColor, 0.45);
                ctx.fillText(' ' + unitText, vx + vw + 2, valueY);
            }
            ctx.restore();

            var deltaNum = parseFloat(String(deltaRaw));
            var deltaStr;
            var deltaColor;
            if (isNaN(deltaNum) || deltaNum === 0) {
                deltaStr = '';
                deltaColor = t.textDim;
            } else if (deltaNum < 0) {
                deltaStr = '\u25BC ' + Math.abs(Math.round(deltaNum));
                deltaColor = t.warn;
            } else {
                deltaStr = '\u25B2 ' + Math.round(deltaNum);
                deltaColor = t.success;
            }

            if (deltaStr) {
                var dSize = Math.max(9, Math.min(18, fitted * 0.22));
                ctx.save();
                ctx.font = '600 ' + dSize + 'px ' + T.FONTS.ui;
                ctx.fillStyle = deltaColor;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.globalAlpha = 0.85 * accentIntensity + 0.15;
                ctx.fillText(deltaStr, vx, valueY + fitted * 0.42);
                ctx.globalAlpha = 1;
                ctx.restore();
            }

            var spY = pad + labelSize + Math.max(6, pad * 0.2);
            var spH = innerH - labelSize - Math.max(12, pad * 0.5);
            if (sparkVals.length < 2 && sparkVals.length === 1) {
                sparkVals = [sparkVals[0], sparkVals[0]];
            }

            if (sparkVals.length >= 2) {
                var minV = sparkVals[0];
                var maxV = sparkVals[0];
                var si;
                for (si = 1; si < sparkVals.length; si++) {
                    if (sparkVals[si] < minV) minV = sparkVals[si];
                    if (sparkVals[si] > maxV) maxV = sparkVals[si];
                }
                var rng = maxV - minV;
                if (rng < 1e-9) rng = 1;
                var topPad = spH * 0.12;
                var botPad = spH * 0.18;
                var plotH = spH - topPad - botPad;
                var plotY = spY + topPad;
                var xs = [];
                var ys = [];
                for (si = 0; si < sparkVals.length; si++) {
                    var tix = sparkVals.length === 1 ? 0 : si / (sparkVals.length - 1);
                    xs.push(sparkX + tix * sparkW);
                    ys.push(plotY + plotH - ((sparkVals[si] - minV) / rng) * plotH);
                }

                ctx.save();
                T.roundRect(ctx, sparkX, spY, sparkW, spH, Math.min(8, sparkW * 0.08));
                ctx.clip();

                var bottomY = plotY + plotH + botPad;
                ctx.beginPath();
                traceSparkLine(ctx, xs, ys);
                ctx.lineTo(xs[xs.length - 1], bottomY);
                ctx.lineTo(xs[0], bottomY);
                ctx.closePath();
                ctx.fillStyle = T.withAlpha(accentColor, 0.15 * accentIntensity);
                ctx.fill();

                ctx.strokeStyle = accentColor;
                ctx.lineWidth = Math.max(1.2, Math.min(3, sparkW * 0.006));
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.shadowColor = accentColor;
                ctx.shadowBlur = 6 * accentIntensity;
                traceSparkLine(ctx, xs, ys);
                ctx.stroke();

                T.resetShadow(ctx);
                ctx.restore();
            }

            T.resetShadow(ctx);
        }
    });
});
