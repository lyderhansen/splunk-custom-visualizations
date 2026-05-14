/*
 * Red Bull Racing KPI Tile — F1 Telemetry Display
 *
 * Sharp-edged, flush with background, no rounded chrome.
 * Left accent stripe (not top bar). Monospace data font.
 * Feels like a pit wall telemetry readout.
 *
 * Expected SPL columns:
 *   value  — numeric primary value
 *   delta  — optional numeric delta/trend
 */
define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('../../shared/theme');

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

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            this.el.style.cursor = 'pointer';
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            this._tooltip = document.createElement('div');
            this._tooltip.style.cssText = 'position:absolute;display:none;padding:6px 10px;border-radius:2px;font:11px ' + theme.FONTS.data + ';pointer-events:none;z-index:9999;';
            this.el.appendChild(this._tooltip);

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;

            var self = this;
            this.el.addEventListener('mouseenter', function() { self._showTooltip(); });
            this.el.addEventListener('mouseleave', function() { self._hideTooltip(); });
            this.el.addEventListener('mousemove', function(e) { self._moveTooltip(e); });
        },

        _showTooltip: function() {
            if (!this._tooltipText) return;
            this._tooltip.style.display = 'block';
        },

        _hideTooltip: function() {
            this._tooltip.style.display = 'none';
        },

        _moveTooltip: function(e) {
            if (!this._tooltipText) return;
            var rect = this.el.getBoundingClientRect();
            var x = e.clientX - rect.left + 12;
            var y = e.clientY - rect.top - 28;
            this._tooltip.style.left = x + 'px';
            this._tooltip.style.top = y + 'px';
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
                    'Awaiting data — Red Bull KPI'
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

            var valueField = getOption(config, ns, 'field', 'value');
            var deltaField = getOption(config, ns, 'deltaField', 'delta');
            var label = getOption(config, ns, 'label', '');
            var unit = getOption(config, ns, 'unit', '');
            var unitPosition = getOption(config, ns, 'unitPosition', 'after');
            var accentColor = getOption(config, ns, 'accentColor', t.red);
            var showDelta = getOption(config, ns, 'showDelta', 'true');

            var row = data.rows[data.rows.length - 1];
            var colIdx = data.colIdx;
            var rawStr = (colIdx[valueField] !== undefined)
                ? String(row[colIdx[valueField]])
                : '';
            var rawValue = parseFloat(rawStr);
            var isNumeric = !isNaN(rawValue) && String(rawValue) === rawStr.replace(/^[+\s]+/, '');
            var deltaValue = (colIdx[deltaField] !== undefined)
                ? parseFloat(row[colIdx[deltaField]])
                : NaN;

            var decimals = parseInt(getOption(config, ns, 'decimals', '-1'), 10);
            var displayValue;
            if (!rawStr) {
                displayValue = '—';
            } else if (!isNumeric) {
                displayValue = rawStr;
            } else if (decimals >= 0) {
                displayValue = rawValue.toFixed(decimals);
            } else {
                displayValue = theme.fmtNum(rawValue, { compact: true });
            }
            if (unit && isNumeric) {
                displayValue = unitPosition === 'before'
                    ? unit + displayValue
                    : displayValue + unit;
            }

            // Tooltip content
            this._tooltipText = label + ': ' + displayValue;
            if (!isNaN(deltaValue)) {
                this._tooltipText += ' (' + (deltaValue >= 0 ? '+' : '') + deltaValue.toFixed(2) + '%)';
            }
            this._tooltip.textContent = this._tooltipText;
            this._tooltip.style.background = t.panelHi;
            this._tooltip.style.color = t.text;
            this._tooltip.style.border = '1px solid ' + t.edgeStrong;

            // ── F1 Telemetry panel — flush, sharp edges ────────────
            ctx.fillStyle = t.panel;
            ctx.fillRect(0, 0, w, h);

            // Left accent stripe (3px, sharp)
            ctx.fillStyle = accentColor;
            ctx.fillRect(0, 0, 3, h);

            // Bottom edge line (technical separator)
            ctx.fillStyle = t.edge;
            ctx.fillRect(3, h - 1, w - 3, 1);

            // ── Carbon fiber micro-texture (subtle diagonal hatch) ──
            ctx.save();
            ctx.globalAlpha = 0.015;
            ctx.strokeStyle = t.invert;
            ctx.lineWidth = 0.5;
            for (var i = -h; i < w + h; i += 8) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i + h, h);
                ctx.stroke();
            }
            ctx.restore();

            // ── Layout ──────────────────────────────────────────────
            var leftPad = 14;
            var labelY = h * 0.28;
            var valueY = h * 0.58;
            var deltaY = h * 0.82;
            var maxTextW = w - leftPad - 12;

            // ── Label (top, dim, uppercase) ─────────────────────────
            if (label) {
                var labelSize = Math.max(8, Math.min(11, h * 0.11));
                ctx.font = labelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textFaint;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(label.toUpperCase(), leftPad, labelY);
            }

            // ── Value (large, monospace, left-aligned) ──────────────
            var maxValueSize = Math.min(48, h * 0.32);
            var valueSize = fitText(ctx, displayValue, maxTextW, maxValueSize, 14, theme.FONTS.data);
            ctx.font = 'bold ' + valueSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayValue, leftPad, valueY);

            // ── Delta (inline, monospace) ───────────────────────────
            if (showDelta === 'true' && !isNaN(deltaValue)) {
                var positive = deltaValue >= 0;
                var deltaStr = (positive ? '▲ +' : '▼ ') + deltaValue.toFixed(1) + '%';
                var deltaFontSize = Math.max(8, Math.min(12, h * 0.10));
                ctx.font = deltaFontSize + 'px ' + theme.FONTS.data;
                ctx.fillStyle = positive ? t.success : t.danger;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(deltaStr, leftPad, deltaY);
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
