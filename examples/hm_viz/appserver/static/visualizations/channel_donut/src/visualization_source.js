/*
 * H&M Global Sales — Channel donut (light-first, Scandinavian minimal).
 * ES5 only: var, function, classic concat. No const/let/arrow/template literals.
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
        tip.style.lineHeight = '1.45';
        tip.style.whiteSpace = 'nowrap';
        this.el.appendChild(tip);
        this._tooltip = tip;

        this._lastData = null;
        this._lastConfig = null;
        this._lastGoodData = null;
        this._fontsReady = false;
        this._fontLoadStarted = false;
        this._fontDoneQueue = [];
        this._hoverSeg = -1;
        this._geom = {
            cx: 0,
            cy: 0,
            rOut: 0,
            rIn: 0,
            segs: []
        };

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
                'Awaiting data — H&M Channel Donut'
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
            var p1 = document.fonts.load('400 11px IBM Plex Sans');
            var p2 = document.fonts.load('600 32px IBM Plex Mono');
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

    _normAngle: function(t) {
        var twoPi = Math.PI * 2;
        while (t < 0) t += twoPi;
        while (t >= twoPi) t -= twoPi;
        return t;
    },

    _fitMono600: function(ctx, text, maxW, startSize, minSize) {
        var sz = startSize;
        var min = minSize || 12;
        while (sz >= min) {
            ctx.font = '600 ' + sz + 'px ' + theme.FONTS.mono;
            if (ctx.measureText(text).width <= maxW) return sz;
            sz -= 1;
        }
        return min;
    },

    _parseNumber: function(v) {
        if (v === null || v === undefined || v === '') return NaN;
        return parseFloat(v);
    },

    _mergeAndCapSegments: function(rows, colIdx, labelField, valueField) {
        var li = colIdx[labelField];
        var vi = colIdx[valueField];
        if (li === undefined || vi === undefined) {
            return [];
        }
        var map = {};
        var r;
        for (r = 0; r < rows.length; r++) {
            var row = rows[r];
            var rawL = row[li];
            var lab = rawL === null || rawL === undefined ? '' : String(rawL);
            var val = this._parseNumber(row[vi]);
            if (isNaN(val) || val <= 0) continue;
            if (!map[lab]) map[lab] = 0;
            map[lab] += val;
        }
        var pairs = [];
        for (var k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) {
                pairs.push({ label: k, value: map[k] });
            }
        }
        pairs.sort(function(a, b) { return b.value - a.value; });
        var maxSeg = 5;
        if (pairs.length <= maxSeg) {
            return pairs;
        }
        var otherSum = 0;
        var idx;
        for (idx = maxSeg - 1; idx < pairs.length; idx++) {
            otherSum += pairs[idx].value;
        }
        var head = [];
        for (var h = 0; h < maxSeg - 1; h++) {
            head.push(pairs[h]);
        }
        head.push({ label: 'Other', value: otherSum });
        return head;
    },

    _pickSegment: function(lx, ly) {
        var g = this._geom;
        var nHit = g.segs.length;
        if (nHit === 0) return -1;
        var dx = lx - g.cx;
        var dy = ly - g.cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < g.rIn - 1 || dist > g.rOut + 4) {
            return -1;
        }
        var phi = Math.atan2(dy, dx);
        var t = this._normAngle(phi + Math.PI / 2);
        var i;
        for (i = 0; i < nHit; i++) {
            var s = g.segs[i];
            var last = i === nHit - 1;
            if (last) {
                if (t + 1e-6 >= s.t0 && t <= s.t1 + 1e-6) return i;
            } else if (t + 1e-6 >= s.t0 && t < s.t1 - 1e-6) {
                return i;
            }
        }
        return -1;
    },

    _handleMouseMove: function(ev) {
        var rect = this.canvas.getBoundingClientRect();
        var mx = ev.clientX - rect.left;
        var my = ev.clientY - rect.top;
        var seg = this._pickSegment(mx, my);
        this.canvas.style.cursor = seg >= 0 ? 'pointer' : 'default';
        var compactTooltip = true;
        if (this._lastConfig) {
            compactTooltip = theme.parseBool(theme.getOption(this._lastConfig, theme.getNS(this), 'compactTotal', 'true'), true);
        }
        if (seg !== this._hoverSeg) {
            this._hoverSeg = seg;
            if (this._lastData && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }
        }
        if (seg >= 0 && this._geom.segs[seg]) {
            var s = this._geom.segs[seg];
            this._tooltip.style.display = 'block';
            var pct = s.pct !== undefined ? s.pct : 0;
            var valStr = theme.formatValue(s.value, -1, compactTooltip);
            this._tooltip.textContent = s.label + ': ' + valStr + ' (' + pct.toFixed(1) + '%)';
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
        this._hoverSeg = -1;
        this._tooltip.style.display = 'none';
        if (this._lastData && this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
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

        var labelField = theme.getOption(config, ns, 'labelField', 'channel');
        var valueField = theme.getOption(config, ns, 'valueField', 'value');
        var colorsRaw = theme.getOption(config, ns, 'colors', '#CC071E,#0F4B7D,#587E1F,#9A9A96,#ED6C02');
        var innerRat = theme.parseNum(theme.getOption(config, ns, 'innerRadius', '0.65'), 0.65);
        if (innerRat < 0.2) innerRat = 0.2;
        if (innerRat > 0.9) innerRat = 0.9;
        var showLegend = theme.parseBool(theme.getOption(config, ns, 'showLegend', 'true'), true);
        var showTotal = theme.parseBool(theme.getOption(config, ns, 'showTotal', 'true'), true);
        var compactTotal = theme.parseBool(theme.getOption(config, ns, 'compactTotal', 'true'), true);
        var accentIntensity = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '50'), 50);
        if (accentIntensity < 0) accentIntensity = 0;
        if (accentIntensity > 100) accentIntensity = 100;
        var brightenMix = (accentIntensity / 100) * 0.42;

        var fallbackPalette = [t.s1, t.s2, t.s3, t.s4, t.s5];
        var palette = theme.parseColors(colorsRaw, fallbackPalette);
        var otherMuted = '#9A9A96';

        var colIdx = data.colIdx;
        var rows = data.rows;

        var pad = Math.max(8, Math.min(w, h) * 0.04);
        var cardX = pad;
        var cardY = pad;
        var cardW = w - pad * 2;
        var cardH = h - pad * 2;
        if (cardW < 48 || cardH < 48) return;

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

        var cardPad = 16;
        var innerX = cardX + cardPad;
        var innerW = cardW - cardPad * 2;
        var innerTop = cardY + cardPad;
        var innerBot = cardY + cardH - cardPad;

        if (colIdx[labelField] === undefined || colIdx[valueField] === undefined) {
            ctx.font = '400 12px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            var miss = 'Missing columns';
            if (colIdx[labelField] === undefined) miss += ' — ' + labelField;
            if (colIdx[valueField] === undefined) miss += ' — ' + valueField;
            ctx.fillText(miss, innerX, innerTop);
            return;
        }

        var segments = this._mergeAndCapSegments(rows, colIdx, labelField, valueField);
        var n = segments.length;
        var total = 0;
        var s;
        for (s = 0; s < n; s++) {
            total += segments[s].value;
        }

        var legendH = showLegend ? (n * 18 + 10) : 8;
        var donutBandH = innerBot - innerTop - legendH;
        if (donutBandH < 56) donutBandH = Math.max(innerBot - innerTop - legendH, 56);

        var cx = innerX + innerW / 2;
        var cy = innerTop + donutBandH * 0.52;
        var rOut = Math.min(innerW, donutBandH) * 0.38;
        if (rOut < 10) rOut = 10;
        var rIn = rOut * innerRat;
        var gapPx = 2;
        var gapRad = gapPx / rOut;
        if (n === 0) gapRad = 0;

        this._geom.cx = cx;
        this._geom.cy = cy;
        this._geom.rOut = rOut;
        this._geom.rIn = rIn;
        this._geom.segs = [];

        if (n === 0 || total <= 0) {
            ctx.font = '400 13px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('No data', cx, cy);
            return;
        }

        var totalDataAngle = Math.PI * 2 - n * gapRad;
        var accT = gapRad / 2;
        var twoPi = Math.PI * 2;
        var firstCanvasStart = -Math.PI / 2 + gapRad / 2;
        var canvasAcc = firstCanvasStart;
        var k;
        for (k = 0; k < n; k++) {
            var seg = segments[k];
            var frac = seg.value / total;
            var sweep = frac * totalDataAngle;
            var t0 = accT;
            var t1 = accT + sweep;
            accT = t1 + gapRad;

            var isOther = seg.label === 'Other';
            var col = isOther ? otherMuted : palette[k % palette.length];
            var isHover = k === this._hoverSeg;
            if (isHover) {
                col = theme.lerpColor(col, '#FFFFFF', brightenMix);
            }

            var ro = isHover ? rOut + 4 : rOut;
            var canvasStart = canvasAcc;
            var canvasEnd = canvasAcc + sweep;
            canvasAcc = canvasEnd + gapRad;

            ctx.beginPath();
            ctx.arc(cx, cy, ro, canvasStart, canvasEnd, false);
            ctx.arc(cx, cy, rIn, canvasEnd, canvasStart, true);
            ctx.closePath();
            ctx.fillStyle = col;
            ctx.fill();
            theme.resetShadow(ctx);

            var pct100 = frac * 100;
            this._geom.segs.push({
                t0: t0,
                t1: t1,
                label: seg.label,
                value: seg.value,
                pct: pct100
            });
        }

        if (showTotal) {
            var totalStr = theme.formatValue(total, -1, compactTotal);
            var maxTW = innerW - 24;
            var startMono = Math.max(16, Math.min(40, Math.floor(rOut * 0.55)));
            var monoFit = this._fitMono600(ctx, totalStr, maxTW, startMono, 12);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '600 ' + monoFit + 'px ' + theme.FONTS.mono;
            ctx.fillStyle = t.text;
            ctx.fillText(totalStr, cx, cy - 7);
            theme.resetShadow(ctx);

            ctx.textBaseline = 'middle';
            ctx.font = '400 11px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.fillText('Total', cx, cy + Math.max(9, monoFit * 0.42));
            theme.resetShadow(ctx);
        }

        if (showLegend) {
            var legY = innerTop + donutBandH + 4;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            var fontLeg = '400 11px ' + theme.FONTS.ui;
            var row;
            for (row = 0; row < n; row++) {
                var sg = segments[row];
                var isO = sg.label === 'Other';
                var ccol = isO ? otherMuted : palette[row % palette.length];
                var dotX = innerX;
                var dotY = legY + row * 18;
                ctx.beginPath();
                ctx.arc(dotX + 3, dotY, 3, 0, twoPi);
                ctx.fillStyle = ccol;
                ctx.fill();
                theme.resetShadow(ctx);

                var pctx = sg.value / total * 100;
                var line = sg.label + '  ' + pctx.toFixed(1) + '%';
                ctx.font = fontLeg;
                ctx.fillStyle = t.text;
                ctx.fillText(line, innerX + 14, dotY);
                theme.resetShadow(ctx);
            }
        }
    }
});
