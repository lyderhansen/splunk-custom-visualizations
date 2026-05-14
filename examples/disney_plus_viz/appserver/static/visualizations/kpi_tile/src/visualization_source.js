/*
 * Disney+ KPI Tile — Splunk Custom Visualization
 *
 * Premium branded single-value tile with:
 *   - Accent gradient bar across the top
 *   - Large centered value with auto-scaling
 *   - Under-label and optional unit
 *   - Optional delta arrow with color
 *   - Panel chrome from theme tokens
 *
 * Expected SPL columns:
 *   value  — numeric primary value (field name configurable)
 *   delta  — optional numeric delta/trend (field name configurable)
 */
define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('../../shared/theme');

    // ── Helpers ─────────────────────────────────────────────────

    function getOption(config, ns, key, defaultValue) {
        var v = config[ns + key];
        if (v !== undefined && v !== null) return v;
        v = config[key];
        if (v !== undefined && v !== null) return v;
        return defaultValue;
    }

    function getNS(viz) {
        try {
            var info = viz.getPropertyNamespaceInfo();
            if (info && info.propertyNamespace) return info.propertyNamespace;
        } catch (e) {}
        return '';
    }

    function fitText(ctx, text, maxWidth, startSize, minSize, family) {
        var size = startSize;
        var min = minSize || 8;
        ctx.font = 'bold ' + size + 'px ' + family;
        while (ctx.measureText(text).width > maxWidth && size > min) {
            size -= 1;
            ctx.font = 'bold ' + size + 'px ' + family;
        }
        return size;
    }

    function drawDelta(ctx, x, y, size, value, upColor, downColor) {
        var positive = value >= 0;
        ctx.fillStyle = positive ? upColor : downColor;
        ctx.beginPath();
        if (positive) {
            ctx.moveTo(x, y + size);
            ctx.lineTo(x + size / 2, y);
            ctx.lineTo(x + size, y + size);
        } else {
            ctx.moveTo(x, y);
            ctx.lineTo(x + size / 2, y + size);
            ctx.lineTo(x + size, y);
        }
        ctx.closePath();
        ctx.fill();
    }

    // ── Visualization ───────────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;
            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
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
                    'Awaiting data — Disney+ KPI'
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
            if (!data) return;
            this._lastData = data;
            this._lastConfig = config;
            this._render(data, config);
        },

        _render: function(data, config) {
            var el = this.el;
            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            var ns = getNS(this);
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));

            // Read settings
            var valueField = getOption(config, ns, 'field', 'value');
            var deltaField = getOption(config, ns, 'deltaField', 'delta');
            var label = getOption(config, ns, 'label', '');
            var unit = getOption(config, ns, 'unit', '');
            var unitPosition = getOption(config, ns, 'unitPosition', 'after');
            var accentColor = getOption(config, ns, 'accentColor', t.accent);
            var showDelta = getOption(config, ns, 'showDelta', 'true');
            var showAccentBar = getOption(config, ns, 'showAccentBar', 'true');

            // Extract data (last row)
            var row = data.rows[data.rows.length - 1];
            var colIdx = data.colIdx;
            var rawValue = (colIdx[valueField] !== undefined)
                ? parseFloat(row[colIdx[valueField]])
                : NaN;
            var deltaValue = (colIdx[deltaField] !== undefined)
                ? parseFloat(row[colIdx[deltaField]])
                : NaN;

            // Format value
            var decimals = parseInt(getOption(config, ns, 'decimals', '-1'), 10);
            var displayValue;
            if (isNaN(rawValue)) {
                displayValue = '—';
            } else if (decimals >= 0) {
                displayValue = rawValue.toFixed(decimals);
            } else {
                displayValue = theme.fmtNum(rawValue, { compact: true });
            }
            if (unit && !isNaN(rawValue)) {
                displayValue = unitPosition === 'before'
                    ? unit + displayValue
                    : displayValue + unit;
            }

            // ── Draw panel chrome ───────────────────────────────
            var pad = 1;
            var radius = 6;
            theme.roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
            ctx.fillStyle = t.panel;
            ctx.fill();
            ctx.strokeStyle = t.edge;
            ctx.lineWidth = 1;
            ctx.stroke();

            // ── Accent gradient bar across top ──────────────────
            if (showAccentBar === 'true') {
                var barH = Math.max(3, h * 0.025);
                ctx.save();
                theme.roundRect(ctx, pad, pad, w - pad * 2, barH + radius, radius);
                ctx.clip();
                var grad = ctx.createLinearGradient(0, 0, w, 0);
                grad.addColorStop(0, accentColor);
                grad.addColorStop(1, theme.lerpColor(accentColor, '#A78BFA', 0.5));
                ctx.fillStyle = grad;
                ctx.fillRect(pad, pad, w - pad * 2, barH);
                ctx.restore();
            }

            // ── Layout zones ────────────────────────────────────
            var topOffset = (showAccentBar === 'true') ? h * 0.08 : 0;
            var contentH = h - topOffset;
            var centerY = topOffset + contentH * 0.42;
            var labelY = topOffset + contentH * 0.72;
            var deltaY = topOffset + contentH * 0.88;
            var maxTextW = w * 0.85;

            // ── Draw value ──────────────────────────────────────
            var maxValueSize = Math.min(72, contentH * 0.35);
            var valueSize = fitText(ctx, displayValue, maxTextW, maxValueSize, 14, theme.FONTS.mono);
            ctx.font = 'bold ' + valueSize + 'px ' + theme.FONTS.mono;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayValue, w / 2, centerY);

            // ── Draw label ──────────────────────────────────────
            if (label) {
                var labelSize = Math.max(8, Math.min(16, contentH * 0.09));
                ctx.font = labelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.fillText(label, w / 2, labelY);
            }

            // ── Draw delta ──────────────────────────────────────
            if (showDelta === 'true' && !isNaN(deltaValue)) {
                var deltaStr = (deltaValue >= 0 ? '+' : '') + deltaValue.toFixed(1) + '%';
                var deltaFontSize = Math.max(8, Math.min(14, contentH * 0.07));
                var arrowSize = deltaFontSize * 0.7;

                ctx.font = deltaFontSize + 'px ' + theme.FONTS.mono;
                var deltaTextW = ctx.measureText(deltaStr).width;
                var totalW = arrowSize + 4 + deltaTextW;
                var startX = (w - totalW) / 2;

                drawDelta(ctx, startX, deltaY - arrowSize / 2, arrowSize,
                    deltaValue, t.success, t.danger);

                ctx.fillStyle = deltaValue >= 0 ? t.success : t.danger;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(deltaStr, startX + arrowSize + 4, deltaY);
            }
        },

        reflow: function() {
            if (this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
