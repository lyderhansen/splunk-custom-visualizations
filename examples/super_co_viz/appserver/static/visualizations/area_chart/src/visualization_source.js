/*
 * Area Chart — Splunk Custom Visualization
 *
 * Multi-series time-series area chart. Used for threat events over time,
 * latency percentiles, revenue trends, network throughput.
 *
 * Expected SPL: | timechart count by source
 * First column is _time (X axis), subsequent columns are series (Y values).
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

    function pad2(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function formatTimeLabel(raw, allTimes) {
        if (!raw) return '';
        var d = new Date(raw);
        if (isNaN(d.getTime())) return raw;

        // Determine time range to pick format
        if (allTimes && allTimes.length >= 2) {
            var first = new Date(allTimes[0]);
            var last = new Date(allTimes[allTimes.length - 1]);
            if (!isNaN(first.getTime()) && !isNaN(last.getTime())) {
                var rangeMs = Math.abs(last.getTime() - first.getTime());
                // Under 24 hours: show HH:MM
                if (rangeMs < 86400000) {
                    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
                }
            }
        }
        // Over 24 hours or unknown: show MM/DD
        return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
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

    function drawTooltip(ctx, x, y, lines, theme, tokens, w, h) {
        // lines = [{color: '#hex', label: 'name', value: '123'}, ...]
        var padX = 10, padY = 8, lineH = 18, dotR = 3;
        var maxLabelW = 0, maxValW = 0;
        ctx.font = '11px ' + tokens.fonts.primary;
        for (var i = 0; i < lines.length; i++) {
            var lw = ctx.measureText(lines[i].label).width;
            if (lw > maxLabelW) maxLabelW = lw;
            ctx.font = '600 11px ' + tokens.fonts.mono;
            var vw = ctx.measureText(lines[i].value).width;
            if (vw > maxValW) maxValW = vw;
            ctx.font = '11px ' + tokens.fonts.primary;
        }
        var cardW = padX * 2 + dotR * 2 + 6 + maxLabelW + 12 + maxValW;
        var cardH = padY * 2 + lines.length * lineH;
        // Clamp position
        if (x + cardW > w) x = x - cardW - 12;
        if (y + cardH > h) y = h - cardH - 4;
        if (x < 0) x = 4;
        if (y < 0) y = 4;
        // Draw card
        draw.roundRect(ctx, x, y, cardW, cardH, 6);
        ctx.fillStyle = theme.panel;
        ctx.fill();
        ctx.strokeStyle = theme.edge;
        ctx.lineWidth = 1;
        ctx.stroke();
        // Draw rows
        for (var i = 0; i < lines.length; i++) {
            var ry = y + padY + i * lineH + lineH / 2;
            // Color dot
            if (lines[i].color) {
                ctx.beginPath();
                ctx.arc(x + padX + dotR, ry, dotR, 0, Math.PI * 2);
                ctx.fillStyle = lines[i].color;
                ctx.fill();
            }
            // Label
            ctx.font = '11px ' + tokens.fonts.primary;
            ctx.fillStyle = theme.textDim;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(lines[i].label, x + padX + dotR * 2 + 6, ry);
            // Value
            ctx.font = '600 11px ' + tokens.fonts.mono;
            ctx.fillStyle = theme.text;
            ctx.textAlign = 'right';
            ctx.fillText(lines[i].value, x + cardW - padX, ry);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-area-chart-viz');

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
                    'Awaiting data — Area Chart'
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
            var showMarker = (config[ns + 'showMarker'] || 'false') === 'true';
            var markerIndex = parseInt(config[ns + 'markerIndex'] || '-1', 10);
            var markerLabel = (config[ns + 'markerLabel'] || '');

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
            var colIdx = data.colIdx;

            // First column is X (time), rest are Y series
            var xFieldIdx = 0;
            var seriesFields = [];
            for (var f = 1; f < fields.length; f++) {
                seriesFields.push({ name: fields[f].name, idx: f });
            }

            if (seriesFields.length === 0 || rows.length === 0) return;

            // Extract X values (raw time strings)
            var xRaw = [];
            for (var r = 0; r < rows.length; r++) {
                xRaw.push(rows[r][xFieldIdx] || '');
            }

            // Extract Y values per series
            var seriesData = [];
            var globalMax = 0;
            for (var s = 0; s < seriesFields.length; s++) {
                var vals = [];
                for (var r = 0; r < rows.length; r++) {
                    var v = parseFloat(rows[r][seriesFields[s].idx]);
                    if (isNaN(v)) v = 0;
                    vals.push(v);
                    if (v > globalMax) globalMax = v;
                }
                seriesData.push(vals);
            }

            // ── Y-axis scale ──
            var yMax = computeNiceMax(globalMax * 1.1);
            if (yMax <= 0) yMax = 100;

            // ── X positions ──
            var n = rows.length;
            var xPositions = [];
            for (var i = 0; i < n; i++) {
                xPositions.push(chartX + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2));
            }

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

            // ── Draw X-axis labels ──
            ctx.font = '11px ' + tokens.fonts.primary;
            ctx.fillStyle = theme.textFaint;
            ctx.textBaseline = 'top';
            ctx.textAlign = 'center';

            // Determine how many labels fit
            var labelSpacing = 60;
            var maxLabels = Math.max(2, Math.floor(chartW / labelSpacing));
            var labelStep = Math.max(1, Math.ceil(n / maxLabels));

            for (var i = 0; i < n; i += labelStep) {
                var lbl = formatTimeLabel(xRaw[i], xRaw);
                ctx.fillText(lbl, xPositions[i], chartY + chartH + 8);
            }

            // ── Draw series (back to front: area fill then line) ──
            for (var s = seriesFields.length - 1; s >= 0; s--) {
                var seriesColor = getSeriesColor(theme, s);
                var vals = seriesData[s];

                // Compute points
                var pts = [];
                for (var i = 0; i < n; i++) {
                    var yRatio = vals[i] / yMax;
                    pts.push({
                        x: xPositions[i],
                        y: chartY + chartH - yRatio * chartH
                    });
                }

                // ── Area fill: gradient from color@0.22 at top to color@0 at bottom ──
                var grad = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
                grad.addColorStop(0, tokens.rgba(seriesColor, 0.22));
                grad.addColorStop(1, tokens.rgba(seriesColor, 0));

                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (var i = 1; i < pts.length; i++) {
                    ctx.lineTo(pts[i].x, pts[i].y);
                }
                ctx.lineTo(pts[pts.length - 1].x, chartY + chartH);
                ctx.lineTo(pts[0].x, chartY + chartH);
                ctx.closePath();
                ctx.fillStyle = grad;
                ctx.fill();

                // ── Line stroke ──
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (var i = 1; i < pts.length; i++) {
                    ctx.lineTo(pts[i].x, pts[i].y);
                }
                ctx.strokeStyle = seriesColor;
                ctx.lineWidth = 1.75;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            }

            // ── Store hit areas (one per X column) ──
            this._hitAreas = [];
            for (var i = 0; i < n; i++) {
                var colLeft = (i === 0) ? chartX : (xPositions[i - 1] + xPositions[i]) / 2;
                var colRight = (i === n - 1) ? chartX + chartW : (xPositions[i] + xPositions[i + 1]) / 2;
                this._hitAreas.push({
                    x: colLeft,
                    y: chartY,
                    w: colRight - colLeft,
                    h: chartH
                });
            }

            // ── Cursor style ──
            var canvasRect = this.canvas.getBoundingClientRect();
            this.canvas.style.cursor = (this._hoverIndex >= 0) ? 'crosshair' : 'default';

            // ── Hover overlay ──
            if (this._hoverIndex >= 0 && this._hoverIndex < n) {
                var hx = xPositions[this._hoverIndex];

                // Vertical hover line
                ctx.strokeStyle = theme.edgeStrong;
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(hx, chartY);
                ctx.lineTo(hx, chartY + chartH);
                ctx.stroke();

                // Circle markers on each series
                for (var s = 0; s < seriesFields.length; s++) {
                    var sColor = getSeriesColor(theme, s);
                    var yRatio = seriesData[s][this._hoverIndex] / yMax;
                    var py = chartY + chartH - yRatio * chartH;

                    ctx.beginPath();
                    ctx.arc(hx, py, 4, 0, Math.PI * 2);
                    ctx.fillStyle = theme.panel;
                    ctx.fill();
                    ctx.strokeStyle = sColor;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                // Tooltip
                var tooltipLines = [];
                for (var s = 0; s < seriesFields.length; s++) {
                    tooltipLines.push({
                        color: getSeriesColor(theme, s),
                        label: seriesFields[s].name,
                        value: draw.formatNumber(seriesData[s][this._hoverIndex])
                    });
                }
                var tipX = hx + 12;
                var tipY = chartY + 10;
                drawTooltip(ctx, tipX, tipY, tooltipLines, theme, tokens, w, h);
            }

            // ── Annotation marker ──
            if (showMarker && markerIndex >= 0 && markerIndex < n) {
                var mx = xPositions[markerIndex];

                // Vertical dashed line
                ctx.strokeStyle = theme.edgeStrong;
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.moveTo(mx, chartY);
                ctx.lineTo(mx, chartY + chartH);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw circle marker on the first series
                var markerY = chartY + chartH - (seriesData[0][markerIndex] / yMax) * chartH;
                var markerColor = getSeriesColor(theme, 0);

                ctx.beginPath();
                ctx.arc(mx, markerY, 4, 0, Math.PI * 2);
                ctx.fillStyle = theme.panel;
                ctx.fill();
                ctx.strokeStyle = markerColor;
                ctx.lineWidth = 2;
                ctx.stroke();

                // Floating callout card
                var cardW = 120;
                var cardH = 32;
                var cardX = mx + 8;
                var cardY = markerY - cardH / 2;

                // Keep card in bounds
                if (cardX + cardW > chartX + chartW) {
                    cardX = mx - cardW - 8;
                }
                if (cardY < chartY) cardY = chartY;
                if (cardY + cardH > chartY + chartH) cardY = chartY + chartH - cardH;

                // Card background
                draw.roundRect(ctx, cardX, cardY, cardW, cardH, 4);
                ctx.fillStyle = theme.panel;
                ctx.fill();
                ctx.strokeStyle = theme.edge;
                ctx.lineWidth = 1;
                ctx.stroke();

                // Card text
                var cardLabel = markerLabel || formatTimeLabel(xRaw[markerIndex], xRaw);
                var cardValue = draw.formatNumber(seriesData[0][markerIndex]);

                ctx.font = '10px ' + tokens.fonts.primary;
                ctx.fillStyle = theme.textFaint;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(draw.ellipsis(ctx, cardLabel, cardW / 2 - 8), cardX + 6, cardY + cardH / 2);

                ctx.font = '600 12px ' + tokens.fonts.mono;
                ctx.fillStyle = theme.text;
                ctx.textAlign = 'right';
                ctx.fillText(cardValue, cardX + cardW - 6, cardY + cardH / 2);
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
