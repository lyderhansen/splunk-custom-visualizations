/*
 * H&M Global Sales — Status Pill list (light-first, Scandinavian minimal).
 * Row-major SPL: labelField (market), statusField (growing|stable|declining), optional valueField.
 */
var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var theme = require('shared/theme');

function ensureHmFonts(vizInstance) {
    if (ensureHmFonts._scheduled) return;
    if (typeof document === 'undefined') return;
    ensureHmFonts._scheduled = true;
    var fid = 'hm-status-pill-fonts';
    if (!document.getElementById(fid)) {
        var link = document.createElement('link');
        link.id = fid;
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap';
        document.head.appendChild(link);
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(function () {
            if (vizInstance && vizInstance.reflow) vizInstance.reflow();
        });
    }
}

function normStatus(raw) {
    return (raw === null || raw === undefined ? '' : String(raw)).replace(/^\s+|\s+$/g, '').toLowerCase();
}

function statusHex(cfg, ns, raw, t) {
    var s = normStatus(raw);
    var g = getOption(cfg, ns, 'growingColor', '#2E7D32');
    var st = getOption(cfg, ns, 'stableColor', '#0F4B7D');
    var d = getOption(cfg, ns, 'decliningColor', '#C62828');
    if (s === 'growing') return g;
    if (s === 'stable') return st;
    if (s === 'declining') return d;
    return theme.severityColor(t, s);
}

function getOption(config, ns, key, defaultValue) {
    return theme.getOption(config, ns, key, defaultValue);
}

function getNS(viz) {
    return theme.getNS(viz);
}

