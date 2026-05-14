/*
 * Nike Training Club — Program Bars
 * Ranked horizontal bars showing program engagement scores.
 * ES5 only. Canvas 2D. No jQuery.
 */
var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var theme = require('shared/theme');

module.exports = SplunkVisualizationBase.extend({

    initialize: function() {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.style.overflow = 'hidden';
        this._hitRegions = [];
        this._tooltip = document.createElement('div');
        this._tooltip.style.cssText =
            'position:absolute;display:none;padding:6px 10px;' +
            'background:rgba(0,0,0,0.90);color:#fff;font-size:12px;' +
            'border-radius:3px;pointer-events:none;white-space:nowrap;' +
            'z-index:100;font-family:' + theme.FONTS.ui + ';';
        this.el.style.position = 'relative';
        this.el.appendChild(this._tooltip);
        var self = this;
        this.el.addEventListener('mousemove', function(e) { self._onHover(e); });
        this.el.addEventListener('mouseleave', function() {
            self._tooltip.style.display = 'none';
            self._hoveredIdx = -1;
            if (self._lastData && self._lastConfig) self._render(self._lastData, self._lastConfig);
        });
    },

    getInitialDataParams: function() {
        return {
            outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
            count: 10000
        };
    },

    formatData: function(data) {
        if (!data || !data.rows || data.rows.length === 0) {
            if (this._lastGoodData) return this._lastGoodData;
            return data;
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
        if (!data || !data.colIdx) return;
        this._lastData = data;
        this._lastConfig = config;
        this._hoveredIdx = -1;
        this._render(data, config);
    },

    _render: function(data, config) {
        var ns = theme.getNS(this);
        var t = theme.getTheme(theme.getOption(config, ns, 'theme', 'dark'));
        var gi = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '50'), 50) / 50;

        var nameField = theme.getOption(config, ns, 'nameField', 'program');
        var valueField = theme.getOption(config, ns, 'valueField', 'score');
        var maxValue = theme.parseNum(theme.getOption(config, ns, 'maxValue', '100'), 100);
        var showValues = theme.getOption(config, ns, 'showValues', 'true') !== 'false';
        var accentColor = theme.getOption(config, ns, 'accentColor', t.accent);

        var setup = theme.setupCanvas(this.el);
        var ctx = setup.ctx;
        var w = setup.w;
        var h = setup.h;
        this._canvas = setup.canvas;

        ctx.clearRect(0, 0, w, h);

        // Panel chrome
        ctx.fillStyle = t.panel;
        theme.roundRect(ctx, 0, 0, w, h, 2);
        ctx.fill();
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 2, 2, h - 4);

        var rows = data.rows;
        var ci = data.colIdx;
        var pad = Math.max(8, Math.round(w * 0.03));
        var topPad = pad;
        var rowCount = Math.min(rows.length, 15);
        var gap = Math.max(3, Math.round(h * 0.01));
        var availH = h - topPad * 2;
        var rowH = Math.max(16, Math.floor((availH - (rowCount - 1) * gap) / rowCount));
        var fontSize = Math.max(8, Math.round(rowH * 0.45));
        var labelW = Math.round(w * 0.35);
        var barX = pad + 6 + labelW + 8;
        var barMaxW = w - barX - pad - (showValues ? 50 : 10);

        this._hitRegions = [];

        for (var i = 0; i < rowCount; i++) {
            var row = rows[i];
            var name = ci[nameField] !== undefined ? String(row[ci[nameField]]) : '';
            var val = ci[valueField] !== undefined ? parseFloat(row[ci[valueField]]) : 0;
            if (isNaN(val)) val = 0;
            var pct = Math.min(val / maxValue, 1);

            var ry = topPad + i * (rowH + gap);
            var isHovered = (this._hoveredIdx === i);

            // Bar background
            ctx.fillStyle = t.name === 'dark' ? '#1A1A1A' : 'rgba(0,0,0,0.04)';
            ctx.fillRect(barX, ry, barMaxW, rowH);

            // Bar fill — opacity fades from top to bottom
            var barOpacity = 0.3 + 0.7 * (1 - i / rowCount);
            if (isHovered) barOpacity = Math.min(1, barOpacity + 0.2);
            ctx.fillStyle = theme.withAlpha(accentColor, barOpacity);
            ctx.fillRect(barX, ry, barMaxW * pct, rowH);

            // Name label
            ctx.font = (isHovered ? '700 ' : '400 ') + fontSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = isHovered ? t.text : t.textDim;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(name, pad + 6, ry + rowH / 2);

            // Score
            if (showValues) {
                ctx.font = '600 ' + fontSize + 'px ' + theme.FONTS.data;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'right';
                ctx.fillText(String(Math.round(val)), w - pad, ry + rowH / 2);
            }

            this._hitRegions.push({ y: ry, h: rowH, name: name, value: val });
        }
    },

    _onHover: function(e) {
        if (!this._canvas) return;
        var rect = this._canvas.getBoundingClientRect();
        var my = e.clientY - rect.top;
        var hit = -1;
        for (var i = 0; i < this._hitRegions.length; i++) {
            var r = this._hitRegions[i];
            if (my >= r.y && my <= r.y + r.h) { hit = i; break; }
        }
        if (hit !== this._hoveredIdx) {
            this._hoveredIdx = hit;
            if (this._lastData && this._lastConfig) this._render(this._lastData, this._lastConfig);
        }
        if (hit >= 0) {
            var hr = this._hitRegions[hit];
            this._tooltip.textContent = hr.name + ': ' + hr.value;
            this._tooltip.style.display = 'block';
            var elRect = this.el.getBoundingClientRect();
            this._tooltip.style.left = (e.clientX - elRect.left + 12) + 'px';
            this._tooltip.style.top = (e.clientY - elRect.top - 8) + 'px';
        } else {
            this._tooltip.style.display = 'none';
        }
    },

    reflow: function() {
        if (this._lastData && this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    destroy: function() {
        if (this._tooltip && this._tooltip.parentNode) {
            this._tooltip.parentNode.removeChild(this._tooltip);
        }
        SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
    }
});
