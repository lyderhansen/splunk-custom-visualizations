/*
 * H&M Global Sales — Ring Gauge (light, Scandinavian minimal)
 *
 * 270deg arc starting at 225deg; optional target tick; IBM Plex typography.
 * Pure ES5 — no const/let/arrow/template literals.
 */

var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var theme = require('shared/theme');

/** Bold monospace fit — theme.fitText uses weight 400 only */
function fitBoldMonoPercent(ctx, text, maxWidth, startSize, minSize, fontFamily) {
    var size = startSize;
    var min = (minSize > 0 ? minSize : 10);
    var family = fontFamily || theme.FONTS.mono;
    ctx.font = '700 ' + size + 'px ' + family;
    while (ctx.measureText(text).width > maxWidth && size > min) {
        size -= 1;
        ctx.font = '700 ' + size + 'px ' + family;
    }
    return size;
}

module.exports = SplunkVisualizationBase.extend({

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
        tip.className = 'hm-ring-gauge-tooltip';
        tip.style.cssText = [
            'position:absolute',
            'display:none',
            'padding:8px 10px',
            'background:#FFFFFF',
            'color:#1A1A1A',
            'font-size:11px',
            'border-radius:6px',
            'pointer-events:none',
            'white-space:pre-line',
            'z-index:100',
            'font-family:' + theme.FONTS.ui,
            'border:1px solid rgba(26,26,26,0.12)',
            'box-shadow:0 4px 12px rgba(0,0,0,0.08)'
        ].join(';');
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

        if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
            document.fonts.load('400 48px IBMPlexSans, "IBM Plex Sans", sans-serif').then(function() {
                self.reflow();
            });
            document.fonts.load('700 48px IBMPlexMono, "IBM Plex Mono", monospace').then(function() {
                self.reflow();
            });
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
                'Awaiting data — H&M Ring Gauge'
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
        ctx.lineWidth = st.lineWidth + 12;
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
        var lines = st.labelLine + '\n' + st.valueLine;
        if (st.targetLine) lines = lines + '\n' + st.targetLine;
        this._tooltip.textContent = lines;
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

        var ns = theme.getNS(this);
        var t = theme.getTheme(theme.getOption(config, ns, 'theme', 'light'));

        var valueField = theme.getOption(config, ns, 'field', 'value');
        var labelField = theme.getOption(config, ns, 'labelField', 'label');
        var targetField = theme.getOption(config, ns, 'targetField', 'target');
        var decimals = parseInt(theme.getOption(config, ns, 'decimals', '0'), 10);
        if (isNaN(decimals)) decimals = 0;
        var maxValue = theme.parseNum(theme.getOption(config, ns, 'maxValue', '100'), 100);
        if (!(maxValue > 0)) maxValue = 100;
        var accentColor = theme.getOption(config, ns, 'accentColor', '#0F4B7D');
        var accentIntensity = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '50'), 50);
        var accentAlpha = accentIntensity / 100;
        if (accentAlpha < 0) accentAlpha = 0;
        if (accentAlpha > 1) accentAlpha = 1;

        var row = data.rows[data.rows.length - 1];
        var colIdx = data.colIdx;

        var rawValue = (colIdx[valueField] !== undefined)
            ? parseFloat(row[colIdx[valueField]])
            : NaN;
        if (isNaN(rawValue)) rawValue = 0;
        var pct = rawValue / maxValue;
        if (pct < 0) pct = 0;
        if (pct > 1) pct = 1;

        var labelText = '';
        if (colIdx[labelField] !== undefined && row[colIdx[labelField]] !== null && row[colIdx[labelField]] !== undefined) {
            labelText = String(row[colIdx[labelField]]);
        }

        var rawTarget = NaN;
        if (colIdx[targetField] !== undefined) {
            rawTarget = parseFloat(row[colIdx[targetField]]);
        }
        var hasTarget = !isNaN(rawTarget);
        var targetPct = hasTarget ? rawTarget / maxValue : 0;
        if (targetPct < 0) targetPct = 0;
        if (targetPct > 1) targetPct = 1;

        theme.drawPanel(ctx, t, 1, 1, w - 2, h - 2);
        theme.resetShadow(ctx);

        theme.roundRect(ctx, 1, 1, w - 2, h - 2, 8);
        ctx.strokeStyle = t.edge;
        ctx.lineWidth = 1;
        ctx.stroke();
        theme.resetShadow(ctx);

        var cx = w / 2;
        var cy = h * 0.48;
        var radius = Math.min(w, h) * 0.34;
        var lw = Math.min(w, h) * 0.08;
        var startAngle = (225 * Math.PI) / 180;
        var endAngle = ((225 + 270) * Math.PI) / 180;
        var sweep = endAngle - startAngle;
        var valueAngle = startAngle + sweep * pct;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.strokeStyle = 'rgba(26,26,26,0.06)';
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.stroke();
        theme.resetShadow(ctx);

        if (pct > 0.002) {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, valueAngle, false);
            ctx.strokeStyle = accentColor;
            ctx.globalAlpha = accentAlpha;
            ctx.lineWidth = lw;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.globalAlpha = 1;
            theme.resetShadow(ctx);
        }

        if (hasTarget) {
            var ta = startAngle + sweep * targetPct;
            var ix = cx + Math.cos(ta) * radius;
            var iy = cy + Math.sin(ta) * radius;
            var nx = -Math.sin(ta);
            var ny = Math.cos(ta);
            var tickLen = Math.max(4, lw * 0.45);
            ctx.beginPath();
            ctx.moveTo(ix - nx * tickLen, iy - ny * tickLen);
            ctx.lineTo(ix + nx * tickLen, iy + ny * tickLen);
            ctx.strokeStyle = theme.withAlpha(accentColor, 0.55);
            ctx.lineWidth = Math.max(1.5, lw * 0.12);
            ctx.lineCap = 'butt';
            ctx.stroke();
            theme.resetShadow(ctx);
        }

        var pctStr = rawValue.toFixed(decimals) + '%';
        var maxTextW = (radius * 2) * 0.82;
        var valSize = fitBoldMonoPercent(ctx, pctStr, maxTextW, Math.min(w, h) * 0.2, 12, theme.FONTS.mono);
        ctx.font = '700 ' + valSize + 'px ' + theme.FONTS.mono;
        ctx.fillStyle = t.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pctStr, cx, cy);
        theme.resetShadow(ctx);

        if (labelText) {
            var labelSize = theme.fitText(ctx, labelText, maxTextW, Math.max(9, Math.min(14, Math.min(w, h) * 0.035)), 8, theme.FONTS.ui);
            ctx.font = '400 ' + labelSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(labelText, cx, cy + valSize * 0.55);
            theme.resetShadow(ctx);
        }

        var targetLine = '';
        if (hasTarget) {
            targetLine = 'Target: ' + rawTarget.toFixed(decimals) + '%';
        }

        this._vizState = {
            cx: cx,
            cy: cy,
            radius: radius,
            lineWidth: lw,
            startAngle: startAngle,
            endAngle: endAngle,
            pct: pct,
            labelLine: labelText || 'Gauge',
            valueLine: valueField + ': ' + rawValue.toFixed(decimals) + '%',
            targetLine: targetLine
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
