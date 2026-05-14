/*
 * H&M Global Sales — KPI card (light-first, Scandinavian minimal).
 * ES5 only: var, function, classic string concat. No const/let/arrow/template literals.
 */

var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var theme = require('shared/theme');

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
        tip.style.display = 'none';
        tip.style.position = 'absolute';
        tip.style.pointerEvents = 'none';
        tip.style.zIndex = '50';
        tip.style.padding = '8px 12px';
        tip.style.borderRadius = '8px';
        tip.style.border = '1px solid rgba(26,26,26,0.10)';
        tip.style.backgroundColor = '#FFFFFF';
        tip.style.color = '#1A1A1A';
        tip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
        tip.style.fontFamily = theme.FONTS.ui;
        tip.style.fontSize = '11px';
        tip.style.lineHeight = '1.4';
        tip.style.whiteSpace = 'nowrap';
        this.el.appendChild(tip);
        this._tooltip = tip;

        this._lastData = null;
        this._lastConfig = null;
        this._lastGoodData = null;
        this._fontsReady = false;
        this._fontLoadStarted = false;
        this._fontDoneQueue = [];
        this._cardHit = null;

        var self = this;
        this._onMove = function(ev) { self._handleMouseMove(ev); };
        this._onLeave = function() { self._handleMouseLeave(); };
        this.canvas.addEventListener('mousemove', this._onMove);
        this.canvas.addEventListener('mouseleave', this._onLeave);
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
            throw new SplunkVisualizationBase.VisualizationError(
                'Awaiting data — H&M KPI Card'
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
        var self = this;
        this._ensureFonts(function() {
            self._render(data, config);
        });
    },

    _ensureFonts: function(done) {
        if (this._fontsReady) {
            done();
            return;
        }
        this._fontDoneQueue.push(done);
        if (this._fontLoadStarted) {
            return;
        }
        if (!document.fonts || typeof document.fonts.load !== 'function') {
            this._fontsReady = true;
            this._flushFontQueue();
            return;
        }
        this._fontLoadStarted = true;
        var self = this;

        function flushAll() {
            self._fontsReady = true;
            self._fontLoadStarted = false;
            self._flushFontQueue();
        }

        try {
            var p1 = document.fonts.load('400 13px \"IBM Plex Sans\"');
            var p2 = document.fonts.load('700 48px \"IBM Plex Mono\"');
            var chain = p1;
            if (typeof p2 !== 'undefined' && p2 && typeof p2.then === 'function') {
                chain = chain.then(function() { return p2; });
            }
            if (chain && typeof chain.then === 'function') {
                chain.then(flushAll, flushAll);
            } else {
                flushAll();
            }
        } catch (e1) {
            flushAll();
        }
    },

    _flushFontQueue: function() {
        var q = this._fontDoneQueue;
        this._fontDoneQueue = [];
        for (var i = 0; i < q.length; i++) {
            try {
                q[i]();
            } catch (e2) {}
        }
    },

    _handleMouseMove: function(ev) {
        var rect = this.canvas.getBoundingClientRect();
        var mx = ev.clientX - rect.left;
        var my = ev.clientY - rect.top;
        if (this._cardHit &&
            mx >= this._cardHit.x && mx <= this._cardHit.x + this._cardHit.w &&
            my >= this._cardHit.y && my <= this._cardHit.y + this._cardHit.h) {
            this._tooltip.style.display = 'block';
            this._tooltip.textContent = this._cardHit.tooltipText;
            var tw = this._tooltip.offsetWidth;
            var th = this._tooltip.offsetHeight;
            var tx = mx + 14;
            var ty = my + 14;
            var ew = this.el.offsetWidth;
            var eh = this.el.offsetHeight;
            if (tx + tw > ew) tx = ew - tw - 6;
            if (ty + th > eh) ty = eh - th - 6;
            if (tx < 4) tx = 4;
            if (ty < 4) ty = 4;
            this._tooltip.style.left = tx + 'px';
            this._tooltip.style.top = ty + 'px';
        } else {
            this._tooltip.style.display = 'none';
        }
    },

    _handleMouseLeave: function() {
        this._tooltip.style.display = 'none';
    },

    _parseSparkline: function(raw) {
        if (raw === null || raw === undefined) return [];
        var parts = String(raw).split(',');
        var vals = [];
        for (var j = 0; j < parts.length; j++) {
            var q = parseFloat(parts[j]);
            if (!isNaN(q)) vals.push(q);
        }
        return vals;
    },

    _formatDeltaPct: function(d) {
        if (d === null || d === undefined || isNaN(d)) return '';
        var sign = d >= 0 ? '+' : '';
        return sign + d.toFixed(1) + '%';
    },

    _composeValueParts: function(numStr, unit, unitPosition) {
        var u = (unit !== null && unit !== undefined) ? String(unit) : '';
        var pos = (unitPosition || 'before').toString().toLowerCase();
        if (!u) return numStr;
        if (pos === 'after') return numStr + u;
        return u + numStr;
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
        var themeName = theme.getOption(config, ns, 'theme', 'light');
        var t = theme.getTheme(themeName);

        var fieldName = theme.getOption(config, ns, 'field', 'value');
        var labelField = theme.getOption(config, ns, 'labelField', 'label');
        var deltaField = theme.getOption(config, ns, 'deltaField', 'delta');
        var unitField = theme.getOption(config, ns, 'unitField', 'unit');
        var sparklineField = theme.getOption(config, ns, 'sparklineField', 'sparkline');

        var decimalsRaw = theme.getOption(config, ns, 'decimals', '-1');
        var decimals = parseInt(decimalsRaw, 10);
        if (isNaN(decimals)) decimals = -1;

        var compactNumber = theme.parseBool(theme.getOption(config, ns, 'compactNumber', 'true'), true);
        var unitPosition = theme.getOption(config, ns, 'unitPosition', 'before');

        var accentColor = theme.getOption(config, ns, 'accentColor', '#CC071E');
        var accentIntensity = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '50'), 50);
        if (accentIntensity < 0) accentIntensity = 0;
        if (accentIntensity > 100) accentIntensity = 100;
        var accentAlpha = accentIntensity / 100;
        if (accentAlpha < 0.08) accentAlpha = 0.08;
        if (accentAlpha > 1) accentAlpha = 1;
        var accentBarColor = theme.withAlpha(accentColor, accentAlpha);

        var showDelta = theme.parseBool(theme.getOption(config, ns, 'showDelta', 'true'), true);
        var showSparkline = theme.parseBool(theme.getOption(config, ns, 'showSparkline', 'true'), true);

        var colIdx = data.colIdx;
        var rows = data.rows;
        if (colIdx[fieldName] === undefined) {
            ctx.fillStyle = t.textDim;
            ctx.font = '12px ' + theme.FONTS.ui;
            ctx.fillText('Missing column: ' + fieldName, 12, 24);
            this._cardHit = null;
            return;
        }

        var row = rows[0];
        var vi = colIdx[fieldName];
        var rawVal = row[vi];
        var num = parseFloat(rawVal);
        if (isNaN(num)) num = NaN;

        var labelStr = '\u2014';
        if (colIdx[labelField] !== undefined) {
            var lv = row[colIdx[labelField]];
            if (lv !== null && lv !== undefined) labelStr = String(lv);
        }

        var unitStr = '';
        if (colIdx[unitField] !== undefined) {
            var uv = row[colIdx[unitField]];
            if (uv !== null && uv !== undefined) unitStr = String(uv);
        }

        var deltaVal = NaN;
        if (colIdx[deltaField] !== undefined) {
            deltaVal = parseFloat(row[colIdx[deltaField]]);
        }

        var sparkVals = [];
        if (showSparkline && colIdx[sparklineField] !== undefined) {
            sparkVals = this._parseSparkline(row[colIdx[sparklineField]]);
        }

        var numStr;
        if (isNaN(num)) {
            numStr = '\u2014';
        } else {
            numStr = theme.formatValue(num, decimals, compactNumber);
        }

        var displayValue = this._composeValueParts(numStr, unitStr, unitPosition);

        var tipBody = labelStr + ': ' + displayValue;
        if (!isNaN(deltaVal)) {
            tipBody = tipBody + ' (' + this._formatDeltaPct(deltaVal) + ')';
        }
        this._tooltip.textContent = tipBody;

        var pad = Math.max(8, Math.min(w, h) * 0.04);
        var cardX = pad;
        var cardY = pad;
        var cardW = w - pad * 2;
        var cardH = h - pad * 2;
        if (cardW < 32 || cardH < 32) return;

        this._cardHit = {
            x: cardX,
            y: cardY,
            w: cardW,
            h: cardH,
            tooltipText: tipBody
        };

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.08)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;
        theme.roundRect(ctx, cardX, cardY, cardW, cardH, 8);
        ctx.fillStyle = t.panel;
        ctx.fill();
        ctx.restore();
        theme.resetShadow(ctx);

        ctx.save();
        theme.roundRect(ctx, cardX, cardY, cardW, cardH, 8);
        ctx.clip();
        ctx.fillStyle = accentBarColor;
        ctx.fillRect(cardX, cardY, 2, cardH);
        ctx.restore();
        theme.resetShadow(ctx);

        var innerX = cardX + 14;
        var innerW = cardW - 14 - 12;
        var innerTop = cardY + 14;

        var sparkH = 0;
        if (showSparkline && sparkVals.length >= 2) {
            sparkH = Math.max(22, Math.min(36, Math.floor(cardH * 0.18)));
        }
        var contentBottom = cardY + cardH - 14 - sparkH - (sparkH > 0 ? 8 : 0);

        var labelSize = Math.max(10, Math.min(13, Math.floor(cardH * 0.078)));
        var y = innerTop;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = '400 ' + labelSize + 'px ' + theme.FONTS.ui;
        ctx.fillStyle = t.textDim;
        var labelFit = theme.fitText(ctx, labelStr, innerW, labelSize, 8, theme.FONTS.ui);
        ctx.font = '400 ' + labelFit + 'px ' + theme.FONTS.ui;
        ctx.fillText(labelStr, innerX, y);
        y = y + labelFit + 10;

        var valueMaxW = innerW - 4;
        var startValueSize = Math.max(18, Math.min(54, Math.floor(cardH * 0.26)));
        var valueFit = theme.fitText(ctx, displayValue, valueMaxW, startValueSize, 14, theme.FONTS.mono);
        ctx.font = '700 ' + valueFit + 'px ' + theme.FONTS.mono;
        ctx.fillStyle = t.text;
        ctx.fillText(displayValue, innerX, y);
        var valueBlockH = valueFit;
        y = y + valueBlockH + 6;

        if (showDelta && !isNaN(deltaVal) && valueFit > 12) {
            var triSize = Math.max(5, Math.min(10, Math.floor(labelSize)));
            var textY = y;
            var triX = innerX;
            var triTop = textY + 1;
            theme.drawDelta(ctx, triX, triTop, triSize, deltaVal, t.success, t.danger);
            theme.resetShadow(ctx);
            ctx.font = '400 ' + Math.max(9, Math.min(12, labelSize)) + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = deltaVal >= 0 ? t.success : t.danger;
            ctx.textBaseline = 'top';
            var dStr = this._formatDeltaPct(deltaVal);
            ctx.fillText(dStr, triX + triSize + 6, textY);
            y = textY + Math.max(triSize, 12) + 8;
        }

        if (y > contentBottom - 4) {
            y = contentBottom - 4;
        }

        if (showSparkline && sparkVals.length >= 2) {
            var sx = innerX;
            var sw = innerW;
            var sy = cardY + cardH - 14 - sparkH;
            theme.drawSparkline(ctx, sparkVals, sx, sy, sw, sparkH, accentColor, 'area');
            theme.resetShadow(ctx);
        }
    },

    reflow: function() {
        if (this._lastData && this._lastConfig) {
            var self = this;
            this._ensureFonts(function() {
                self._render(self._lastData, self._lastConfig);
            });
        }
    },

    destroy: function() {
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
