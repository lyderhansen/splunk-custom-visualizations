/*
 * Donut — Splunk Custom Visualization
 *
 * Part-to-whole composition donut chart. Used for revenue by region,
 * category breakdowns, and similar proportional data.
 *
 * Expected SPL columns: region/label (first col), amount/value (second col)
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var tokens = require('shared/tokens');
    var draw = require('shared/draw');


    // ── Constants ───────────────────────────────────────────────

    var PI2 = Math.PI * 2;
    var SERIES_COLORS_KEYS = ['s2', 's4', 'orange', 's1', 's3', 's5'];

    // ── Helper functions (pure, no `this`) ──────────────────────

    function getSeriesColors(theme) {
        var colors = [];
        for (var i = 0; i < SERIES_COLORS_KEYS.length; i++) {
            colors.push(theme[SERIES_COLORS_KEYS[i]]);
        }
        return colors;
    }

    function drawDonutArc(ctx, cx, cy, radius, startRad, endRad, color, lineWidth) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startRad, endRad, false);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'butt';
        ctx.stroke();
    }

    function drawLegendItem(ctx, x, y, swatchColor, label, valueText, availW, theme, fonts) {
        var swatchSize = 10;
        var swatchR = 2;
        var labelFontSize = 12;
        var valueFontSize = 13;
        var pad = 8;

        // Swatch
        draw.roundRect(ctx, x, y + 1, swatchSize, swatchSize, swatchR);
        ctx.fillStyle = swatchColor;
        ctx.fill();

        // Label
        var labelX = x + swatchSize + pad;
        var valueW = 0;

        ctx.font = '600 ' + valueFontSize + 'px ' + fonts.mono;
        valueW = ctx.measureText(valueText).width;

        var maxLabelW = availW - swatchSize - pad - valueW - pad;
        ctx.font = '500 ' + labelFontSize + 'px ' + fonts.primary;
        ctx.fillStyle = theme.textDim;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        var displayLabel = draw.ellipsis(ctx, label, maxLabelW);
        ctx.fillText(displayLabel, labelX, y + swatchSize / 2);

        // Value (right-aligned)
        ctx.font = '600 ' + valueFontSize + 'px ' + fonts.mono;
        ctx.fillStyle = theme.text;
        ctx.textAlign = 'right';
        ctx.fillText(valueText, x + availW, y + swatchSize / 2);

        ctx.textAlign = 'left';
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
            this.el.classList.add('super-co-donut-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
            this._hoverIndex = -1;
            this._segments = [];
            this._donutCenter = null;
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
                    'Awaiting data — Donut'
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

            var result = { colIdx: colIdx, rows: data.rows };
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
            var labelField = (config[ns + 'labelField'] || 'region');
            var valueField = (config[ns + 'valueField'] || 'amount');
            var centerLabel = (config[ns + 'centerLabel'] || '');
            var centerSubLabel = (config[ns + 'centerSubLabel'] || 'total');
            var legendPosition = (config[ns + 'legendPosition'] || 'auto');

            var theme = tokens.getTheme(themeName);
            var seriesColors = getSeriesColors(theme);

            // ── Extract segments from data ──
            var segments = [];
            var total = 0;
            var rows = data.rows;
            var colIdx = data.colIdx;
            var i;

            for (i = 0; i < rows.length; i++) {
                var row = rows[i];
                var label = '';
                var value = 0;

                if (colIdx[labelField] !== undefined) {
                    label = (row[colIdx[labelField]] || '').toString();
                }
                if (colIdx[valueField] !== undefined) {
                    var v = parseFloat(row[colIdx[valueField]]);
                    if (!isNaN(v) && v > 0) value = v;
                }

                if (value > 0) {
                    segments.push({
                        label: label,
                        value: value,
                        color: seriesColors[segments.length % seriesColors.length]
                    });
                    total += value;
                }
            }

            if (segments.length === 0 || total <= 0) {
                // Nothing to draw
                var el = this.el;
                var rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                var dpr = window.devicePixelRatio || 1;
                this.canvas.width = rect.width * dpr;
                this.canvas.height = rect.height * dpr;
                var ctx = this.canvas.getContext('2d');
                if (!ctx) return;
                ctx.scale(dpr, dpr);
                ctx.clearRect(0, 0, rect.width, rect.height);
                return;
            }

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

            // ── Determine legend layout ──
            var legendOnRight;
            if (legendPosition === 'right') {
                legendOnRight = true;
            } else if (legendPosition === 'bottom') {
                legendOnRight = false;
            } else {
                // auto: right if wider than tall
                legendOnRight = w > h;
            }

            // ── Layout calculations ──
            var pad = 16;
            var legendRowH = 20;
            var legendTotalH = segments.length * legendRowH;
            var legendW = Math.max(120, Math.min(200, w * 0.4));

            var donutAreaW, donutAreaH, donutAreaX, donutAreaY;
            var legendAreaX, legendAreaY, legendAreaW, legendAreaH;

            if (legendOnRight) {
                donutAreaW = w - legendW - pad;
                donutAreaH = h;
                donutAreaX = 0;
                donutAreaY = 0;
                legendAreaX = donutAreaW + pad;
                legendAreaY = 0;
                legendAreaW = legendW - pad;
                legendAreaH = h;
            } else {
                var legendBlockH = legendTotalH + pad;
                donutAreaW = w;
                donutAreaH = h - legendBlockH;
                donutAreaX = 0;
                donutAreaY = 0;
                legendAreaX = pad;
                legendAreaY = donutAreaH + pad * 0.5;
                legendAreaW = w - pad * 2;
                legendAreaH = legendBlockH;
            }

            // ── Calculate donut dimensions ──
            var donutSize = Math.min(donutAreaW, donutAreaH) * 0.85;
            donutSize = Math.min(donutSize, 340);
            donutSize = Math.max(donutSize, 60);

            var strokeW = Math.max(8, donutSize * 0.13);
            var outerR = donutSize / 2;
            var ringRadius = outerR - strokeW / 2;

            var cx = donutAreaX + donutAreaW / 2;
            var cy = donutAreaY + donutAreaH / 2;

            // ── Build segment angle data for hover ──
            var currentAngle = -Math.PI / 2; // Start at 12 o'clock
            var segData = [];

            for (i = 0; i < segments.length; i++) {
                var seg = segments[i];
                var sweep = (seg.value / total) * PI2;
                var endAngle = currentAngle + sweep;
                var pct = ((seg.value / total) * 100).toFixed(1);
                segData.push({
                    startAngle: currentAngle,
                    endAngle: endAngle,
                    label: seg.label,
                    value: seg.value,
                    color: seg.color,
                    pct: pct
                });
                currentAngle = endAngle;
            }
            this._segments = segData;
            this._donutCenter = { cx: cx, cy: cy, innerR: ringRadius - strokeW / 2, outerR: ringRadius + strokeW / 2 };

            // ── Draw donut ring with hover effects ──
            var hoverIdx = this._hoverIndex;
            this.canvas.style.cursor = hoverIdx >= 0 ? 'pointer' : 'default';

            for (i = 0; i < segData.length; i++) {
                var sd = segData[i];
                var drawCx = cx;
                var drawCy = cy;

                if (hoverIdx >= 0 && hoverIdx !== i) {
                    ctx.globalAlpha = 0.5;
                } else {
                    ctx.globalAlpha = 1;
                }

                if (hoverIdx === i) {
                    // Explode hovered segment 4px outward
                    var midAngle = (sd.startAngle + sd.endAngle) / 2;
                    drawCx = cx + Math.cos(midAngle) * 4;
                    drawCy = cy + Math.sin(midAngle) * 4;
                }

                drawDonutArc(ctx, drawCx, drawCy, ringRadius, sd.startAngle, sd.endAngle, sd.color, strokeW);
            }
            ctx.globalAlpha = 1;

            // ── Center content ──
            var displayLabel = centerLabel || draw.formatNumber(total);
            var centerFontSize = Math.max(14, Math.min(22, donutSize * 0.13));
            var subFontSize = Math.max(9, Math.min(11, donutSize * 0.065));

            // Main label
            ctx.font = '600 ' + centerFontSize + 'px ' + tokens.fonts.mono;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = theme.text;

            var centerTextY = centerSubLabel ? cy - subFontSize * 0.5 : cy;
            ctx.fillText(displayLabel, cx, centerTextY);

            // Sub-label
            if (centerSubLabel) {
                ctx.font = '500 ' + subFontSize + 'px ' + tokens.fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.fillText(centerSubLabel, cx, centerTextY + centerFontSize * 0.5 + subFontSize * 0.3);
            }

            // ── Draw legend ──
            var legendStartY;
            if (legendOnRight) {
                // Vertically center the legend in its area
                legendStartY = legendAreaY + (legendAreaH - legendTotalH) / 2;
                legendStartY = Math.max(legendAreaY + pad, legendStartY);
            } else {
                legendStartY = legendAreaY;
            }

            for (i = 0; i < segments.length; i++) {
                var seg = segments[i];
                var itemY = legendStartY + i * legendRowH;
                var formattedVal = draw.formatNumber(seg.value);

                drawLegendItem(
                    ctx,
                    legendAreaX,
                    itemY,
                    seg.color,
                    seg.label,
                    formattedVal,
                    legendAreaW,
                    theme,
                    tokens.fonts
                );
            }

            // ── Draw hover tooltip ──
            if (hoverIdx >= 0 && hoverIdx < segData.length) {
                var hs = segData[hoverIdx];
                var tooltipLines = [
                    { color: hs.color, text: hs.label, bold: false },
                    { text: draw.formatNumber(hs.value), bold: true },
                    { text: hs.pct + '%', dimmed: true }
                ];
                drawTooltipCard(ctx, this._lastMouseX + 12, this._lastMouseY + 12, tooltipLines, theme, tokens.fonts, w, h);
            }

            // ── Reset state ──
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        },

        // ── Hover hit-test ──

        _findHover: function(mx, my) {
            if (!this._donutCenter || !this._segments || this._segments.length === 0) return -1;
            var dc = this._donutCenter;
            var dx = mx - dc.cx;
            var dy = my - dc.cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < dc.innerR || dist > dc.outerR) return -1;
            var angle = Math.atan2(dy, dx);
            if (angle < -Math.PI / 2) angle += Math.PI * 2;
            for (var i = 0; i < this._segments.length; i++) {
                var seg = this._segments[i];
                var start = seg.startAngle;
                var end = seg.endAngle;
                if (angle >= start && angle < end) return i;
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
