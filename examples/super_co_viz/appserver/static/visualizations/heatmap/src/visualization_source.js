/*
 * Heatmap Grid — Splunk Custom Visualization
 *
 * Reveals density/frequency over two dimensions. Supports MITRE ATT&CK
 * heatmaps (categorical Y, day/category X with cell counts) and
 * error-rate calendars (day-of-week Y, hour X, color-only).
 *
 * Expected SPL: | stats count by row_label col_label
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {


    // ── Color helpers ────────────────────────────────────────────

    function cellColor(value, max, theme, colorMode) {
        if (value === 0 || value === null || value === undefined) {
            return theme.edge;
        }
        if (max <= 0) return theme.edge;

        var ratio = value / max;

        if (colorMode === 'severity') {
            if (ratio <= 0.25) return tokens.rgba('#ff6600', 0.25);
            if (ratio <= 0.50) return tokens.rgba('#ff6600', 0.50);
            if (ratio <= 0.75) return tokens.rgba('#ff6600', 0.80);
            return theme.danger;
        }

        // default mode: sequential blue-cyan scale
        if (ratio <= 0.25) return tokens.rgba(theme.s4.charAt(0) === '#' ? theme.s4 : '#7eb1ff', 0.25);
        if (ratio <= 0.50) return tokens.rgba(theme.s3.charAt(0) === '#' ? theme.s3 : '#5ce1e6', 0.50);
        if (ratio <= 0.75) return tokens.rgba(theme.s2.charAt(0) === '#' ? theme.s2 : '#2bbfb8', 0.60);
        return theme.danger;
    }

    function cellTextColor(value, max, theme) {
        if (value === 0 || value === null || value === undefined) return theme.textFaint;
        if (max <= 0) return theme.textFaint;
        var ratio = value / max;
        // Dark text on light cells, white on dark cells
        if (ratio > 0.50) return '#ffffff';
        return theme.textDim;
    }

    // ── Legend swatch colors for the five steps ─────────────────

    function legendSwatches(theme, colorMode) {
        if (colorMode === 'severity') {
            return [
                theme.edge,
                tokens.rgba('#ff6600', 0.25),
                tokens.rgba('#ff6600', 0.50),
                tokens.rgba('#ff6600', 0.80),
                theme.danger
            ];
        }
        return [
            theme.edge,
            tokens.rgba(theme.s4.charAt(0) === '#' ? theme.s4 : '#7eb1ff', 0.25),
            tokens.rgba(theme.s3.charAt(0) === '#' ? theme.s3 : '#5ce1e6', 0.50),
            tokens.rgba(theme.s2.charAt(0) === '#' ? theme.s2 : '#2bbfb8', 0.60),
            theme.danger
        ];
    }

    // ── Tooltip helper ──────────────────────────────────────────

    function drawTooltipCard(ctx, x, y, lines, theme, fonts, canvasW, canvasH) {
        var padX = 10, padY = 8, lineH = 18, dotR = 3;
        var maxW = 0;
        ctx.font = '600 13px ' + fonts.mono;
        for (var i = 0; i < lines.length; i++) {
            var tw = ctx.measureText(lines[i].text).width;
            if (lines[i].prefix) {
                ctx.font = '11px ' + fonts.primary;
                tw += ctx.measureText(lines[i].prefix).width + 8;
            }
            if (tw > maxW) maxW = tw;
            ctx.font = '600 13px ' + fonts.mono;
        }
        var cardW = padX * 2 + maxW + (lines[0] && lines[0].color ? dotR * 2 + 8 : 0);
        var cardH = padY * 2 + lines.length * lineH;
        if (x + cardW + 8 > canvasW) x = x - cardW - 8;
        if (y + cardH > canvasH) y = canvasH - cardH - 4;
        if (x < 4) x = 4;
        if (y < 4) y = 4;

        draw.roundRect(ctx, x, y, cardW, cardH, 6);
        ctx.fillStyle = theme.panel;
        ctx.fill();
        ctx.strokeStyle = theme.edgeStrong;
        ctx.lineWidth = 1;
        ctx.stroke();

        for (var i = 0; i < lines.length; i++) {
            var ry = y + padY + i * lineH + lineH / 2;
            var lx = x + padX;
            if (lines[i].color) {
                ctx.beginPath();
                ctx.arc(lx + dotR, ry, dotR, 0, Math.PI * 2);
                ctx.fillStyle = lines[i].color;
                ctx.fill();
                lx += dotR * 2 + 8;
            }
            if (lines[i].prefix) {
                ctx.font = '11px ' + fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(lines[i].prefix, lx, ry);
                lx += ctx.measureText(lines[i].prefix).width + 8;
            }
            ctx.font = lines[i].bold ? '600 13px ' + fonts.mono : '11px ' + fonts.primary;
            ctx.fillStyle = lines[i].dimmed ? theme.textFaint : theme.text;
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
            this.el.classList.add('super-co-heatmap-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
            this._hoverIndex = -1;
            this._hitCells = [];
            this._lastMouseX = 0;
            this._lastMouseY = 0;
            var self = this;
            this.canvas.addEventListener('mousemove', function(e) {
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                self._lastMouseX = mx;
                self._lastMouseY = my;
                var newIdx = self._findHover(mx, my);
                if (newIdx !== self._hoverIndex) {
                    self._hoverIndex = newIdx;
                    self.invalidateUpdateView();
                }
            });
            this.canvas.addEventListener('mouseleave', function() {
                if (self._hoverIndex !== -1) {
                    self._hoverIndex = -1;
                    self.invalidateUpdateView();
                }
            });
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
                    'Awaiting data — Heatmap'
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
            var showCellValues = (config[ns + 'showCellValues'] || 'true') === 'true';
            var colorMode      = (config[ns + 'colorMode'] || 'default');
            var rowField       = (config[ns + 'rowField'] || 'row_label');
            var colField       = (config[ns + 'colField'] || 'col_label');
            var valueField     = (config[ns + 'valueField'] || 'count');

            var theme = tokens.getTheme(themeName);

            // ── Pivot rows into 2D grid ──
            var rows = data.rows;
            var colIdx = data.colIdx;

            var rowLabels = [];
            var colLabels = [];
            var rowMap = {};
            var colMap = {};
            var cellData = {};
            var globalMax = 0;
            var i, r, c;

            for (i = 0; i < rows.length; i++) {
                var row = rows[i];
                var rLabel = '';
                var cLabel = '';
                var val = 0;

                if (colIdx[rowField] !== undefined) {
                    rLabel = String(row[colIdx[rowField]] || '');
                }
                if (colIdx[colField] !== undefined) {
                    cLabel = String(row[colIdx[colField]] || '');
                }
                if (colIdx[valueField] !== undefined) {
                    var v = parseFloat(row[colIdx[valueField]]);
                    if (!isNaN(v)) val = v;
                }

                if (rowMap[rLabel] === undefined) {
                    rowMap[rLabel] = rowLabels.length;
                    rowLabels.push(rLabel);
                }
                if (colMap[cLabel] === undefined) {
                    colMap[cLabel] = colLabels.length;
                    colLabels.push(cLabel);
                }

                var cellKey = rowMap[rLabel] + ',' + colMap[cLabel];
                cellData[cellKey] = (cellData[cellKey] || 0) + val;
                if (cellData[cellKey] > globalMax) {
                    globalMax = cellData[cellKey];
                }
            }

            var numRows = rowLabels.length;
            var numCols = colLabels.length;

            if (numRows === 0 || numCols === 0) return;

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

            // ── Layout ──
            var padX = 8;
            var padY = 8;
            var yAxisW = Math.min(130, w * 0.25);
            var xAxisH = 18;  // space for x-axis labels at bottom
            var legendH = 22; // legend strip below grid
            var cellGap = 2;
            var cellH = 22;
            var cellR = 2;

            var gridX = padX + yAxisW;
            var gridY = padY;
            var gridW = w - gridX - padX;
            var gridH = h - padY - xAxisH - legendH - padY;

            // Calculate cell width based on available space
            var totalGapW = cellGap * (numCols - 1);
            var cellW = (gridW - totalGapW) / numCols;
            if (cellW < 4) cellW = 4;

            // Calculate total height needed and adjust cellH if too many rows
            var totalGapH = cellGap * (numRows - 1);
            var totalNeededH = numRows * cellH + totalGapH;
            if (totalNeededH > gridH && gridH > 0) {
                cellH = Math.max(6, (gridH - totalGapH) / numRows);
            }

            // ── Draw Y-axis labels ──
            var yLabelFontSize = Math.min(12, cellH - 2);
            yLabelFontSize = Math.max(8, yLabelFontSize);
            ctx.font = '500 ' + yLabelFontSize + 'px ' + tokens.fonts.primary;
            ctx.fillStyle = theme.textDim;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';

            for (r = 0; r < numRows; r++) {
                var labelY = gridY + r * (cellH + cellGap) + cellH / 2;
                var maxLabelW = yAxisW - 8;
                var truncLabel = draw.ellipsis(ctx, rowLabels[r], maxLabelW);
                ctx.fillText(truncLabel, padX + yAxisW - 6, labelY);
            }

            // ── Draw cells and build hit-test array ──
            var hitCells = [];
            for (r = 0; r < numRows; r++) {
                for (c = 0; c < numCols; c++) {
                    var cx = gridX + c * (cellW + cellGap);
                    var cy = gridY + r * (cellH + cellGap);
                    var key = r + ',' + c;
                    var cellVal = cellData[key] || 0;

                    hitCells.push({
                        x: cx, y: cy, w: cellW, h: cellH,
                        rowLabel: rowLabels[r], colLabel: colLabels[c], value: cellVal
                    });

                    // Cell background
                    var bgColor = cellColor(cellVal, globalMax, theme, colorMode);
                    draw.roundRect(ctx, cx, cy, cellW, cellH, cellR);
                    ctx.fillStyle = bgColor;
                    ctx.fill();

                    // Cell value text
                    if (showCellValues && cellVal > 0 && cellW >= 16 && cellH >= 12) {
                        var valFontSize = Math.min(10, cellH - 4, cellW * 0.6);
                        valFontSize = Math.max(7, valFontSize);
                        ctx.font = '600 ' + valFontSize + 'px ' + tokens.fonts.mono;
                        ctx.fillStyle = cellTextColor(cellVal, globalMax, theme);
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        var displayVal = draw.formatNumber(cellVal);
                        ctx.fillText(displayVal, cx + cellW / 2, cy + cellH / 2);
                    }
                }
            }
            this._hitCells = hitCells;

            // ── Draw hover border and tooltip ──
            var hoverIdx = this._hoverIndex;
            if (hoverIdx >= 0 && hoverIdx < hitCells.length) {
                var hc = hitCells[hoverIdx];
                // 2px border around hovered cell
                ctx.strokeStyle = theme.edgeStrong;
                ctx.lineWidth = 2;
                draw.roundRect(ctx, hc.x - 1, hc.y - 1, hc.w + 2, hc.h + 2, cellR + 1);
                ctx.stroke();

                // Tooltip positioned above cell if space, below if not
                var tipX = hc.x + hc.w / 2;
                var tipY = hc.y - 8;
                var tooltipLines = [
                    { prefix: 'Row:', text: hc.rowLabel },
                    { prefix: 'Col:', text: hc.colLabel },
                    { text: draw.formatNumber(hc.value), bold: true }
                ];
                // Estimate card height to decide above/below
                var estCardH = 8 * 2 + tooltipLines.length * 18;
                if (tipY - estCardH < 4) {
                    tipY = hc.y + hc.h + 8;
                } else {
                    tipY = tipY - estCardH;
                }
                drawTooltipCard(ctx, tipX, tipY, tooltipLines, theme, tokens.fonts, w, h);

                this.canvas.style.cursor = hc.value > 0 ? 'pointer' : 'crosshair';
            } else {
                this.canvas.style.cursor = 'default';
            }

            // ── Draw X-axis labels ──
            var xLabelY = gridY + numRows * (cellH + cellGap) + 4;
            var xLabelFontSize = Math.min(9.5, cellW * 0.7);
            xLabelFontSize = Math.max(7, xLabelFontSize);
            ctx.font = '500 ' + xLabelFontSize + 'px ' + tokens.fonts.mono;
            ctx.fillStyle = theme.textFaint;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // Skip labels if they overlap — show every Nth
            var sampleLabelW = 0;
            if (colLabels.length > 0) {
                sampleLabelW = ctx.measureText(colLabels[0]).width + 4;
            }
            var labelStep = 1;
            if (sampleLabelW > 0 && (cellW + cellGap) > 0) {
                labelStep = Math.max(1, Math.ceil(sampleLabelW / (cellW + cellGap)));
            }

            for (c = 0; c < numCols; c += labelStep) {
                var lx = gridX + c * (cellW + cellGap) + cellW / 2;
                var colLabelTrunc = draw.ellipsis(ctx, colLabels[c], cellW * labelStep);
                ctx.fillText(colLabelTrunc, lx, xLabelY);
            }

            // ── Draw legend strip ──
            var swatches = legendSwatches(theme, colorMode);
            var swatchSize = 12;
            var swatchGap = 3;
            var legendFontSize = 11;
            var legendY = h - padY - legendH + 4;

            ctx.font = '500 ' + legendFontSize + 'px ' + tokens.fonts.primary;
            ctx.textBaseline = 'middle';

            // "Less" label
            var lessText = 'Less';
            var moreText = 'More';
            var lessW = ctx.measureText(lessText).width;
            var moreW = ctx.measureText(moreText).width;
            var totalLegendW = lessW + 6 + (swatchSize + swatchGap) * swatches.length + 6 + moreW;

            // Right-align the legend
            var legendStartX = w - padX - totalLegendW;
            var curX = legendStartX;

            ctx.fillStyle = theme.textFaint;
            ctx.textAlign = 'left';
            ctx.fillText(lessText, curX, legendY + swatchSize / 2);
            curX += lessW + 6;

            for (i = 0; i < swatches.length; i++) {
                draw.roundRect(ctx, curX, legendY, swatchSize, swatchSize, 2);
                ctx.fillStyle = swatches[i];
                ctx.fill();
                curX += swatchSize + swatchGap;
            }

            curX += 3;
            ctx.fillStyle = theme.textFaint;
            ctx.fillText(moreText, curX, legendY + swatchSize / 2);

            // ── Reset state ──
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        },

        // ── Hover hit-test ──

        _findHover: function(mx, my) {
            if (!this._hitCells || this._hitCells.length === 0) return -1;
            for (var i = 0; i < this._hitCells.length; i++) {
                var c = this._hitCells[i];
                if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) {
                    return i;
                }
            }
            return -1;
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
