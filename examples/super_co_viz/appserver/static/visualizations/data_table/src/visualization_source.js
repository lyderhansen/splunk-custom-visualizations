/*
 * Data Table — Splunk Custom Visualization
 *
 * Structured rows with embedded severity badges, status chips, and conditional
 * coloring. Auto-detects column types from field names and data patterns.
 *
 * Expected SPL: | table _time source severity count status
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var tokens = require('shared/tokens');
    var draw = require('shared/draw');


    // ── Helper functions (pure, no `this`) ──────────────────────

    /**
     * Map severity text to a semantic color key.
     */
    function severityColor(theme, value) {
        var v = (value || '').toLowerCase().trim();
        if (v === 'critical' || v === 'crit') return theme.danger;
        if (v === 'high') return theme.orange;
        if (v === 'medium' || v === 'med') return theme.warn;
        if (v === 'low') return theme.success;
        if (v === 'info') return theme.s4;
        return theme.textDim;
    }

    /**
     * Map status text to a semantic color key.
     */
    function chipColor(theme, value) {
        var v = (value || '').toLowerCase().trim();
        if (v === 'ok' || v === 'healthy' || v === 'up') return theme.success;
        if (v === 'warn' || v === 'degraded' || v === 'warning') return theme.warn;
        if (v === 'critical' || v === 'down' || v === 'error') return theme.danger;
        return theme.s4;
    }

    /**
     * Auto-detect column type from field name and sample values.
     */
    function detectColumnType(fieldName, rows, colIndex) {
        var name = (fieldName || '').toLowerCase();

        // Name-based detection
        if (name === '_time' || name.indexOf('time') !== -1) return 'time';
        if (name === 'severity' || name === 'priority') return 'badge';
        if (name === 'status') return 'chip';

        // Value-based detection — sample up to 10 rows
        var sampleCount = Math.min(rows.length, 10);
        var numericCount = 0;
        var monoCount = 0;

        for (var i = 0; i < sampleCount; i++) {
            var val = rows[i][colIndex];
            if (val === null || val === undefined || val === '') continue;

            // Check if numeric
            var num = parseFloat(val);
            if (!isNaN(num) && String(val).trim() === String(num)) {
                numericCount++;
            }

            // Check if looks like IP, sourcetype, hostname
            var s = String(val);
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s) ||
                s.indexOf(':') !== -1 ||
                (s.indexOf('.') !== -1 && s.indexOf(' ') === -1) ||
                (s.indexOf('_') !== -1 && s.indexOf(' ') === -1)) {
                monoCount++;
            }
        }

        if (numericCount > 0 && numericCount >= sampleCount * 0.7) return 'number';
        if (monoCount > 0 && monoCount >= sampleCount * 0.5) return 'mono';
        return 'text';
    }

    /**
     * Parse a JSON column types config string. Returns object or empty.
     */
    function parseColumnTypes(configStr) {
        if (!configStr || configStr === '') return {};
        try {
            return JSON.parse(configStr);
        } catch (e) {
            return {};
        }
    }

    /**
     * Draw a severity badge pill.
     */
    function drawBadge(ctx, text, x, y, maxW, fontSize, theme) {
        var color = severityColor(theme, text);
        var displayText = (text || '').toUpperCase();

        ctx.font = '600 ' + fontSize + 'px ' + tokens.fonts.primary;
        var textW = ctx.measureText(displayText).width;
        var pillW = Math.min(textW + fontSize * 1.2, maxW);
        var pillH = fontSize + 6;
        var pillX = x;
        var pillY = y - pillH / 2;

        // Draw pill background
        ctx.fillStyle = color;
        draw.roundRect(ctx, pillX, pillY, pillW, pillH, 3);
        ctx.fill();

        // Draw pill text
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var clippedText = draw.ellipsis(ctx, displayText, pillW - 8);
        ctx.fillText(clippedText, pillX + pillW / 2, y);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    /**
     * Draw a status chip with tinted background, colored text, and leading dot.
     */
    function drawChip(ctx, text, x, y, maxW, fontSize, theme) {
        var color = chipColor(theme, text);
        var displayText = (text || '');

        ctx.font = fontSize + 'px ' + tokens.fonts.primary;
        var textW = ctx.measureText(displayText).width;
        var dotR = 3;
        var dotPad = dotR * 2 + 6;
        var chipW = Math.min(textW + dotPad + fontSize * 0.8, maxW);
        var chipH = fontSize + 8;
        var chipX = x;
        var chipY = y - chipH / 2;

        // Draw tinted background
        ctx.fillStyle = tokens.rgba(color, 0.12);
        draw.roundRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
        ctx.fill();

        // Draw leading dot
        ctx.beginPath();
        ctx.arc(chipX + dotPad / 2 + 4, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Draw text
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        var clippedText = draw.ellipsis(ctx, displayText, chipW - dotPad - 8);
        ctx.fillText(clippedText, chipX + dotPad + 4, y);
        ctx.textBaseline = 'alphabetic';
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-data-table-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;

            this._hoverRow = -1;
            var self = this;
            this.canvas.addEventListener('mousemove', function(e) {
                var rect = self.canvas.getBoundingClientRect();
                var my = e.clientY - rect.top;
                var newRow = -1;
                for (var i = 0; i < self._rowRects.length; i++) {
                    var r = self._rowRects[i];
                    if (my >= r.y && my <= r.y + r.h) { newRow = i; break; }
                }
                if (newRow !== self._hoverRow) {
                    self._hoverRow = newRow;
                    self.invalidateUpdateView();
                }
                self.canvas.style.cursor = newRow >= 0 ? 'pointer' : 'default';
            });
            this.canvas.addEventListener('mouseleave', function() {
                if (self._hoverRow !== -1) { self._hoverRow = -1; self.invalidateUpdateView(); }
                self.canvas.style.cursor = 'default';
            });
            this._rowRects = [];
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
                    'Awaiting data — Data Table'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            // Check for status message from appendpipe fallback
            if (colIdx._status !== undefined) {
                var statusRow = data.rows[data.rows.length - 1];
                var statusVal = statusRow[colIdx._status];
                if (statusVal) {
                    return { _status: statusVal };
                }
            }

            var result = {
                fields: data.fields,
                rows: data.rows,
                colIdx: colIdx
            };

            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            // Custom no-data message
            if (data && data._status) {
                this._ensureCanvas();
                this._drawStatusMessage(data._status);
                return;
            }

            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            // ── Read user settings ──
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = (config[ns + 'theme'] || 'dark');
            var maxRows = parseInt(config[ns + 'maxRows'] || '20', 10);
            var columnTypesStr = (config[ns + 'columnTypes'] || '');
            var thresholdField = (config[ns + 'thresholdField'] || '');
            var thresholdWarn = parseFloat(config[ns + 'thresholdWarn'] || '50');
            var thresholdDanger = parseFloat(config[ns + 'thresholdDanger'] || '80');

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

            // ── Clear canvas ──
            ctx.clearRect(0, 0, w, h);
            this._rowRects = [];

            // ── Theme ──
            var theme = tokens.getTheme(themeName);

            // ── Data ──
            var fields = data.fields;
            var rows = data.rows;
            var colCount = fields.length;
            if (colCount === 0 || rows.length === 0) return;

            // Parse column types config
            var configuredTypes = parseColumnTypes(columnTypesStr);

            // Determine type for each column
            var colTypes = [];
            for (var c = 0; c < colCount; c++) {
                var fieldName = fields[c].name;
                if (configuredTypes[fieldName]) {
                    colTypes.push(configuredTypes[fieldName]);
                } else {
                    colTypes.push(detectColumnType(fieldName, rows, c));
                }
            }

            // ── Layout constants ──
            var padLeft = 12;
            var padRight = 12;
            var headerFontSize = 11;
            var headerPadBottom = 8;
            var bodyFontSize = 12.5;
            var rowPadV = 9;
            var headerH = headerFontSize + headerPadBottom + 1;
            var rowH = bodyFontSize + rowPadV * 2 + 1;
            var tableW = w - padLeft - padRight;

            // ── Column widths ──
            // Distribute evenly, with number/time columns slightly narrower
            var totalWeight = 0;
            var colWeights = [];
            for (var c = 0; c < colCount; c++) {
                var weight;
                var type = colTypes[c];
                if (type === 'number' || type === 'time') {
                    weight = 0.7;
                } else if (type === 'badge' || type === 'chip') {
                    weight = 0.8;
                } else {
                    weight = 1.0;
                }
                colWeights.push(weight);
                totalWeight += weight;
            }

            var colWidths = [];
            var colX = [];
            var cx = padLeft;
            for (var c = 0; c < colCount; c++) {
                var cw = (colWeights[c] / totalWeight) * tableW;
                colWidths.push(cw);
                colX.push(cx);
                cx += cw;
            }

            // ── Limit rows ──
            var visibleRows = Math.min(rows.length, maxRows);
            var maxVisibleByHeight = Math.floor((h - headerH) / rowH);
            if (maxVisibleByHeight < visibleRows) {
                visibleRows = Math.max(1, maxVisibleByHeight);
            }

            // ── Draw header row ──
            var headerY = headerFontSize + 2;
            ctx.font = '600 ' + headerFontSize + 'px ' + tokens.fonts.primary;
            ctx.textBaseline = 'alphabetic';

            for (var c = 0; c < colCount; c++) {
                var label = (fields[c].name || '').toUpperCase();
                var type = colTypes[c];
                var cellPad = 8;

                if (type === 'number' || type === 'time') {
                    ctx.textAlign = 'right';
                    ctx.fillStyle = theme.textFaint;
                    var truncLabel = draw.ellipsis(ctx, label, colWidths[c] - cellPad * 2);
                    ctx.fillText(truncLabel, colX[c] + colWidths[c] - cellPad, headerY);
                } else {
                    ctx.textAlign = 'left';
                    ctx.fillStyle = theme.textFaint;
                    var truncLabel = draw.ellipsis(ctx, label, colWidths[c] - cellPad * 2);
                    ctx.fillText(truncLabel, colX[c] + cellPad, headerY);
                }
            }

            // Header bottom border
            var headerBorderY = headerFontSize + headerPadBottom;
            ctx.beginPath();
            ctx.moveTo(padLeft, headerBorderY);
            ctx.lineTo(w - padRight, headerBorderY);
            ctx.strokeStyle = theme.edge;
            ctx.lineWidth = 1;
            ctx.stroke();

            // ── Draw body rows ──
            for (var r = 0; r < visibleRows; r++) {
                var row = rows[r];
                var rowTop = headerH + r * rowH;
                var cellCenterY = rowTop + rowPadV + bodyFontSize / 2;

                this._rowRects.push({y: rowTop, h: rowH});

                // Hover highlight
                if (this._hoverRow === r) {
                    ctx.fillStyle = theme.edge;
                    ctx.fillRect(padLeft, rowTop, w - padLeft - padRight, rowH);
                }

                for (var c = 0; c < colCount; c++) {
                    var type = colTypes[c];
                    var value = row[c] !== null && row[c] !== undefined ? String(row[c]) : '';
                    var cellPad = 8;
                    var maxCellW = colWidths[c] - cellPad * 2;

                    // Apply conditional coloring for threshold field
                    var thresholdApplied = false;
                    if (thresholdField && fields[c].name === thresholdField) {
                        var numVal = parseFloat(value);
                        if (!isNaN(numVal)) {
                            if (numVal >= thresholdDanger) {
                                thresholdApplied = true;
                                ctx.fillStyle = theme.danger;
                                ctx.font = 'bold ' + bodyFontSize + 'px ' + tokens.fonts.mono;
                            } else if (numVal >= thresholdWarn) {
                                thresholdApplied = true;
                                ctx.fillStyle = theme.warn;
                                ctx.font = 'bold ' + bodyFontSize + 'px ' + tokens.fonts.mono;
                            }
                        }
                    }

                    if (type === 'badge') {
                        drawBadge(ctx, value, colX[c] + cellPad, cellCenterY, maxCellW, headerFontSize, theme);
                    } else if (type === 'chip') {
                        drawChip(ctx, value, colX[c] + cellPad, cellCenterY, maxCellW, bodyFontSize - 1, theme);
                    } else if (type === 'number') {
                        if (!thresholdApplied) {
                            ctx.fillStyle = theme.text;
                            ctx.font = bodyFontSize + 'px ' + tokens.fonts.mono;
                        }
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';
                        var numDisplay = value;
                        var parsed = parseFloat(value);
                        if (!isNaN(parsed)) {
                            numDisplay = draw.formatNumber(parsed);
                        }
                        var truncNum = draw.ellipsis(ctx, numDisplay, maxCellW);
                        ctx.fillText(truncNum, colX[c] + colWidths[c] - cellPad, cellCenterY);
                    } else if (type === 'time') {
                        ctx.fillStyle = theme.textFaint;
                        ctx.font = bodyFontSize + 'px ' + tokens.fonts.primary;
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';
                        var truncTime = draw.ellipsis(ctx, value, maxCellW);
                        ctx.fillText(truncTime, colX[c] + colWidths[c] - cellPad, cellCenterY);
                    } else if (type === 'mono') {
                        if (!thresholdApplied) {
                            ctx.fillStyle = theme.textDim;
                            ctx.font = '11.5px ' + tokens.fonts.mono;
                        }
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        var truncMono = draw.ellipsis(ctx, value, maxCellW);
                        ctx.fillText(truncMono, colX[c] + cellPad, cellCenterY);
                    } else {
                        // text type
                        if (!thresholdApplied) {
                            ctx.fillStyle = theme.text;
                            ctx.font = bodyFontSize + 'px ' + tokens.fonts.primary;
                        }
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        var truncText = draw.ellipsis(ctx, value, maxCellW);
                        ctx.fillText(truncText, colX[c] + cellPad, cellCenterY);
                    }
                }

                // Row bottom border
                var rowBorderY = rowTop + rowH - 1;
                ctx.beginPath();
                ctx.moveTo(padLeft, rowBorderY);
                ctx.lineTo(w - padRight, rowBorderY);
                ctx.strokeStyle = theme.edge;
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // Reset state
            ctx.textAlign = 'left';
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

            ctx.font = '500 ' + fontSize + 'px sans-serif';
            while (ctx.measureText(message).width > maxTextW && fontSize > 8) {
                fontSize -= 1;
                emojiSize = Math.round(fontSize * 1.6);
                ctx.font = '500 ' + fontSize + 'px sans-serif';
            }

            ctx.font = emojiSize + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.fillText('⏳', w / 2, h / 2 - fontSize * 0.5 - gap);

            ctx.font = '500 ' + fontSize + 'px sans-serif';
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
