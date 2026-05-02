/*
 * Conversion Funnel — Splunk Custom Visualization
 *
 * Sequential drop-off across stages. 5-7 stages typical.
 * Each row shows a stage label, a proportional bar, and step-conversion %.
 *
 * Expected SPL: | stats count by stage | sort stage_order
 *   First column = stage label, second column = count.
 *   Rows ordered top-to-bottom (first row = top of funnel).
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {


    // ── Tooltip helper ──────────────────────────────────────────

    function drawHoverTooltip(ctx, mx, my, lines, theme, fonts, canvasW, canvasH) {
        var padX = 10, padY = 8, lineH = 18;
        var maxW = 0;
        for (var i = 0; i < lines.length; i++) {
            ctx.font = lines[i].bold ? '600 12px ' + fonts.mono : '11px ' + fonts.primary;
            var tw = ctx.measureText(lines[i].text).width;
            if (lines[i].dot) tw += 14;
            if (tw > maxW) maxW = tw;
        }
        var cardW = padX * 2 + maxW;
        var cardH = padY * 2 + lines.length * lineH;
        var tx = mx + 12;
        var ty = my - cardH / 2;
        if (tx + cardW > canvasW) tx = mx - cardW - 12;
        if (ty + cardH > canvasH) ty = canvasH - cardH - 4;
        if (ty < 4) ty = 4;

        draw.roundRect(ctx, tx, ty, cardW, cardH, 6);
        ctx.fillStyle = theme.panel;
        ctx.fill();
        ctx.strokeStyle = theme.edgeStrong;
        ctx.lineWidth = 1;
        ctx.stroke();

        for (var i = 0; i < lines.length; i++) {
            var ry = ty + padY + i * lineH + lineH / 2;
            var lx = tx + padX;
            if (lines[i].dot) {
                ctx.beginPath();
                ctx.arc(lx + 4, ry, 4, 0, Math.PI * 2);
                ctx.fillStyle = lines[i].dot;
                ctx.fill();
                lx += 14;
            }
            ctx.font = lines[i].bold ? '600 12px ' + fonts.mono : '11px ' + fonts.primary;
            ctx.fillStyle = lines[i].dimmed ? theme.textFaint : (lines[i].colored || theme.text);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(lines[i].text, lx, ry);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-funnel-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
            this._hoverIndex = -1;
            this._lastMouseEvent = null;
            var self = this;
            this.canvas.addEventListener('mousemove', function(e) {
                self._lastMouseEvent = e;
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                var newIdx = -1;
                for (var i = 0; i < self._hitAreas.length; i++) {
                    var h = self._hitAreas[i];
                    if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) {
                        newIdx = i;
                        break;
                    }
                }
                if (newIdx !== self._hoverIndex) {
                    self._hoverIndex = newIdx;
                    self.invalidateUpdateView();
                }
                self.canvas.style.cursor = newIdx >= 0 ? 'pointer' : 'default';
            });
            this.canvas.addEventListener('mouseleave', function() {
                self._lastMouseEvent = null;
                if (self._hoverIndex !== -1) {
                    self._hoverIndex = -1;
                    self.invalidateUpdateView();
                }
                self.canvas.style.cursor = 'default';
            });
            this._hitAreas = [];
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data, config) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Funnel'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            var result = { colIdx: colIdx, rows: data.rows };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            // ── Read settings ──
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName            = (config[ns + 'theme'] || 'dark');
            var labelField           = (config[ns + 'labelField'] || 'stage');
            var valueField           = (config[ns + 'valueField'] || 'count');
            var dropoffWarnThreshold = parseFloat(config[ns + 'dropoffWarnThreshold'] || '30');

            var theme = tokens.getTheme(themeName);

            // ── Extract stage labels and values ──
            var rows = data.rows;
            var colIdx = data.colIdx;
            var stages = [];
            var i;

            for (i = 0; i < rows.length; i++) {
                var row = rows[i];
                var label = '';
                var value = 0;

                if (colIdx[labelField] !== undefined) {
                    label = String(row[colIdx[labelField]] || '');
                }
                if (colIdx[valueField] !== undefined) {
                    var v = parseFloat(row[colIdx[valueField]]);
                    if (!isNaN(v)) value = v;
                }

                stages.push({ label: label, value: value });
            }

            if (stages.length === 0) return;

            // ── Size canvas for HiDPI ──
            var el = this.el;
            var rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);

            var w = rect.width;
            var h = rect.height;
            ctx.clearRect(0, 0, w, h);

            this._hitAreas = [];

            // ── Layout constants ──
            var padX = 12;
            var padY = 10;
            var labelColW = 130;
            var convColW = 60;
            var barH = 26;
            var barR = 3;
            var rowGap = 8;
            var rowH = barH + rowGap;

            // Adjust label column if panel is narrow
            if (w < 340) {
                labelColW = Math.max(60, w * 0.25);
            }

            var barAreaX = padX + labelColW + 10;
            var barAreaW = w - barAreaX - convColW - padX - 10;
            if (barAreaW < 30) barAreaW = 30;

            // Scale down if too many rows
            var totalRowsH = stages.length * rowH - rowGap;
            var availH = h - padY * 2;
            if (totalRowsH > availH && availH > 0) {
                rowH = Math.max(18, availH / stages.length);
                barH = Math.max(14, rowH - rowGap);
                if (barH > rowH - 2) barH = rowH - 2;
            }

            // First stage value = baseline
            var firstValue = stages[0].value;
            if (firstValue <= 0) firstValue = 1;

            // ── Draw each stage row ──
            var hasHover = this._hoverIndex >= 0;

            for (i = 0; i < stages.length; i++) {
                var stage = stages[i];
                var rowY = padY + i * rowH;
                var barY = rowY;
                var midY = rowY + barH / 2;

                // ── Register hit area ──
                this._hitAreas.push({
                    x: 0, y: rowY, w: w, h: rowH,
                    label: stage.label,
                    value: stage.value,
                    index: i
                });

                // ── Hover highlight background ──
                if (hasHover && this._hoverIndex === i) {
                    ctx.fillStyle = theme.edge;
                    ctx.fillRect(0, rowY, w, rowH);
                }

                // ── Dim non-hovered rows ──
                ctx.globalAlpha = (hasHover && this._hoverIndex !== i) ? 0.6 : 1.0;

                // ── Stage label (left-aligned, ellipsis) ──
                ctx.font = '500 12.5px ' + tokens.fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                var truncLabel = draw.ellipsis(ctx, stage.label, labelColW);
                ctx.fillText(truncLabel, padX, midY);

                // ── Bar track background ──
                draw.roundRect(ctx, barAreaX, barY, barAreaW, barH, barR);
                ctx.fillStyle = theme.edge;
                ctx.fill();

                // ── Bar fill (proportional to firstValue) ──
                var fillRatio = stage.value / firstValue;
                if (fillRatio > 1) fillRatio = 1;
                var fillW = fillRatio * barAreaW;
                if (fillW < 1) fillW = 1;

                draw.roundRect(ctx, barAreaX, barY, fillW, barH, barR);
                ctx.fillStyle = theme.s2;
                ctx.fill();

                // ── Count text inside the bar ──
                var countText = draw.formatNumber(stage.value);
                ctx.font = '600 11.5px ' + tokens.fonts.mono;
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';

                // Only draw count if it fits inside the bar
                var countTextW = ctx.measureText(countText).width;
                if (countTextW + 20 <= fillW) {
                    ctx.fillText(countText, barAreaX + 10, midY);
                } else if (fillW > 20) {
                    // Try to fit with ellipsis
                    var truncCount = draw.ellipsis(ctx, countText, fillW - 20);
                    ctx.fillText(truncCount, barAreaX + 10, midY);
                }

                // ── Step-conversion percentage (right-aligned) ──
                var convText;
                var convColor;

                if (i === 0) {
                    convText = '100%';
                    convColor = theme.text;
                } else {
                    var prevValue = stages[i - 1].value;
                    var stepPct = 0;
                    if (prevValue > 0) {
                        stepPct = (stage.value / prevValue) * 100;
                    }
                    convText = stepPct.toFixed(1) + '%';
                    // Clean up trailing zero: 75.0% -> 75%
                    convText = convText.replace(/\.0%$/, '%');
                    convColor = (stepPct >= dropoffWarnThreshold) ? theme.text : theme.warn;
                }

                ctx.font = '500 12.5px ' + tokens.fonts.mono;
                ctx.fillStyle = convColor;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(convText, w - padX, midY);

                ctx.globalAlpha = 1.0;
            }

            // ── Hover tooltip ──
            if (hasHover && this._hoverIndex < this._hitAreas.length) {
                var hit = this._hitAreas[this._hoverIndex];
                var mRect = this.canvas.getBoundingClientRect();
                var lastEvt = this._lastMouseEvent;
                var tooltipMx = hit.x + hit.w / 2;
                var tooltipMy = hit.y + hit.h / 2;
                if (lastEvt) {
                    tooltipMx = lastEvt.clientX - mRect.left;
                    tooltipMy = lastEvt.clientY - mRect.top;
                }

                var hStage = stages[this._hoverIndex];
                var pctOfTotal = firstValue > 0 ? ((hStage.value / firstValue) * 100).toFixed(1) : '0';
                pctOfTotal = pctOfTotal.replace(/\.0$/, '');

                var tooltipLines = [
                    { text: hStage.label, bold: true },
                    { text: draw.formatNumber(hStage.value), dimmed: false },
                    { text: pctOfTotal + '% of total', dimmed: true }
                ];

                if (this._hoverIndex > 0) {
                    var prevVal = stages[this._hoverIndex - 1].value;
                    var stepConv = prevVal > 0 ? ((hStage.value / prevVal) * 100).toFixed(1) : '0';
                    stepConv = stepConv.replace(/\.0$/, '');
                    tooltipLines.push({ text: stepConv + '% from prev step', dimmed: true });
                }

                drawHoverTooltip(ctx, tooltipMx, tooltipMy, tooltipLines, theme, tokens.fonts, w, h);
            }

            // ── Reset state ──
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
