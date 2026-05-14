/*
 * Netflix KPI Tile — Splunk Custom Visualization (Stranger Things neon)
 *
 * Row-major data; last row = primary values. Optional sparkline from value column history.
 */
define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('shared/theme');

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

    function resetShadow(ctx) {
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = 'transparent';
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';

            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            canvas.style.cursor = 'default';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            var tip = document.createElement('div');
            tip.className = 'netflix-kpi-tooltip';
            tip.style.display = 'none';
            this.el.appendChild(tip);
            this._tooltip = tip;

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this._vizState = null;

            var self = this;
            this._onMove = function(ev) { self._handleMouseMove(ev); };
            this._onLeave = function() { self._handleMouseLeave(); };
            canvas.addEventListener('mousemove', this._onMove);
            canvas.addEventListener('mouseleave', this._onLeave);

            this._ro = null;
            if (typeof ResizeObserver !== 'undefined') {
                this._ro = new ResizeObserver(function() {
                    self.reflow();
                });
                this._ro.observe(this.el);
            }
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 500
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Netflix KPI Tile'
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

        _collectSparklineValues: function(data, valueField, colIdx) {
            var out = [];
            if (!data || !data.rows || colIdx[valueField] === undefined) return out;
            var ci = colIdx[valueField];
            for (var r = 0; r < data.rows.length; r++) {
                var v = parseFloat(data.rows[r][ci]);
                if (!isNaN(v)) out.push(v);
            }
            return out;
        },

        _hitTest: function(mx, my) {
            var st = this._vizState;
            if (!st) return false;
            return mx >= st.hitX && mx <= st.hitX + st.hitW &&
                my >= st.hitY && my <= st.hitY + st.hitH;
        },

        _handleMouseMove: function(ev) {
            var canvas = this.canvas;
            var rect = canvas.getBoundingClientRect();
            var mx = ev.clientX - rect.left;
            var my = ev.clientY - rect.top;
            var st = this._vizState;
            if (!st || !this._hitTest(mx, my)) {
                this._tooltip.style.display = 'none';
                return;
            }
            var lines = st.fieldName + ': ' + st.rawDisplay;
            if (st.deltaLine) lines = lines + '\n' + st.deltaLine;
            this._tooltip.textContent = lines;
            this._tooltip.style.display = 'block';
            var pr = this.el.getBoundingClientRect();
            var lx = ev.clientX - pr.left + 12;
            var ly = ev.clientY - pr.top + 12;
            this._tooltip.style.left = lx + 'px';
            this._tooltip.style.top = ly + 'px';
        },

        _handleMouseLeave: function() {
            this._tooltip.style.display = 'none';
        },

        _drawNeonPanel: function(ctx, t, accent, x, y, w, h, glow) {
            ctx.save();
            if (glow) {
                ctx.shadowColor = accent;
                ctx.shadowBlur = 10;
            }
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            theme.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
            ctx.fillStyle = t.panel;
            ctx.fill();
            ctx.restore();
            resetShadow(ctx);

            theme.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
            ctx.strokeStyle = glow ? theme.withAlpha(accent, 0.25) : t.edge;
            ctx.lineWidth = 1;
            ctx.stroke();
        },

        _render: function(data, config) {
            var el = this.el;
            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            var ns = getNS(this);
            var themeName = getOption(config, ns, 'theme', 'dark');
            var t = theme.getTheme(themeName);
            var valueField = getOption(config, ns, 'field', 'value');
            var deltaField = getOption(config, ns, 'deltaField', 'delta');
            var label = getOption(config, ns, 'label', '');
            var unit = getOption(config, ns, 'unit', '');
            var unitPosition = getOption(config, ns, 'unitPosition', 'after');
            var accentColor = getOption(config, ns, 'accentColor', '#E50914');
            var showDelta = theme.parseBool(getOption(config, ns, 'showDelta', 'true'), true);
            var showGlow = theme.parseBool(getOption(config, ns, 'showGlow', 'true'), true);

            var row = data.rows[data.rows.length - 1];
            var colIdx = data.colIdx;
            var rawValue = (colIdx[valueField] !== undefined)
                ? parseFloat(row[colIdx[valueField]])
                : NaN;
            var deltaValue = (colIdx[deltaField] !== undefined)
                ? parseFloat(row[colIdx[deltaField]])
                : NaN;

            var decimals = parseInt(getOption(config, ns, 'decimals', '-1'), 10);
            var displayCore;
            if (isNaN(rawValue)) {
                displayCore = '\u2014';
            } else if (decimals >= 0) {
                displayCore = rawValue.toFixed(decimals);
            } else {
                displayCore = theme.fmtNum(rawValue, { compact: true });
            }
            var displayValue = displayCore;
            if (unit && !isNaN(rawValue)) {
                displayValue = unitPosition === 'before'
                    ? unit + displayCore
                    : displayCore + unit;
            }

            var sparkVals = this._collectSparklineValues(data, valueField, colIdx);
            var sparkH = (sparkVals.length >= 2) ? Math.max(22, Math.min(40, Math.floor(h * 0.14))) : 0;
            var bottomPad = sparkH > 0 ? sparkH + 10 : 10;

            ctx.fillStyle = t.bg;
            ctx.fillRect(0, 0, w, h);

            var margin = 1;
            this._drawNeonPanel(ctx, t, accentColor, margin, margin, w - margin * 2, h - margin * 2, showGlow);

            var innerX = margin + 1;
            var innerY = margin + 1;
            var innerW = w - (margin + 1) * 2;
            var innerH = h - (margin + 1) * 2;

            var barH = showGlow ? 3 : 2;
            ctx.save();
            ctx.beginPath();
            theme.roundRect(ctx, innerX + 0.5, innerY + 0.5, innerW - 1, barH + 8, 8);
            ctx.clip();
            var gBar = ctx.createLinearGradient(innerX, 0, innerX + innerW, 0);
            gBar.addColorStop(0, accentColor);
            gBar.addColorStop(1, theme.withAlpha(accentColor, 0.15));
            ctx.fillStyle = gBar;
            ctx.fillRect(innerX, innerY, innerW, barH);
            ctx.restore();
            resetShadow(ctx);

            var pad = 10;
            var contentTop = innerY + barH + pad;
            var contentBottom = innerY + innerH - bottomPad;
            var availH = Math.max(40, contentBottom - contentTop);

            var labelSize = Math.max(10, Math.min(15, Math.floor(availH * 0.12)));
            var valueSizeMax = Math.max(18, Math.min(72, Math.floor(availH * 0.42)));
            var trendSize = Math.max(9, Math.min(14, Math.floor(availH * 0.11)));

            var labelY = contentTop + (label ? labelSize : 0);
            var maxTextW = innerW - pad * 2;
            var valueSize = theme.fitText(ctx, displayValue, maxTextW, valueSizeMax, 14, theme.FONTS.mono);
            var valueY;
            if (label) {
                valueY = labelY + labelSize / 2 + 6 + valueSize / 2;
            } else {
                valueY = contentTop + pad / 2 + valueSize / 2;
            }
            var trendY = valueY + valueSize / 2 + 4 + trendSize / 2;

            if (sparkH > 0) {
                var minTrendBottom = contentBottom - sparkH - 8;
                if (trendY + trendSize > minTrendBottom) {
                    trendY = minTrendBottom - trendSize / 2;
                    valueY = trendY - valueSize / 2 - 4 - trendSize / 2;
                    labelY = valueY - valueSize / 2 - 6 - labelSize / 2;
                }
            }

            if (label) {
                ctx.font = labelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textFaint;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, innerX + innerW / 2, labelY);
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            var vx = innerX + innerW / 2;
            var valueFontStr = 'bold ' + valueSize + 'px ' + theme.FONTS.mono;
            if (showGlow && !isNaN(rawValue)) {
                theme.drawGlowText(ctx, displayValue, vx, valueY, valueFontStr, accentColor, 14);
                resetShadow(ctx);
            } else {
                ctx.font = valueFontStr;
                ctx.fillStyle = t.text;
                ctx.fillText(displayValue, vx, valueY);
            }

            var deltaLine = '';
            if (showDelta && !isNaN(deltaValue)) {
                var deltaStr = (deltaValue >= 0 ? '+' : '') + deltaValue.toFixed(1) + '%';
                deltaLine = deltaField + ': ' + deltaStr;
                var arrowSize = trendSize * 0.72;
                ctx.font = trendSize + 'px ' + theme.FONTS.mono;
                var tw = ctx.measureText(deltaStr).width;
                var totalW = arrowSize + 6 + tw;
                var sx = vx - totalW / 2;
                theme.drawDelta(ctx, sx, trendY - arrowSize / 2, arrowSize, deltaValue, t.success, t.danger);
                resetShadow(ctx);
                ctx.fillStyle = deltaValue >= 0 ? t.success : t.danger;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(deltaStr, sx + arrowSize + 6, trendY);
            }

            if (sparkH > 0) {
                var sx0 = innerX + pad;
                var sw = innerW - pad * 2;
                var sy0 = contentBottom - sparkH;
                theme.drawSparkline(ctx, sparkVals, sx0, sy0, sw, sparkH, accentColor, 'line');
                resetShadow(ctx);
            }

            ctx.save();
            ctx.beginPath();
            theme.roundRect(ctx, innerX + 0.5, innerY + 0.5, innerW - 1, innerH - 1, 8);
            ctx.clip();
            ctx.translate(innerX, innerY);
            theme.drawVignette(ctx, innerW, innerH, 0.22);
            ctx.restore();
            resetShadow(ctx);

            var rawDisp = isNaN(rawValue) ? displayCore : String(rawValue);

            this._vizState = {
                hitX: innerX,
                hitY: innerY,
                hitW: innerW,
                hitH: innerH,
                fieldName: valueField,
                rawDisplay: rawDisp,
                deltaLine: deltaLine
            };
        },

        reflow: function() {
            if (this._lastData && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }
        },

        destroy: function() {
            if (this.canvas) {
                this.canvas.removeEventListener('mousemove', this._onMove);
                this.canvas.removeEventListener('mouseleave', this._onLeave);
            }
            if (this._ro) {
                this._ro.disconnect();
                this._ro = null;
            }
            if (this._tooltip && this._tooltip.parentNode) {
                this._tooltip.parentNode.removeChild(this._tooltip);
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
