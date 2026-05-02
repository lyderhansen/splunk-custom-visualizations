/*
 * Ring Gauge — Splunk Custom Visualization
 *
 * Single-value gauge with progress toward a target. Supports full ring (360 deg)
 * and half-arc (180 deg) modes with optional threshold legend.
 *
 * Expected SPL columns: value (configurable field name)
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var tokens = require('shared/tokens');
    var draw = require('shared/draw');


    // ── Helper functions (pure, no `this`) ──────────────────────

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    function getThresholdColor(value, thresholdMid, thresholdHigh, colorLow, colorMid, colorHigh, defaultColor) {
        if (thresholdMid <= 0 && thresholdHigh <= 0) return defaultColor;
        if (value >= thresholdHigh) return colorHigh;
        if (value >= thresholdMid) return colorMid;
        return colorLow;
    }

    function drawThresholdLegend(ctx, cx, y, items, fontSize, fontFamily, textDimColor) {
        var dotR = Math.max(3, fontSize * 0.4);
        var pad = fontSize * 0.6;
        var totalW = 0;
        var i;

        ctx.font = '500 ' + fontSize + 'px ' + fontFamily;

        // Measure total width
        for (i = 0; i < items.length; i++) {
            totalW += dotR * 2 + pad * 0.4;
            totalW += ctx.measureText(items[i].label).width;
            if (i < items.length - 1) totalW += pad * 1.5;
        }

        var startX = cx - totalW / 2;
        var curX = startX;

        ctx.textBaseline = 'middle';
        for (i = 0; i < items.length; i++) {
            // Dot
            ctx.beginPath();
            ctx.arc(curX + dotR, y, dotR, 0, Math.PI * 2);
            ctx.fillStyle = items[i].color;
            ctx.fill();
            curX += dotR * 2 + pad * 0.4;

            // Label
            ctx.fillStyle = textDimColor;
            ctx.textAlign = 'left';
            ctx.fillText(items[i].label, curX, y);
            curX += ctx.measureText(items[i].label).width + pad * 1.5;
        }
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-ring-gauge-viz');

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
                    'Awaiting data — Ring Gauge'
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

            var row = data.rows[data.rows.length - 1];

            var result = { colIdx: colIdx, row: row };
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
            var field = (config[ns + 'field'] || 'value');
            var max = parseFloat(config[ns + 'max'] || '100');
            if (isNaN(max) || max <= 0) max = 100;
            var thick = parseFloat(config[ns + 'thick'] || '10');
            if (isNaN(thick) || thick <= 0) thick = 10;
            var half = (config[ns + 'half'] || 'false') === 'true';
            var color = (config[ns + 'color'] || '#2bbfb8');
            var subLabel = (config[ns + 'subLabel'] || '');
            var showThresholds = (config[ns + 'showThresholds'] || 'false') === 'true';
            var thresholdMid = parseFloat(config[ns + 'thresholdMid'] || '40');
            if (isNaN(thresholdMid)) thresholdMid = 40;
            var thresholdHigh = parseFloat(config[ns + 'thresholdHigh'] || '70');
            if (isNaN(thresholdHigh)) thresholdHigh = 70;
            var colorLow = (config[ns + 'colorLow'] || '#118832');
            var colorMid = (config[ns + 'colorMid'] || '#cba700');
            var colorHigh = (config[ns + 'colorHigh'] || '#d41f1f');

            var theme = tokens.getTheme(themeName);

            // ── Extract value from data ──
            var rawVal = 0;
            if (data.colIdx[field] !== undefined) {
                var v = parseFloat(data.row[data.colIdx[field]]);
                if (!isNaN(v)) rawVal = v;
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

            // ── Clear canvas ──
            ctx.clearRect(0, 0, w, h);

            // ── Layout calculations ──
            var legendH = 0;
            var legendFontSize = Math.max(9, Math.min(12, Math.min(w, h) * 0.04));
            if (showThresholds) {
                legendH = legendFontSize * 2.5;
            }

            var availW = w;
            var availH = h - legendH;

            // For half-arc, the ring is wider than tall (2:1 aspect)
            var ringSize;
            if (half) {
                ringSize = Math.min(availW * 0.8, availH * 1.4, 280);
            } else {
                ringSize = Math.min(availW, availH) * 0.7;
                ringSize = Math.min(ringSize, 280);
            }
            ringSize = Math.max(ringSize, 60);

            var radius = ringSize / 2 - thick / 2;
            if (radius < 10) radius = 10;

            var cx, cy;
            if (half) {
                cx = w / 2;
                cy = availH / 2 + radius * 0.35;
            } else {
                cx = w / 2;
                cy = availH / 2;
            }

            // ── Calculate fill percentage ──
            var pct = clamp(rawVal / max, 0, 1);

            // Determine fill color based on thresholds
            var fillColor = color;
            if (showThresholds) {
                fillColor = getThresholdColor(rawVal, thresholdMid, thresholdHigh, colorLow, colorMid, colorHigh, color);
            }

            // ── Draw track arc ──
            ctx.lineCap = 'round';
            if (half) {
                // Half-arc: 180 deg from left to right (opening upward)
                // drawArc uses -90 deg offset, so 180 deg -> 360 deg in standard math
                // maps to startDeg=90, endDeg=270 in drawArc coordinates
                draw.drawArc(ctx, cx, cy, radius, 90, 270, theme.edge, thick);

                // Draw filled portion
                var fillEndDeg = 90 + pct * 180;
                if (pct > 0.005) {
                    draw.drawArc(ctx, cx, cy, radius, 90, fillEndDeg, fillColor, thick);
                }
            } else {
                // Full ring: 360 deg
                draw.drawArc(ctx, cx, cy, radius, 0, 359.99, theme.edge, thick);

                // Draw filled portion
                var fillEndDeg = pct * 360;
                if (pct > 0.005) {
                    draw.drawArc(ctx, cx, cy, radius, 0, fillEndDeg, fillColor, thick);
                }
            }

            // ── Center content ──
            var bigFontSize = Math.max(12, Math.round(ringSize * 0.24));
            var subFontSize = Math.max(9, Math.min(11, ringSize * 0.08));
            var displayVal = draw.formatNumber(rawVal);

            // Big number
            ctx.font = '600 ' + bigFontSize + 'px ' + tokens.fonts.mono;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = theme.text;

            var textY;
            if (half) {
                textY = cy - radius * 0.15;
            } else {
                textY = subLabel ? cy - subFontSize * 0.6 : cy;
            }
            ctx.fillText(displayVal, cx, textY);

            // Sub-label
            if (subLabel) {
                ctx.font = '500 ' + subFontSize + 'px ' + tokens.fonts.primary;
                ctx.fillStyle = theme.textDim;
                if (half) {
                    ctx.fillText(subLabel, cx, cy + bigFontSize * 0.35);
                } else {
                    ctx.fillText(subLabel, cx, textY + bigFontSize * 0.5 + subFontSize * 0.3);
                }
            }

            // ── Threshold legend ──
            if (showThresholds && legendH > 0) {
                var legendY = availH + legendH * 0.4;
                var items = [
                    { color: colorLow, label: 'Low 0–' + (thresholdMid - 1) },
                    { color: colorMid, label: 'Mid ' + thresholdMid + '–' + (thresholdHigh - 1) },
                    { color: colorHigh, label: 'High ' + thresholdHigh + '+' }
                ];
                drawThresholdLegend(ctx, cx, legendY, items, legendFontSize, tokens.fonts.primary, theme.textDim);
            }

            // ── Reset state ──
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
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
