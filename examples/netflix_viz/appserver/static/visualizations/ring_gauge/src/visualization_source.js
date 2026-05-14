/*
 * Netflix Ring Gauge — Splunk Custom Visualization
 *
 * 270deg arc (0.75pi .. 2.25pi), crimson to Netflix red, neon arc glow.
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

    function drawNeonPanel(ctx, t, accent, x, y, w, h) {
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        theme.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
        ctx.fillStyle = t.panel;
        ctx.fill();
        ctx.restore();
        resetShadow(ctx);

        theme.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
        ctx.strokeStyle = t.edge;
        ctx.lineWidth = 1;
        ctx.stroke();
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
            tip.className = 'netflix-ring-tooltip';
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
                count: 50
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Netflix Ring Gauge'
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

        _hitArc: function(mx, my) {
            var st = this._vizState;
            if (!st) return false;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return false;
            ctx.save();
            ctx.beginPath();
            ctx.arc(st.cx, st.cy, st.radius, st.startAngle, st.endAngle, false);
            ctx.lineWidth = st.lineWidth + 10;
            ctx.lineCap = 'round';
            var ok = ctx.isPointInStroke(mx, my);
            ctx.restore();
            return ok;
        },

        _handleMouseMove: function(ev) {
            var canvas = this.canvas;
            var rect = canvas.getBoundingClientRect();
            var mx = ev.clientX - rect.left;
            var my = ev.clientY - rect.top;
            if (!this._hitArc(mx, my)) {
                this._tooltip.style.display = 'none';
                return;
            }
            var st = this._vizState;
            var pctStr = (st.pct * 100).toFixed(1) + '%';
            var line1 = pctStr + ' of scale';
            var line2 = st.fieldName + ': ' + st.valueDisplay;
            this._tooltip.textContent = line1 + '\n' + line2;
            this._tooltip.style.display = 'block';
            var pr = this.el.getBoundingClientRect();
            this._tooltip.style.left = (ev.clientX - pr.left + 12) + 'px';
            this._tooltip.style.top = (ev.clientY - pr.top + 12) + 'px';
        },

        _handleMouseLeave: function() {
            this._tooltip.style.display = 'none';
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
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));

            var valueField = getOption(config, ns, 'field', 'value');
            var maxValue = parseFloat(getOption(config, ns, 'maxValue', '100'));
            if (!(maxValue > 0)) maxValue = 100;
            var unit = getOption(config, ns, 'unit', '%');
            var label = getOption(config, ns, 'label', '');
            var accentColor = getOption(config, ns, 'accentColor', '#E50914');
            var showGlow = theme.parseBool(getOption(config, ns, 'showGlow', 'true'), true);
            var decimals = parseInt(getOption(config, ns, 'decimals', '-1'), 10);

            var row = data.rows[data.rows.length - 1];
            var colIdx = data.colIdx;
            var rawValue = (colIdx[valueField] !== undefined)
                ? parseFloat(row[colIdx[valueField]])
                : NaN;
            if (isNaN(rawValue)) rawValue = 0;
            var pct = Math.max(0, Math.min(1, rawValue / maxValue));

            ctx.fillStyle = t.bg;
            ctx.fillRect(0, 0, w, h);

            drawNeonPanel(ctx, t, accentColor, 1, 1, w - 2, h - 2);

            var cx = w / 2;
            var cy = h * 0.52;
            var radius = Math.min(w, h) * 0.34;
            var lineWidth = Math.max(6, radius * 0.16);
            var startAngle = Math.PI * 0.75;
            var endAngle = Math.PI * 2.25;
            var sweep = endAngle - startAngle;
            var valueAngle = startAngle + sweep * pct;

            var deepRed = '#831010';
            var brightRed = accentColor;

            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, endAngle, false);
            ctx.strokeStyle = t.edgeStrong;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();
            resetShadow(ctx);

            if (pct > 0.004) {
                if (showGlow) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, startAngle, valueAngle, false);
                    ctx.strokeStyle = brightRed;
                    ctx.lineWidth = lineWidth + 6;
                    ctx.lineCap = 'round';
                    ctx.shadowColor = brightRed;
                    ctx.shadowBlur = 22;
                    ctx.globalAlpha = 0.45;
                    ctx.stroke();
                    ctx.restore();
                    resetShadow(ctx);
                }

                var segs = Math.max(8, Math.ceil(48 * pct));
                var spanV = valueAngle - startAngle;
                for (var s = 0; s < segs; s++) {
                    var u0 = s / segs;
                    var u1 = (s + 1) / segs;
                    var col = theme.lerpColor(deepRed, brightRed, u0 + (u1 - u0) * 0.5);
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, startAngle + spanV * u0, startAngle + spanV * u1, false);
                    ctx.strokeStyle = col;
                    ctx.lineWidth = lineWidth;
                    ctx.lineCap = 'butt';
                    ctx.stroke();
                }
                resetShadow(ctx);

                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAngle, valueAngle, false);
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.strokeStyle = brightRed;
                ctx.globalAlpha = 0.2;
                ctx.stroke();
                ctx.globalAlpha = 1;
                resetShadow(ctx);
            }

            var displayCore;
            if (decimals >= 0) {
                displayCore = rawValue.toFixed(decimals);
            } else {
                displayCore = theme.fmtNum(rawValue, { compact: true });
            }
            var displayVal = unit ? displayCore + unit : displayCore;
            var valSize = Math.max(14, Math.min(48, radius * 0.55));
            var valFont = 'bold ' + valSize + 'px ' + theme.FONTS.mono;

            if (showGlow) {
                theme.drawGlowText(ctx, displayVal, cx, cy, valFont, brightRed, 16);
                resetShadow(ctx);
            } else {
                ctx.font = valFont;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(displayVal, cx, cy);
            }

            if (label) {
                var labelSize = Math.max(9, Math.min(16, radius * 0.2));
                ctx.font = labelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, cx, cy + radius * 0.42 + labelSize * 0.5);
                resetShadow(ctx);
            }

            this._vizState = {
                cx: cx,
                cy: cy,
                radius: radius,
                lineWidth: lineWidth,
                startAngle: startAngle,
                endAngle: endAngle,
                pct: pct,
                fieldName: valueField,
                valueDisplay: displayCore
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
