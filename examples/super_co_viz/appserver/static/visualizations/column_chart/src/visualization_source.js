/*
 * Column Chart — Splunk Custom Visualization
 *
 * Categorical comparison with vertical bars. Optional highlight bar and
 * grouped multi-series support.
 *
 * Expected SPL: | stats count by category
 *   or: | timechart count
 * First column is X labels, remaining columns are bar values.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var tokens = require('shared/tokens');
    var draw = require('shared/draw');


    // ── Helper functions (pure, no `this`) ──────────────────────

    var SERIES_COLORS_KEYS = ['s2', 's4', 'orange', 's1', 's3', 's5'];

    function getSeriesColor(theme, seriesIdx) {
        var key = SERIES_COLORS_KEYS[seriesIdx % SERIES_COLORS_KEYS.length];
        return theme[key];
    }

    function computeNiceMax(rawMax) {
        if (rawMax <= 0) return 100;
        var mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
        var residual = rawMax / mag;
        var nice;
        if (residual <= 1) nice = 1;
        else if (residual <= 1.5) nice = 1.5;
        else if (residual <= 2) nice = 2;
        else if (residual <= 3) nice = 3;
        else if (residual <= 5) nice = 5;
        else if (residual <= 7.5) nice = 7.5;
        else nice = 10;
        return nice * mag;
    }

    function drawColumnTooltip(ctx, x, y, label, value, theme, tokens, w, h) {
        var padX = 10, padY = 6;
        ctx.font = '11px ' + tokens.fonts.primary;
        var labelW = ctx.measureText(label).width;
        ctx.font = '600 13px ' + tokens.fonts.mono;
        var valW = ctx.measureText(value).width;
        var cardW = padX * 2 + Math.max(labelW, valW);
        var cardH = padY * 2 + 34;
        // Center horizontally, clamp
        x = x - cardW / 2;
        if (x + cardW > w) x = w - cardW - 4;
        if (x < 0) x = 4;
        if (y - cardH - 6 < 0) y = y + 6;
        else y = y - cardH - 6;
        if (y < 0) y = 4;
        // Draw card
        draw.roundRect(ctx, x, y, cardW, cardH, 6);
        ctx.fillStyle = theme.panel;
        ctx.fill();
        ctx.strokeStyle = theme.edge;
        ctx.lineWidth = 1;
        ctx.stroke();
        // Label
        ctx.font = '11px ' + tokens.fonts.primary;
        ctx.fillStyle = theme.textDim;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + cardW / 2, y + padY + 8);
        // Value
        ctx.font = '600 13px ' + tokens.fonts.mono;
        ctx.fillStyle = theme.text;
        ctx.fillText(value, x + cardW / 2, y + padY + 26);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-column-chart-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;

            this._hoverIndex = -1;
            this._hitAreas = [];
            var self = this;
            this.canvas.addEventListener('mousemove', function(e) {
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
                    'Awaiting data — Column Chart'
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
            var gridLines = parseInt(config[ns + 'gridLines'] || '4', 10);
            var highlightIndex = parseInt(config[ns + 'highlightIndex'] || '-1', 10);
            var barColor = (config[ns + 'barColor'] || '#2bbfb8');

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

            // ── Theme ──
            var theme = tokens.getTheme(themeName);

            // ── Chart area with padding ──
            var padTop = 10;
            var padRight = 16;
            var padBottom = 26;
            var padLeft = 44;
            var chartX = padLeft;
            var chartY = padTop;
            var chartW = w - padLeft - padRight;
            var chartH = h - padTop - padBottom;
            if (chartW <= 0 || chartH <= 0) return;

            // ── Parse data ──
            var fields = data.fields;
            var rows = data.rows;
            var n = rows.length;
            if (n === 0) return;

            // First column = X labels, remaining = value series
            var xLabels = [];
            for (var r = 0; r < n; r++) {
                xLabels.push(rows[r][0] || '');
            }

            var seriesCount = fields.length - 1;
            if (seriesCount <= 0) return;

            var seriesData = [];
            var globalMax = 0;
            for (var s = 0; s < seriesCount; s++) {
                var vals = [];
                for (var r = 0; r < n; r++) {
                    var v = parseFloat(rows[r][s + 1]);
                    if (isNaN(v)) v = 0;
                    vals.push(v);
                    if (v > globalMax) globalMax = v;
                }
                seriesData.push(vals);
            }

            // ── Y-axis scale ──
            var yMax = computeNiceMax(globalMax * 1.1);
            if (yMax <= 0) yMax = 100;

            // ── Draw horizontal gridlines ──
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 1;
            ctx.font = '11px ' + tokens.fonts.primary;
            ctx.fillStyle = theme.textFaint;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'right';

            for (var g = 0; g <= gridLines; g++) {
                var ratio = g / gridLines;
                var yVal = yMax * ratio;
                var yPx = chartY + chartH - ratio * chartH;

                ctx.beginPath();
                ctx.moveTo(chartX, yPx);
                ctx.lineTo(chartX + chartW, yPx);
                ctx.stroke();

                var label = draw.formatNumber(yVal);
                ctx.fillText(label, chartX - 8, yPx);
            }

            // ── Compute bar geometry ──
            var slotW = chartW / n;
            var groupW = slotW * 0.6;
            var barW;
            if (seriesCount > 1) {
                barW = Math.min(20, groupW / seriesCount);
            } else {
                barW = Math.min(20, groupW);
            }
            var totalGroupW = barW * seriesCount;
            var groupOffset = (slotW - totalGroupW) / 2;

            // ── Draw bars ──
            this._hitAreas = [];
            for (var r = 0; r < n; r++) {
                var slotX = chartX + r * slotW;

                for (var s = 0; s < seriesCount; s++) {
                    var val = seriesData[s][r];
                    var barH = (val / yMax) * chartH;
                    if (barH < 0) barH = 0;

                    var bx = slotX + groupOffset + s * barW;
                    var by = chartY + chartH - barH;

                    // Determine bar color
                    var fillColor;
                    if (r === highlightIndex) {
                        fillColor = theme.orange;
                    } else if (seriesCount > 1) {
                        fillColor = getSeriesColor(theme, s);
                    } else {
                        fillColor = barColor;
                    }

                    // Store hit area for this bar
                    if (barH > 0) {
                        this._hitAreas.push({
                            x: bx,
                            y: by,
                            w: barW,
                            h: barH,
                            row: r,
                            series: s,
                            value: val,
                            color: fillColor,
                            label: xLabels[r]
                        });
                    }

                    // Draw bar with rounded top corners
                    if (barH > 0) {
                        var cornerR = Math.min(2, barH / 2, barW / 2);
                        draw.roundRectTop(ctx, bx, by, barW, barH, cornerR);
                        ctx.fillStyle = fillColor;
                        ctx.fill();
                    }
                }
            }

            // ── Draw X-axis labels ──
            ctx.font = '11px ' + tokens.fonts.primary;
            ctx.textBaseline = 'top';
            ctx.textAlign = 'center';

            for (var r = 0; r < n; r++) {
                var slotX = chartX + r * slotW;
                var labelX = slotX + slotW / 2;
                var lbl = xLabels[r];

                // Highlighted bar gets bold + text color
                if (r === highlightIndex) {
                    ctx.font = 'bold 11px ' + tokens.fonts.primary;
                    ctx.fillStyle = theme.text;
                } else {
                    ctx.font = '11px ' + tokens.fonts.primary;
                    ctx.fillStyle = theme.textFaint;
                }

                // Truncate label if too wide
                var maxLabelW = slotW - 4;
                var truncated = draw.ellipsis(ctx, lbl, maxLabelW);
                ctx.fillText(truncated, labelX, chartY + chartH + 8);
            }

            // ── Cursor style ──
            this.canvas.style.cursor = (this._hoverIndex >= 0) ? 'pointer' : 'default';

            // ── Hover highlight + tooltip ──
            if (this._hoverIndex >= 0 && this._hoverIndex < this._hitAreas.length) {
                var hit = this._hitAreas[this._hoverIndex];

                // Draw highlighted bar (brighter version)
                var cornerR2 = Math.min(2, hit.h / 2, hit.w / 2);
                draw.roundRectTop(ctx, hit.x, hit.y, hit.w, hit.h, cornerR2);
                ctx.fillStyle = tokens.rgba(hit.color, 0.45);
                ctx.fill();

                // Tooltip centered above bar
                var tipX = hit.x + hit.w / 2;
                var tipY = hit.y;
                drawColumnTooltip(ctx, tipX, tipY, hit.label, draw.formatNumber(hit.value), theme, tokens, w, h);
            }

            // Reset state
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
