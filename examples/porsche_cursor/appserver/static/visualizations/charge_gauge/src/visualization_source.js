define(['api/SplunkVisualizationBase', 'api/SplunkVisualizationUtils'], function (SplunkVisualizationBase, SplunkVisualizationUtils) {
    var T = require('shared/theme');

    function drawArcStroke(ctx, cx, cy, r, startAng, endAng, width, color, cap) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, startAng, endAng, false);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = cap || 'round';
        ctx.stroke();
        ctx.restore();
    }

    function drawTargetTriangle(ctx, cx, cy, r, ang, size, color, doGlow) {
        var bx = Math.cos(ang);
        var by = Math.sin(ang);
        var px = -by;
        var py = bx;
        var tipR = r + size * 1.35;
        var tipX = cx + tipR * bx;
        var tipY = cy + tipR * by;
        var rb = r - size * 0.35;
        var base1x = cx + rb * bx + px * size * 0.65;
        var base1y = cy + rb * by + py * size * 0.65;
        var base2x = cx + rb * bx - px * size * 0.65;
        var base2y = cy + rb * by - py * size * 0.65;
        T.resetShadow(ctx);
        ctx.save();
        if (doGlow) {
            ctx.shadowColor = T.withAlpha(color, 0.85);
            ctx.shadowBlur = size * 2.2;
        }
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(base1x, base1y);
        ctx.lineTo(base2x, base2y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        T.resetShadow(ctx);
        ctx.restore();
    }

    return SplunkVisualizationBase.extend({
        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('porsche-cursor-charge-gauge');
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';
            this._lastGoodData = null;
            this._viewSetup = false;
            this._ro = null;
            this.setupView();
        },

        setupView: function () {
            if (this._viewSetup) {
                return;
            }
            this._viewSetup = true;

            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            var self = this;
            T.loadFonts(function () {
                if (typeof self.invalidateUpdateView === 'function') {
                    self.invalidateUpdateView();
                }
            });

            if (typeof ResizeObserver !== 'undefined') {
                this._ro = new ResizeObserver(function () {
                    self.reflow();
                });
                this._ro.observe(this.el);
            }
        },

        destroy: function () {
            if (this._ro) {
                try {
                    this._ro.disconnect();
                } catch (e) {}
                this._ro = null;
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        },

        getInitialDataParams: function () {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 1
            };
        },

        formatData: function (data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) {
                    return this._lastGoodData;
                }
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Charging power gauge'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            var row = data.rows[data.rows.length - 1];
            var result = { colIdx: colIdx, row: row };
            if (colIdx.value !== undefined) {
                result.value = row[colIdx.value];
            }
            if (colIdx.label !== undefined) {
                result.label = row[colIdx.label];
            }
            if (colIdx.target !== undefined) {
                result.target = row[colIdx.target];
            }
            this._lastGoodData = result;
            return result;
        },

        updateView: function (data, config) {
            if (!this.canvas) {
                return;
            }

            if (!data) {
                if (this._lastGoodData) {
                    data = this._lastGoodData;
                } else {
                    return;
                }
            }

            var el = this.el;
            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) {
                return;
            }

            var dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
            var canvas = this.canvas;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            var ns = T.getNS(this);
            var t = T.getTheme('dark');

            var fieldName = T.getOption(config, ns, 'field', 'value');
            var labelField = T.getOption(config, ns, 'labelField', 'label');
            var targetField = T.getOption(config, ns, 'targetField', 'target');
            var titleText = T.getOption(config, ns, 'title', 'Charging Power');
            var unitStr = T.getOption(config, ns, 'unit', 'kW');
            var maxV = parseFloat(T.getOption(config, ns, 'maxValue', '350'));
            var minV = parseFloat(T.getOption(config, ns, 'minValue', '0'));
            if (isNaN(maxV)) {
                maxV = 350;
            }
            if (isNaN(minV)) {
                minV = 0;
            }

            var valueFontPx = parseInt(T.getOption(config, ns, 'valueFontSize', '0'), 10);
            var labelFontPx = parseInt(T.getOption(config, ns, 'labelFontSize', '0'), 10);
            if (isNaN(valueFontPx)) {
                valueFontPx = 0;
            }
            if (isNaN(labelFontPx)) {
                labelFontPx = 0;
            }

            var accentIntensity = parseFloat(T.getOption(config, ns, 'accentIntensity', '0.7'));
            if (isNaN(accentIntensity)) {
                accentIntensity = 0.7;
            }
            if (accentIntensity < 0) {
                accentIntensity = 0;
            }
            if (accentIntensity > 1) {
                accentIntensity = 1;
            }

            var arcColor = T.getOption(config, ns, 'arcColor', '#3B82F6');
            var targetColor = T.getOption(config, ns, 'targetColor', '#C8A96E');

            var valueNum = NaN;
            if (data.colIdx[fieldName] !== undefined) {
                valueNum = parseFloat(data.row[data.colIdx[fieldName]]);
            }

            var targetNum = NaN;
            if (data.colIdx[targetField] !== undefined) {
                targetNum = parseFloat(data.row[data.colIdx[targetField]]);
            }

            var span = maxV - minV;
            if (!(span > 0)) {
                span = 350;
                minV = 0;
                maxV = 350;
            }

            var pct = isNaN(valueNum) ? 0 : (valueNum - minV) / span;
            if (pct < 0) {
                pct = 0;
            }
            if (pct > 1) {
                pct = 1;
            }

            var tgtPct = null;
            if (!isNaN(targetNum)) {
                tgtPct = (targetNum - minV) / span;
                if (tgtPct < 0) {
                    tgtPct = 0;
                }
                if (tgtPct > 1) {
                    tgtPct = 1;
                }
            }

            ctx.fillStyle = '#0A0A0F';
            ctx.fillRect(0, 0, w, h);

            var vig = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.1,
                w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
            vig.addColorStop(0, 'rgba(10,10,15,0)');
            vig.addColorStop(1, 'rgba(0,0,0,0.55)');
            ctx.fillStyle = vig;
            ctx.fillRect(0, 0, w, h);

            var pad = Math.max(8, Math.min(w, h) * 0.04);
            var panelR = Math.max(10, Math.min(w, h) * 0.03);
            T.drawGlassPanel(ctx, t, pad, pad, w - 2 * pad, h - 2 * pad, panelR);
            T.resetShadow(ctx);

            var minDim = Math.min(w, h);
            var cx = w * 0.5;
            var cy = h * 0.52;
            var radius = minDim * 0.33;
            var lineWidth = minDim * 0.12;

            var startAng = (225 * Math.PI) / 180;
            var sweep = (270 * Math.PI) / 180;
            var endAng = startAng + sweep;
            var valueAng = startAng + sweep * pct;

            drawArcStroke(ctx, cx, cy, radius, startAng, endAng, lineWidth, 'rgba(255,255,255,0.06)', 'round');
            T.resetShadow(ctx);

            if (pct > 0.002) {
                var glowBlur = (18 + 14 * accentIntensity) * (minDim / 400);
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAng, valueAng, false);
                ctx.shadowBlur = glowBlur;
                ctx.shadowColor = T.withAlpha(arcColor, 0.35 + accentIntensity * 0.45);
                ctx.strokeStyle = T.withAlpha(arcColor, 0.35);
                ctx.lineWidth = lineWidth + lineWidth * 0.65 * accentIntensity;
                ctx.lineCap = 'round';
                ctx.stroke();
                T.resetShadow(ctx);
                ctx.restore();

                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAng, valueAng, false);
                ctx.strokeStyle = arcColor;
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.stroke();
                T.resetShadow(ctx);
            }

            if (tgtPct !== null) {
                var targetAng = startAng + sweep * tgtPct;
                var triSize = Math.max(3, minDim * 0.024);
                drawTargetTriangle(ctx, cx, cy, radius, targetAng, triSize, targetColor, true);
                T.resetShadow(ctx);

                var tgtLabel = 'Target: ' + T.fmtNum(targetNum, { decimals: 0 }) + ' ' + unitStr;
                var lr = radius + lineWidth * 2 + minDim * 0.085;
                var lx = cx + lr * Math.cos(targetAng);
                var ly = cy + lr * Math.sin(targetAng);
                var tgtFont = labelFontPx > 0 ? Math.max(8, labelFontPx * 0.45) : Math.max(8, Math.min(14, minDim * 0.028));
                ctx.save();
                ctx.font = '400 ' + tgtFont + 'px ' + T.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(tgtLabel, lx, ly);
                ctx.restore();
            }

            var labelText = '';
            if (data.colIdx[labelField] !== undefined && data.row[data.colIdx[labelField]] !== null &&
                data.row[data.colIdx[labelField]] !== undefined) {
                labelText = String(data.row[data.colIdx[labelField]]);
            }
            if (!labelText) {
                labelText = titleText;
            }

            var valStr = isNaN(valueNum) ? '—' : T.fmtNum(valueNum, { decimals: 0 });
            var vf = valueFontPx;
            if (vf <= 0) {
                vf = Math.max(16, Math.min(68, minDim * 0.18));
            }

            var uw = 0;
            if (!isNaN(valueNum)) {
                ctx.font = '600 ' + Math.max(10, Math.min(28, vf * 0.42)) + 'px ' + T.FONTS.mono;
                uw = ctx.measureText(' ' + unitStr).width;
            }

            ctx.font = '700 ' + vf + 'px ' + T.FONTS.mono;
            var tw = ctx.measureText(valStr).width;
            var maxTextW = w - pad * 4;
            var fittedVal = T.fitText(ctx, valStr, maxTextW - uw, vf, 12);
            ctx.font = '700 ' + fittedVal + 'px ' + T.FONTS.mono;
            tw = ctx.measureText(valStr).width;

            var unitFont = Math.max(10, Math.min(28, fittedVal * 0.42));
            ctx.font = '600 ' + unitFont + 'px ' + T.FONTS.mono;
            if (!isNaN(valueNum)) {
                uw = ctx.measureText(' ' + unitStr).width;
            }

            var cxText = cx - (tw + uw) / 2;
            var valY = cy - minDim * 0.01;

            ctx.fillStyle = t.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '700 ' + fittedVal + 'px ' + T.FONTS.mono;
            ctx.fillText(valStr, cxText, valY);

            if (!isNaN(valueNum)) {
                ctx.fillStyle = t.textDim;
                ctx.font = '600 ' + unitFont + 'px ' + T.FONTS.mono;
                ctx.fillText(' ' + unitStr, cxText + tw, valY);
            }
            T.resetShadow(ctx);

            var lf = labelFontPx;
            if (lf <= 0) {
                lf = Math.max(9, Math.min(20, minDim * 0.065));
            }
            ctx.font = '400 ' + lf + 'px ' + T.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            var labelToShow = labelText;
            var lmw = maxTextW;
            if (ctx.measureText(labelToShow).width > lmw) {
                while (labelToShow.length > 1 && ctx.measureText(labelToShow + '…').width > lmw) {
                    labelToShow = labelToShow.substring(0, labelToShow.length - 1);
                }
                if (labelToShow.length < String(labelText).length) {
                    labelToShow = labelToShow + '…';
                }
            }
            ctx.fillText(labelToShow, cx, cy + minDim * 0.1);
            T.resetShadow(ctx);

            var edgeVig = ctx.createRadialGradient(cx, cy, minDim * 0.2, cx, cy, Math.max(w, h) * 0.72);
            edgeVig.addColorStop(0, 'rgba(10,10,15,0)');
            edgeVig.addColorStop(1, 'rgba(0,0,0,0.38)');
            ctx.fillStyle = edgeVig;
            ctx.fillRect(pad, pad, w - 2 * pad, h - 2 * pad);
            T.resetShadow(ctx);
        },

        reflow: function () {
            this.invalidateUpdateView();
        }
    });
});
