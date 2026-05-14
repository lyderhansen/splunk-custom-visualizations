/*
 * Porsche Taycan EV — Battery Gauge (270° arc, glass, ambient glow)
 * ES5 only — Splunk custom visualization
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var T = require('shared/theme');

    function tierFillColor(val, goodTh, warnTh, goodC, warnC, dangerC) {
        var v = parseFloat(val);
        if (isNaN(v)) v = 0;
        if (v >= goodTh) return goodC;
        if (v >= warnTh) return warnC;
        return dangerC;
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('porsche-cursor-battery-gauge');
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';
            this._lastGoodData = null;
            this._viewSetup = false;
            this._ro = null;
            this.setupView();
        },

        setupView: function() {
            if (this._viewSetup) return;
            this._viewSetup = true;

            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            var self = this;
            T.loadFonts(function() {
                if (typeof self.invalidateUpdateView === 'function') {
                    self.invalidateUpdateView();
                }
            });

            if (typeof ResizeObserver !== 'undefined') {
                this._ro = new ResizeObserver(function() {
                    self.reflow();
                });
                this._ro.observe(this.el);
            }
        },

        destroy: function() {
            if (this._ro) {
                try {
                    this._ro.disconnect();
                } catch (e) {}
                this._ro = null;
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
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
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Battery gauge'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            var row = data.rows[data.rows.length - 1];
            var result = { colIdx: colIdx, row: row };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!this.canvas) return;

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
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            var ns = T.getNS(this);
            var theme = T.getTheme('dark');
            var t = theme;

            var fieldName = T.getOption(config, ns, 'field', 'value');
            var labelField = T.getOption(config, ns, 'labelField', 'label');
            var titleText = T.getOption(config, ns, 'title', 'Battery Level');
            var unit = T.getOption(config, ns, 'unit', '%');
            var maxValue = parseFloat(T.getOption(config, ns, 'maxValue', '100'));
            var minValue = parseFloat(T.getOption(config, ns, 'minValue', '0'));
            if (isNaN(maxValue)) maxValue = 100;
            if (isNaN(minValue)) minValue = 0;

            var valueFontPx = parseInt(T.getOption(config, ns, 'valueFontSize', '0'), 10);
            var labelFontPx = parseInt(T.getOption(config, ns, 'labelFontSize', '0'), 10);
            if (isNaN(valueFontPx)) valueFontPx = 0;
            if (isNaN(labelFontPx)) labelFontPx = 0;

            var accentIntensity = parseFloat(T.getOption(config, ns, 'accentIntensity', '0.7'));
            if (isNaN(accentIntensity)) accentIntensity = 0.7;
            if (accentIntensity < 0) accentIntensity = 0;
            if (accentIntensity > 1) accentIntensity = 1;

            var goodColor = T.getOption(config, ns, 'goodColor', '#00C9A7');
            var warnColor = T.getOption(config, ns, 'warnColor', '#F59E0B');
            var dangerColor = T.getOption(config, ns, 'dangerColor', '#EF4444');
            var goodThreshold = parseFloat(T.getOption(config, ns, 'goodThreshold', '60'));
            var warnThreshold = parseFloat(T.getOption(config, ns, 'warnThreshold', '30'));
            if (isNaN(goodThreshold)) goodThreshold = 60;
            if (isNaN(warnThreshold)) warnThreshold = 30;

            var rawNum = NaN;
            if (data.colIdx[fieldName] !== undefined) {
                rawNum = parseFloat(data.row[data.colIdx[fieldName]]);
            }
            if (isNaN(rawNum)) rawNum = 0;

            var span = maxValue - minValue;
            var pct = span > 0 ? (rawNum - minValue) / span : 0;
            if (pct < 0) pct = 0;
            if (pct > 1) pct = 1;

            var pctForTier = span > 0 ? ((rawNum - minValue) / span) * 100 : 0;
            if (pctForTier < 0) pctForTier = 0;
            if (pctForTier > 100) pctForTier = 100;

            var labelText = '';
            if (data.colIdx[labelField] !== undefined && data.row[data.colIdx[labelField]] !== null &&
                data.row[data.colIdx[labelField]] !== undefined) {
                labelText = String(data.row[data.colIdx[labelField]]);
            }
            if (!labelText) labelText = titleText;

            var fillHex = tierFillColor(pctForTier, goodThreshold, warnThreshold,
                goodColor, warnColor, dangerColor);

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

            var titleSize = Math.max(10, Math.min(18, Math.min(w, h) * 0.038));
            ctx.font = '500 ' + titleSize + 'px ' + T.FONTS.ui;
            ctx.fillStyle = T.withAlpha(t.text, 0.85);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(titleText, w * 0.5, pad + 6);
            T.resetShadow(ctx);

            var cx = w * 0.5;
            var cy = h * 0.52;
            var minDim = Math.min(w, h);
            var radius = minDim * 0.33;
            var lineWidth = minDim * 0.12;

            var startAng = (225 * Math.PI) / 180;
            var sweep = (270 * Math.PI) / 180;
            var endAng = startAng + sweep;
            var valueAng = startAng + sweep * pct;

            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAng, endAng, false);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();
            T.resetShadow(ctx);

            var glowBlur = 20 * accentIntensity;
            var glowAlpha = 0.55 * accentIntensity;

            if (pct > 0.002) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAng, valueAng, false);
                ctx.shadowBlur = glowBlur;
                ctx.shadowColor = T.withAlpha(fillHex, glowAlpha);
                ctx.strokeStyle = fillHex;
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.stroke();
                T.resetShadow(ctx);
                ctx.restore();

                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAng, valueAng, false);
                ctx.strokeStyle = fillHex;
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.stroke();
                T.resetShadow(ctx);
            }

            var dispVal = T.fmtNum(rawNum, { decimals: 0 });
            var valueStr = dispVal + unit;

            var vf = valueFontPx;
            if (vf <= 0) {
                vf = Math.max(16, Math.min(68, minDim * 0.18));
            }
            var maxTextW = w - pad * 4;
            var fitted = T.fitText(ctx, valueStr, maxTextW, vf, 12);
            ctx.font = '700 ' + fitted + 'px ' + T.FONTS.mono;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(valueStr, cx, cy - minDim * 0.01);
            T.resetShadow(ctx);

            var lf = labelFontPx;
            if (lf <= 0) {
                lf = Math.max(9, Math.min(20, minDim * 0.065));
            }
            ctx.font = '400 ' + lf + 'px ' + T.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textBaseline = 'top';
            var labelToShow = labelText;
            var lw = ctx.measureText(labelToShow).width;
            if (lw > maxTextW) {
                while (labelToShow.length > 1 && ctx.measureText(labelToShow + '…').width > maxTextW) {
                    labelToShow = labelToShow.substring(0, labelToShow.length - 1);
                }
                if (labelToShow.length < String(labelText).length) {
                    labelToShow = labelToShow + '…';
                }
            }
            ctx.fillText(labelToShow, cx, cy + minDim * 0.1);
            T.resetShadow(ctx);
        },

        reflow: function() {
            this.invalidateUpdateView();
        }
    });
});