module.exports = SplunkVisualizationBase.extend({

    initialize: function () {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.classList.add('hm-viz-status-pill');
        this.el.style.overflow = 'hidden';
        this.el.style.position = 'relative';

        var canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.cursor = 'default';
        this.el.appendChild(canvas);
        this.canvas = canvas;

        var tip = document.createElement('div');
        tip.className = 'hm-status-pill-tooltip';
        tip.style.cssText = [
            'position:absolute', 'display:none', 'padding:8px 10px',
            'background:#FFFFFF', 'color:#1A1A1A', 'font-size:12px',
            'border-radius:8px', 'pointer-events:none', 'white-space:pre-wrap',
            'max-width:280px', 'z-index:200', 'box-shadow:0 4px 16px rgba(0,0,0,0.12)',
            'border:1px solid rgba(26,26,26,0.08)', 'font-family:' + theme.FONTS.ui
        ].join(';');
        this.el.appendChild(tip);
        this._tooltip = tip;

        this._lastData = null;
        this._lastConfig = null;
        this._lastGoodData = null;
        this._hitRegions = [];
        this._hoverIdx = -1;

        var self = this;
        this._onMove = function (ev) { self._handleMouseMove(ev); };
        this._onLeave = function () { self._handleMouseLeave(); };
        canvas.addEventListener('mousemove', this._onMove);
        canvas.addEventListener('mouseleave', this._onLeave);

        this._ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(function () {
                self.reflow();
            });
            this._ro.observe(this.el);
        }

        ensureHmFonts(this);
    },

    getInitialDataParams: function () {
        return {
            outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
            count: 10000
        };
    },

    formatData: function (data) {
        if (!data || !data.rows || data.rows.length === 0) {
            if (this._lastGoodData) return this._lastGoodData;
            throw new SplunkVisualizationBase.VisualizationError(
                'Awaiting data — H&M Status Pill'
            );
        }
        var colIdx = {};
        var i;
        var fields = data.fields;
        for (i = 0; i < fields.length; i++) {
            colIdx[fields[i].name] = i;
        }
        var result = { colIdx: colIdx, rows: data.rows };
        this._lastGoodData = result;
        return result;
    },

    updateView: function (data, config) {
        if (!data) return;
        this._lastData = data;
        this._lastConfig = config;
        this._render(data, config);
    },

    _intensityScale: function (config) {
        var ns = getNS(this);
        var raw = parseInt(getOption(config, ns, 'accentIntensity', '50'), 10);
        if (isNaN(raw) || raw <= 0) raw = 50;
        return raw / 50;
    },

    _pickRowOpacity: function (config, hovered) {
        var k = this._intensityScale(config);
        if (hovered) return Math.min(0.22, 0.12 * k);
        return Math.min(0.14, 0.06 * k);
    },

    _hitTest: function (mx, my) {
        var regs = this._hitRegions;
        var j;
        for (j = 0; j < regs.length; j++) {
            var r = regs[j];
            if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return j;
        }
        return -1;
    },

    _handleMouseMove: function (ev) {
        var rect = this.canvas.getBoundingClientRect();
        var mx = ev.clientX - rect.left;
        var my = ev.clientY - rect.top;
        var idx = this._hitTest(mx, my);
        if (idx !== this._hoverIdx) {
            this._hoverIdx = idx;
            if (this._lastData && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }
        }
        this._updateTooltip(ev, mx, my, idx);
    },

    _handleMouseLeave: function () {
        this._hoverIdx = -1;
        if (this._tooltip) this._tooltip.style.display = 'none';
        if (this._lastData && this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    _updateTooltip: function (ev, mx, my, hitIdx) {
        var tip = this._tooltip;
        if (!tip || !this._lastData) return;
        if (hitIdx < 0) {
            tip.style.display = 'none';
            return;
        }
        var ns = getNS(this);
        var cfg = this._lastConfig || {};
        var labelField = getOption(cfg, ns, 'labelField', 'market');
        var statusField = getOption(cfg, ns, 'statusField', 'status');
        var valueField = getOption(cfg, ns, 'valueField', 'value');
        var colIdx = this._lastData.colIdx;
        var row = this._lastData.rows[hitIdx];
        if (!row) {
            tip.style.display = 'none';
            return;
        }
        var lb = colIdx[labelField] !== undefined ? String(row[colIdx[labelField]] || '') : '';
        var st = colIdx[statusField] !== undefined ? String(row[colIdx[statusField]] || '') : '';
        var vl = colIdx[valueField] !== undefined ? String(row[colIdx[valueField]] || '') : '';
        var lines = [];
        if (lb) lines.push(lb);
        if (st) lines.push('Status: ' + st);
        if (vl) lines.push(vl);
        tip.textContent = lines.join('\n');
        tip.style.display = 'block';
        var er = this.el.getBoundingClientRect();
        var lx = (ev ? (ev.clientX - er.left) : mx) + 12;
        var ly = (ev ? (ev.clientY - er.top) : my) + 12;
        tip.style.left = lx + 'px';
        tip.style.top = ly + 'px';
    },

    _render: function (data, config) {
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
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        var ns = getNS(this);
        var t = theme.getTheme(getOption(config, ns, 'theme', 'light'));
        var labelField = getOption(config, ns, 'labelField', 'market');
        var statusField = getOption(config, ns, 'statusField', 'status');
        var valueField = getOption(config, ns, 'valueField', 'value');
        var maxRows = parseInt(getOption(config, ns, 'maxRows', '15'), 10);
        if (isNaN(maxRows) || maxRows < 1) maxRows = 15;

        var colIdx = data.colIdx;
        var rows = data.rows;
        var count = rows.length;
        if (count > maxRows) count = maxRows;

        var outerPad = Math.max(10, Math.min(16, Math.min(w, h) * 0.02));
        var cardX = outerPad;
        var cardY = outerPad;
        var cardW = w - outerPad * 2;
        var cardH = h - outerPad * 2;
        if (cardW <= 8 || cardH <= 8) return;

        theme.drawPanel(ctx, t, cardX, cardY, cardW, cardH);
        theme.resetShadow(ctx);

        var innerPad = 14;
        var innerX = cardX + innerPad;
        var innerY = cardY + innerPad;
        var innerW = cardW - innerPad * 2;
        var innerH = cardH - innerPad * 2;
        if (innerW <= 4 || innerH <= 4) return;

        var gap = 6;
        var rowH = count > 0 ? (innerH - (count - 1) * gap) / count : 0;

        var pillR = 16;
        var dotR = 3.5;
        var labelFont = 12;
        var valueFont = 11;

        this._hitRegions = [];

        var i;
        for (i = 0; i < count; i++) {
            var row = rows[i];
            var statusRaw = colIdx[statusField] !== undefined
                ? row[colIdx[statusField]]
                : '';
            var labelTxt = colIdx[labelField] !== undefined
                ? String(row[colIdx[labelField]] || '')
                : '';
            var valueTxt = colIdx[valueField] !== undefined
                ? String(row[colIdx[valueField]] || '')
                : '';

            var hx = statusHex(config, ns, statusRaw, t);
            var y0 = innerY + i * (rowH + gap);
            var pillW = innerW;
            var pillH = rowH;

            this._hitRegions.push({
                x: innerX,
                y: y0,
                w: pillW,
                h: pillH,
                idx: i
            });

            var hovered = this._hoverIdx === i;
            var fillA = this._pickRowOpacity(config, hovered);

            ctx.save();
            theme.roundRect(ctx, innerX, y0, pillW, pillH, Math.min(pillR, pillH / 2));
            ctx.fillStyle = theme.withAlpha(hx, fillA);
            ctx.fill();
            ctx.restore();
            theme.resetShadow(ctx);

            ctx.save();
            theme.roundRect(ctx, innerX, y0, pillW, pillH, Math.min(pillR, pillH / 2));
            ctx.strokeStyle = t.edge;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
            theme.resetShadow(ctx);

            var cy = y0 + pillH / 2;
            var dotX = innerX + 14;
            ctx.save();
            ctx.beginPath();
            ctx.arc(dotX, cy, dotR, 0, Math.PI * 2);
            ctx.fillStyle = hx;
            ctx.fill();
            ctx.restore();
            theme.resetShadow(ctx);

            var textLeft = dotX + dotR + 10;
            var textRight = innerX + pillW - 12;
            var maxLabelW = textRight - textLeft - (valueTxt ? 52 : 0);
            if (maxLabelW < 24) maxLabelW = textRight - textLeft;

            ctx.save();
            ctx.font = '500 ' + labelFont + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            var drawLabel = labelTxt;
            var fs = theme.fitText(ctx, drawLabel, maxLabelW, labelFont, 9, theme.FONTS.ui);
            ctx.font = '500 ' + fs + 'px ' + theme.FONTS.ui;
            ctx.fillText(drawLabel, textLeft, cy);
            ctx.restore();
            theme.resetShadow(ctx);

            if (valueTxt) {
                ctx.save();
                ctx.font = '500 ' + valueFont + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = hx;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(valueTxt, textRight, cy);
                ctx.restore();
                theme.resetShadow(ctx);
            }
        }
    },

    reflow: function () {
        if (this._lastData && this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    destroy: function () {
        if (this._ro && this.el) {
            try { this._ro.unobserve(this.el); } catch (e1) {}
            this._ro = null;
        }
        if (this.canvas && this._onMove) {
            this.canvas.removeEventListener('mousemove', this._onMove);
            this.canvas.removeEventListener('mouseleave', this._onLeave);
        }
        if (this._tooltip && this._tooltip.parentNode) {
            this._tooltip.parentNode.removeChild(this._tooltip);
        }
        SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
    }
});
