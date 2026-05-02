/*
 * Horizontal Bar List — Splunk Custom Visualization
 *
 * Top-N panel showing ranked items with horizontal bars.
 * Used for top sources, protocols, products, talkers, etc.
 *
 * Expected SPL: | top limit=10 source
 *           or: | stats count by source | sort -count | head 10
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {


    // ── Color tiering ────────────────────────────────────────────

    function barColor(index, total, theme, spotlightIndex) {
        if (index === spotlightIndex) return theme.orange;
        if (index <= 1) return theme.s2;
        if (index <= 4) return theme.s3;
        return theme.s4;
    }

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

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-h-bar-list-viz');

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
                    'Awaiting data — H-Bar List'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            if (colIdx._status !== undefined) {
                var statusRow = data.rows[data.rows.length - 1];
                var statusVal = statusRow[colIdx._status];
                if (statusVal) {
                    return { _status: statusVal };
                }
            }

            var result = { colIdx: colIdx, rows: data.rows };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (data && data._status) {
                this._ensureCanvas();
                this._drawStatusMessage(data._status);
                return;
            }

            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            // ── Read settings ──
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName      = (config[ns + 'theme'] || 'dark');
            var labelField     = (config[ns + 'labelField'] || 'source');
            var valueField     = (config[ns + 'valueField'] || 'count');
            var suffix         = (config[ns + 'suffix'] || '');
            var spotlightIndex = parseInt(config[ns + 'spotlightIndex'] || '-1', 10);
            var maxRows        = parseInt(config[ns + 'maxRows'] || '10', 10);

            if (isNaN(maxRows) || maxRows <= 0) maxRows = 10;

            var theme = tokens.getTheme(themeName);

            // ── Extract label+value pairs, sort descending ──
            var rows = data.rows;
            var colIdx = data.colIdx;
            var items = [];
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

                items.push({ label: label, value: value });
            }

            // Sort by value descending
            items.sort(function(a, b) { return b.value - a.value; });

            // Limit to maxRows
            if (items.length > maxRows) {
                items = items.slice(0, maxRows);
            }

            if (items.length === 0) return;

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

            // ── Layout ──
            var padX = 12;
            var padY = 8;
            var labelColW = 130;
            var valueColW = 64;
            var barH = 8;
            var barR = 4;
            var rowPadY = 7;
            var rowH = barH + rowPadY * 2;

            // Adjust label column if panel is narrow
            if (w < 300) {
                labelColW = Math.max(60, w * 0.3);
            }

            var barAreaX = padX + labelColW + 10;
            var barAreaW = w - barAreaX - valueColW - padX - 10;
            if (barAreaW < 20) barAreaW = 20;

            var maxValue = items[0].value;
            if (maxValue <= 0) maxValue = 1;

            // ── Draw rows ──
            var labelFontSize = 13;
            var valueFontSize = 13;

            // Scale down if too many rows
            var totalRowsH = items.length * rowH;
            var availH = h - padY * 2;
            if (totalRowsH > availH && availH > 0) {
                rowH = Math.max(14, availH / items.length);
                rowPadY = Math.max(2, (rowH - barH) / 2);
                labelFontSize = Math.min(13, rowH - 4);
                valueFontSize = Math.min(13, rowH - 4);
                labelFontSize = Math.max(9, labelFontSize);
                valueFontSize = Math.max(9, valueFontSize);
            }

            var hasHover = this._hoverIndex >= 0;

            for (i = 0; i < items.length; i++) {
                var item = items[i];
                var rowY = padY + i * rowH;
                var barY = rowY + rowPadY;
                var midY = rowY + rowH / 2;

                // ── Register hit area ──
                this._hitAreas.push({
                    x: 0, y: rowY, w: w, h: rowH,
                    label: item.label,
                    value: draw.formatNumber(item.value) + suffix
                });

                // ── Hover highlight background ──
                if (hasHover && this._hoverIndex === i) {
                    ctx.fillStyle = theme.edge;
                    ctx.fillRect(0, rowY, w, rowH);
                }

                // ── Bar alpha for hover dimming ──
                ctx.globalAlpha = (hasHover && this._hoverIndex !== i) ? 0.6 : 1.0;

                // ── Label (left, ellipsis at labelColW) ──
                ctx.font = '500 ' + labelFontSize + 'px ' + tokens.fonts.primary;
                ctx.fillStyle = theme.text;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                var truncLabel = draw.ellipsis(ctx, item.label, labelColW);
                ctx.fillText(truncLabel, padX, midY);

                // ── Bar track (edge background) ──
                draw.roundRect(ctx, barAreaX, barY, barAreaW, barH, barR);
                ctx.fillStyle = theme.edge;
                ctx.fill();

                // ── Bar fill ──
                var fillW = (item.value / maxValue) * barAreaW;
                if (fillW < 1) fillW = 1;
                var fillColor = barColor(i, items.length, theme, spotlightIndex);

                draw.roundRect(ctx, barAreaX, barY, fillW, barH, barR);
                ctx.fillStyle = fillColor;
                ctx.fill();

                // ── Value (right-aligned, monospace) ──
                var displayVal = draw.formatNumber(item.value) + suffix;
                ctx.font = '500 ' + valueFontSize + 'px ' + tokens.fonts.mono;
                ctx.fillStyle = theme.text;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(displayVal, w - padX, midY);

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
                var tooltipLines = [
                    { text: hit.label, bold: true },
                    { text: hit.value, dimmed: true }
                ];
                drawHoverTooltip(ctx, tooltipMx, tooltipMy, tooltipLines, theme, tokens.fonts, w, h);
            }

            // ── Reset state ──
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        },

        // ── Custom no-data message support ──

        _ensureCanvas: function() {
            if (!this.canvas) {
                this.el.innerHTML = '';
                this.canvas = document.createElement('canvas');
                this.canvas.style.width = '100%';
                this.canvas.style.height = '100%';
                this.canvas.style.display = 'block';
                this.el.appendChild(this.canvas);
            }
            var rect = this.el.getBoundingClientRect();
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
        },

        _drawStatusMessage: function(message) {
            var rect = this.el.getBoundingClientRect();
            var dpr = window.devicePixelRatio || 1;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            if (rect.width <= 0 || rect.height <= 0) return;
            ctx.scale(dpr, dpr);
            var w = rect.width;
            var h = rect.height;
            ctx.clearRect(0, 0, w, h);

            var maxTextW = w * 0.85;
            var fontSize = Math.max(10, Math.min(32, Math.min(w, h) * 0.09));
            var emojiSize = Math.round(fontSize * 1.6);
            var gap = fontSize * 0.5;

            ctx.font = '500 ' + fontSize + 'px ' + tokens.fonts.primary;
            while (ctx.measureText(message).width > maxTextW && fontSize > 8) {
                fontSize -= 1;
                emojiSize = Math.round(fontSize * 1.6);
                ctx.font = '500 ' + fontSize + 'px ' + tokens.fonts.primary;
            }

            ctx.font = emojiSize + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.fillText('⏳', w / 2, h / 2 - fontSize * 0.5 - gap);

            ctx.font = '500 ' + fontSize + 'px ' + tokens.fonts.primary;
            ctx.fillStyle = 'rgba(255,255,255,0.30)';
            ctx.fillText(message, w / 2, h / 2 + emojiSize * 0.3);

            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
