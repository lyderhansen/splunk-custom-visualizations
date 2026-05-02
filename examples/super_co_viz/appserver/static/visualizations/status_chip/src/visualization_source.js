/*
 * Status Chip — Splunk Custom Visualization
 *
 * Compact status indicator pill/badge with three variants:
 *   - header:  bordered pill with dot + label + value
 *   - badge:   solid semantic background with white text
 *   - service: tinted background with colored text + leading dot
 *
 * Expected SPL columns: label, value, status (configurable via formatter)
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {


    // ── Severity color map for badge variant ──────────────────────

    function severityColor(label, theme) {
        var lower = String(label).toLowerCase();
        if (lower === 'crit' || lower === 'critical') return theme.danger;
        if (lower === 'high') return theme.orange;
        if (lower === 'med' || lower === 'medium') return theme.warn;
        if (lower === 'low') return theme.success;
        return theme.s2;
    }

    // ── Status color map for service variant ──────────────────────

    function serviceColor(val, color, theme) {
        var lower = String(val).toLowerCase();
        if (lower === 'ok' || lower === 'up' || lower === 'healthy') return theme.success;
        if (lower === 'warn' || lower === 'warning' || lower === 'degraded') return theme.warn;
        if (lower === 'down' || lower === 'critical' || lower === 'error') return theme.danger;
        return color;
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('status-chip-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 50
            };
        },

        formatData: function(data, config) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Status Chip'
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

            var row = data.rows[data.rows.length - 1];
            var result = { colIdx: colIdx, row: row };
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
            var themeName  = (config[ns + 'theme'] || 'dark');
            var variant    = (config[ns + 'variant'] || 'header');
            var color      = (config[ns + 'color'] || '#2bbfb8');
            var labelField = (config[ns + 'labelField'] || 'label');
            var valueField = (config[ns + 'valueField'] || 'value');

            var theme = tokens.getTheme(themeName);

            // ── Extract data ──
            var labelText = '';
            var valueText = '';
            if (data.colIdx[labelField] !== undefined) {
                labelText = String(data.row[data.colIdx[labelField]] || '');
            }
            if (data.colIdx[valueField] !== undefined) {
                valueText = String(data.row[data.colIdx[valueField]] || '');
            }

            // ── Size canvas ──
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

            // ── Measure chip ──
            var padX = 7;
            var padY = Math.min(12, h * 0.2);
            var radius = 4;
            var dotR = 4;
            var gap = 6;

            var labelFontSize = 12;
            var valueFontSize = 13;
            var labelFont = '500 ' + labelFontSize + 'px ' + tokens.fonts.primary;
            var valueFont = '600 ' + valueFontSize + 'px ' + tokens.fonts.mono;

            // Measure text widths
            ctx.font = labelFont;
            var labelW = labelText ? ctx.measureText(labelText).width : 0;
            ctx.font = valueFont;
            var valueW = valueText ? ctx.measureText(valueText).width : 0;

            // Build chip width depending on variant
            var chipW, chipH;
            chipH = Math.max(labelFontSize, valueFontSize) + padY * 2;

            if (variant === 'badge') {
                // Badge: label only (sentence case), no dot
                chipW = padX * 2 + labelW;
                if (valueText) {
                    chipW += gap + valueW;
                }
            } else if (variant === 'service') {
                // Service: dot + value text
                var serviceText = valueText || labelText;
                ctx.font = '600 ' + valueFontSize + 'px ' + tokens.fonts.primary;
                var serviceW = ctx.measureText(serviceText).width;
                chipW = padX * 2 + dotR * 2 + gap + serviceW;
            } else {
                // Header: dot + label + value
                chipW = padX * 2 + dotR * 2 + gap;
                if (labelText) chipW += labelW + gap;
                if (valueText) chipW += valueW;
            }

            // Center the chip in the container
            var chipX = (w - chipW) / 2;
            var chipY = (h - chipH) / 2;

            // ── Resolve accent color ──
            // User-picked color overrides auto-mapping; auto-map only at default
            var isDefaultColor = (color === '#2bbfb8');
            var accentColor = color;
            if (variant === 'badge' && isDefaultColor) {
                accentColor = severityColor(labelText, theme);
            } else if (variant === 'service' && isDefaultColor) {
                accentColor = serviceColor(valueText || labelText, color, theme);
            }

            // ── Draw chip background ──
            if (variant === 'badge') {
                ctx.fillStyle = accentColor;
                draw.roundRect(ctx, chipX, chipY, chipW, chipH, radius);
                ctx.fill();

                // Badge text: white
                var curX = chipX + padX;
                var textY = chipY + chipH / 2;

                if (labelText) {
                    ctx.font = '600 ' + labelFontSize + 'px ' + tokens.fonts.primary;
                    ctx.fillStyle = '#ffffff';
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'left';
                    ctx.fillText(labelText, curX, textY);
                    curX += labelW + gap;
                }
                if (valueText) {
                    ctx.font = valueFont;
                    ctx.fillStyle = '#ffffff';
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'left';
                    ctx.fillText(valueText, curX, textY);
                }
            } else if (variant === 'service') {
                // Tinted background: accentColor at 12% alpha
                var rgb = tokens.hexToRgb(accentColor);
                ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.12)';
                draw.roundRect(ctx, chipX, chipY, chipW, chipH, radius);
                ctx.fill();

                var curX2 = chipX + padX;
                var textY2 = chipY + chipH / 2;

                // Leading dot
                ctx.beginPath();
                ctx.arc(curX2 + dotR, textY2, dotR, 0, Math.PI * 2);
                ctx.fillStyle = accentColor;
                ctx.fill();
                curX2 += dotR * 2 + gap;

                // Service text in color
                var serviceText2 = valueText || labelText;
                ctx.font = '600 ' + valueFontSize + 'px ' + tokens.fonts.primary;
                ctx.fillStyle = accentColor;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                ctx.fillText(serviceText2, curX2, textY2);
            } else {
                // Header variant: 1px border, panel bg
                ctx.fillStyle = theme.panel;
                draw.roundRect(ctx, chipX, chipY, chipW, chipH, radius);
                ctx.fill();

                ctx.strokeStyle = theme.edge;
                ctx.lineWidth = 1;
                draw.roundRect(ctx, chipX, chipY, chipW, chipH, radius);
                ctx.stroke();

                var curX3 = chipX + padX;
                var textY3 = chipY + chipH / 2;

                // Dot
                ctx.beginPath();
                ctx.arc(curX3 + dotR, textY3, dotR, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                curX3 += dotR * 2 + gap;

                // Label
                if (labelText) {
                    ctx.font = labelFont;
                    ctx.fillStyle = theme.textDim;
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'left';
                    ctx.fillText(labelText, curX3, textY3);
                    curX3 += labelW + gap;
                }

                // Value
                if (valueText) {
                    ctx.font = valueFont;
                    ctx.fillStyle = theme.text;
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'left';
                    ctx.fillText(valueText, curX3, textY3);
                }
            }

            // Reset
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
            var gp = fontSize * 0.5;

            ctx.font = '500 ' + fontSize + 'px ' + tokens.fonts.primary;
            while (ctx.measureText(message).width > maxTextW && fontSize > 8) {
                fontSize -= 1;
                emojiSize = Math.round(fontSize * 1.6);
                ctx.font = '500 ' + fontSize + 'px ' + tokens.fonts.primary;
            }

            ctx.font = emojiSize + 'px ' + tokens.fonts.primary;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.fillText('⏳', w / 2, h / 2 - fontSize * 0.5 - gp);

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
