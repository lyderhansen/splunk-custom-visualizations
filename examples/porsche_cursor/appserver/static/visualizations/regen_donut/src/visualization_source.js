/*
 * Porsche Taycan EV — Regeneration donut (energy mix: consumption, regen, climate)
 * ES5 only — Splunk custom visualization
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var T = require('shared/theme');

    var TWO_PI = Math.PI * 2;
    var GAP_DEG = 2;
    var GAP_RAD = (GAP_DEG * Math.PI) / 180;

    function normAngle(t) {
        while (t < 0) t += TWO_PI;
        while (t >= TWO_PI) t -= TWO_PI;
        return t;
    }

    function pickColorForCategory(cat, colors, idx) {
        var k = String(cat === null || cat === undefined ? '' : cat).toLowerCase();
        if (k.indexOf('consum') >= 0) return colors[0] || '#EF4444';
        if (k.indexOf('regen') >= 0) return colors[1] || '#00C9A7';
        if (k.indexOf('climat') >= 0) return colors[2] || '#3B82F6';
        return colors[idx % (colors.length || 1)] || '#7C7C84';
    }

    function brighten(hex, mix) {
        return T.lerpColor(hex, '#FFFFFF', mix);
    }

    function findRegenIndex(segments) {
        var i;
        for (i = 0; i < segments.length; i++) {
            var nm = String(segments[i].category || '').toLowerCase();
            if (nm.indexOf('regen') >= 0) return i;
        }
        return -1;
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('porsche-cursor-regen-donut');
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';
            this._lastGoodData = null;
            this._viewSetup = false;
            this._ro = null;
            this._mouseX = 0;
            this._mouseY = 0;
            this._hoverIdx = -1;
            this._geom = {
                cx: 0,
                cy: 0,
                rOut: 0,
                rIn: 0,
                segs: []
            };
            this.setupView();
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 50
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Energy distribution'
                );
            }
            var fields = data.fields;
            var colIdx = {};
            var fi;
            for (fi = 0; fi < fields.length; fi++) {
                colIdx[fields[fi].name] = fi;
            }
            var result = { rows: data.rows, colIdx: colIdx };
            this._lastGoodData = result;
            return result;
        },

        setupView: function() {
            if (this._viewSetup) return;
            this._viewSetup = true;

            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.cursor = 'default';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            var self = this;

            this._onMouseMove = function(ev) {
                var rect = self.canvas.getBoundingClientRect();
                self._mouseX = ev.clientX - rect.left;
                self._mouseY = ev.clientY - rect.top;
                var pick = self._pickSegment(self._mouseX, self._mouseY);
                if (pick !== self._hoverIdx) {
                    self._hoverIdx = pick;
                    self.canvas.style.cursor = pick >= 0 ? 'pointer' : 'default';
                    if (typeof self.invalidateUpdateView === 'function') {
                        self.invalidateUpdateView();
                    }
                }
            };

            this._onMouseLeave = function() {
                self._mouseX = -1;
                self._mouseY = -1;
                if (self._hoverIdx !== -1) {
                    self._hoverIdx = -1;
                    self.canvas.style.cursor = 'default';
                    if (typeof self.invalidateUpdateView === 'function') {
                        self.invalidateUpdateView();
                    }
                }
            };

            this.canvas.addEventListener('mousemove', this._onMouseMove);
            this.canvas.addEventListener('mouseleave', this._onMouseLeave);

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
            if (this.canvas && this._onMouseMove) {
                this.canvas.removeEventListener('mousemove', this._onMouseMove);
                this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
            }
            if (this._ro) {
                try {
                    this._ro.disconnect();
                } catch (e) {}
                this._ro = null;
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        },

        _pickSegment: function(lx, ly) {
            var g = this._geom;
            var nHit = g.segs.length;
            if (nHit === 0) return -1;
            var dx = lx - g.cx;
            var dy = ly - g.cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < g.rIn - 2 || dist > g.rOut + 6) {
                return -1;
            }
            var phi = Math.atan2(dy, dx);
            var t = normAngle(phi + Math.PI / 2);
            var i;
            for (i = 0; i < nHit; i++) {
                var s = g.segs[i];
                var last = i === nHit - 1;
                if (last) {
                    if (t + 1e-6 >= s.t0 && t <= s.t1 + 1e-6) return i;
                } else if (t + 1e-6 >= s.t0 && t < s.t1 - 1e-6) {
                    return i;
                }
            }
            return -1;
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

            T.resetShadow(ctx);

            var ns = T.getNS(this);
            var t = T.getTheme('dark');

            var catField = T.getOption(config, ns, 'categoryField', 'category');
            var valField = T.getOption(config, ns, 'valueField', 'value');
            var titleText = T.getOption(config, ns, 'title', 'Energy Distribution');
            var colorsRaw = T.getOption(config, ns, 'colors', '#EF4444,#00C9A7,#3B82F6,#A78BFA,#C8A96E');
            var accentIntensity = parseFloat(T.getOption(config, ns, 'accentIntensity', '0.7'));
            if (isNaN(accentIntensity)) accentIntensity = 0.7;
            if (accentIntensity < 0) accentIntensity = 0;
            if (accentIntensity > 1) accentIntensity = 1;

            var valueFontPx = parseInt(T.getOption(config, ns, 'valueFontSize', '0'), 10);
            var labelFontPx = parseInt(T.getOption(config, ns, 'labelFontSize', '0'), 10);
            if (isNaN(valueFontPx)) valueFontPx = 0;
            if (isNaN(labelFontPx)) labelFontPx = 0;

            var colIdx = data.colIdx;
            var rows = data.rows;
            if (!colIdx || !rows || rows.length === 0) {
                return;
            }

            var ci = colIdx[catField];
            var vi = colIdx[valField];
            if (ci === undefined || vi === undefined) {
                ctx.font = '400 12px ' + T.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText('Missing columns for category or value', 12, 12);
                T.resetShadow(ctx);
                return;
            }

            var palette = T.parseColors(colorsRaw, ['#EF4444', '#00C9A7', '#3B82F6', '#A78BFA', '#C8A96E']);

            var segments = [];
            var ri;
            for (ri = 0; ri < rows.length; ri++) {
                var row = rows[ri];
                var rawC = row[ci];
                var category = rawC === null || rawC === undefined ? '' : String(rawC);
                var v = parseFloat(row[vi]);
                if (isNaN(v) || v < 0) v = 0;
                if (v <= 0) continue;
                segments.push({ category: category, value: v });
            }

            var n = segments.length;
            var total = 0;
            var si;
            for (si = 0; si < n; si++) {
                total += segments[si].value;
            }

            var pad = Math.max(8, Math.min(w, h) * 0.04);
            var panelR = Math.max(10, Math.min(w, h) * 0.03);

            ctx.fillStyle = '#0A0A0F';
            ctx.fillRect(0, 0, w, h);

            var vig = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.1,
                w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
            vig.addColorStop(0, 'rgba(10,10,15,0)');
            vig.addColorStop(1, 'rgba(0,0,0,0.55)');
            ctx.fillStyle = vig;
            ctx.fillRect(0, 0, w, h);
            T.resetShadow(ctx);

            T.drawGlassPanel(ctx, t, pad, pad, w - pad * 2, h - pad * 2, panelR);
            T.resetShadow(ctx);

            var innerX = pad + 14;
            var innerY = pad + 14;
            var innerW = w - pad * 2 - 28;
            var innerH = h - pad * 2 - 28;

            var titleSize = Math.max(10, Math.min(18, Math.min(w, h) * 0.038));
            ctx.font = '500 ' + titleSize + 'px ' + T.FONTS.ui;
            ctx.fillStyle = T.withAlpha(t.text, 0.9);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(titleText, innerX, innerY);
            T.resetShadow(ctx);

            var titleBand = titleSize + 16;
            var contentTop = innerY + titleBand;
            var contentH = innerH - titleBand;
            var layoutWide = w >= h * 1.12;
            var legendW = layoutWide ? Math.min(200, innerW * 0.34) : innerW;
            var donutAreaW = layoutWide ? innerW - legendW - 18 : innerW;
            var donutAreaH = layoutWide ? contentH : Math.max(contentH * 0.62, Math.min(w, h) * 0.42);

            var cx = innerX + donutAreaW * 0.5;
            var cy = contentTop + donutAreaH * 0.5;
            var minDim = Math.min(donutAreaW, donutAreaH);
            var rOut = minDim * 0.35;
            if (rOut < 8) rOut = 8;
            var rIn = rOut * 0.6;

            this._geom.cx = cx;
            this._geom.cy = cy;
            this._geom.rOut = rOut;
            this._geom.rIn = rIn;
            this._geom.segs = [];

            if (n === 0 || total <= 0) {
                ctx.font = '400 13px ' + T.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('No data', cx, cy);
                T.resetShadow(ctx);
                return;
            }

            var gapRad = GAP_RAD;
            var totalDataAngle = TWO_PI - n * gapRad;
            var accT = gapRad / 2;
            var canvasAcc = (-Math.PI / 2) + gapRad / 2;
            var ki;
            var hoverMix = 0.12 + accentIntensity * 0.18;
            var glowBlur = 12 * accentIntensity;
            var glowAlpha = 0.42 * accentIntensity;

            for (ki = 0; ki < n; ki++) {
                var seg = segments[ki];
                var frac = seg.value / total;
                var sweep = frac * totalDataAngle;
                var t0 = accT;
                var t1 = accT + sweep;
                accT = t1 + gapRad;

                var baseCol = pickColorForCategory(seg.category, palette, ki);
                var isHover = ki === this._hoverIdx;
                var col = isHover ? brighten(baseCol, hoverMix + 0.08) : baseCol;
                var ro = isHover ? rOut + 4 : rOut;
                var canvasStart = canvasAcc;
                var canvasEnd = canvasAcc + sweep;
                canvasAcc = canvasEnd + gapRad;

                ctx.save();
                ctx.shadowBlur = glowBlur;
                ctx.shadowColor = T.withAlpha(baseCol, glowAlpha);
                ctx.beginPath();
                ctx.arc(cx, cy, ro, canvasStart, canvasEnd, false);
                ctx.arc(cx, cy, rIn, canvasEnd, canvasStart, true);
                ctx.closePath();
                ctx.fillStyle = col;
                ctx.fill();
                T.resetShadow(ctx);
                ctx.restore();

                ctx.beginPath();
                ctx.arc(cx, cy, ro, canvasStart, canvasEnd, false);
                ctx.arc(cx, cy, rIn, canvasEnd, canvasStart, true);
                ctx.closePath();
                ctx.fillStyle = col;
                ctx.fill();
                T.resetShadow(ctx);

                this._geom.segs.push({ t0: t0, t1: t1 });
            }

            var regIdx = findRegenIndex(segments);
            var centerValueStr;
            var centerLabelStr;
            if (regIdx >= 0) {
                var rv = segments[regIdx].value;
                centerValueStr = T.fmtNum(rv, { decimals: 1 }) + '%';
                centerLabelStr = 'Regen';
            } else {
                centerValueStr = '100%';
                centerLabelStr = 'Total';
            }

            var cvf = valueFontPx;
            if (cvf <= 0) {
                cvf = Math.max(14, Math.min(56, minDim * 0.2));
            }
            var maxCW = rIn * 1.85;
            var valueFit = T.fitText(ctx, centerValueStr, maxCW, cvf, 12);
            ctx.font = '700 ' + valueFit + 'px ' + T.FONTS.mono;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(centerValueStr, cx, cy - 2);
            T.resetShadow(ctx);

            var clf = labelFontPx;
            if (clf <= 0) {
                clf = Math.max(9, Math.min(20, minDim * 0.07));
            }
            ctx.font = '500 ' + clf + 'px ' + T.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textBaseline = 'top';
            ctx.fillText(centerLabelStr, cx, cy + 4);
            T.resetShadow(ctx);

            var legX = layoutWide ? innerX + donutAreaW + 22 : innerX;
            var legY = layoutWide ? contentTop + 18 : contentTop + donutAreaH + 12;
            var rowGap = Math.max(14, minDim * 0.1);
            var dotR = Math.max(3, minDim * 0.035);
            var lr;
            for (lr = 0; lr < n; lr++) {
                var legSeg = segments[lr];
                var legCol = pickColorForCategory(legSeg.category, palette, lr);
                var ly = legY + lr * rowGap;
                ctx.beginPath();
                ctx.arc(legX + dotR, ly, dotR, 0, TWO_PI);
                ctx.fillStyle = legCol;
                ctx.fill();
                T.resetShadow(ctx);

                var pctStr = T.fmtNum((legSeg.value / total) * 100, { decimals: 1 }) + '%';
                var nameStr = legSeg.category;

                ctx.font = '500 ' + Math.max(10, Math.min(14, clf)) + 'px ' + T.FONTS.ui;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                var nameW = ctx.measureText(nameStr).width;
                ctx.fillText(nameStr, legX + dotR * 2 + 8, ly);
                T.resetShadow(ctx);

                ctx.font = '500 ' + Math.max(10, Math.min(14, clf)) + 'px ' + T.FONTS.mono;
                ctx.fillStyle = t.textDim;
                ctx.fillText(pctStr, legX + dotR * 2 + 18 + nameW, ly);
                T.resetShadow(ctx);
            }
        },

        reflow: function() {
            this.invalidateUpdateView();
        }
    });
});
