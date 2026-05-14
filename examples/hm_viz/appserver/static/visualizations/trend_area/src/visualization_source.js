/*
 * H&M Global Sales — minimalist area trend (light-first, Scandinavian).
 * Data: _time + value; optional series for multiple traces.
 *
 * ES5 only — var, function, string concat. No const/let/arrow/template literals.
 */

var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var theme = require('shared/theme');

function niceStep(raw) {
    if (!isFinite(raw) || raw <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    if (norm <= 1) return mag;
    if (norm <= 2) return 2 * mag;
    if (norm <= 5) return 5 * mag;
    return 10 * mag;
}

function computeNiceY(minV, maxV) {
    if (!isFinite(minV) || !isFinite(maxV)) {
        return { min: 0, max: 1, step: 0.25 };
    }
    if (minV === maxV) {
        if (minV === 0) {
            maxV = 1;
        } else {
            var pad = Math.abs(minV) * 0.1;
            if (pad === 0) pad = 1;
            minV = minV - pad;
            maxV = maxV + pad;
        }
    }
    var range = maxV - minV;
    var step = niceStep(range / 4);
    var niceMin = Math.floor(minV / step) * step;
    var niceMax = Math.ceil(maxV / step) * step;
    if (niceMax <= niceMin) {
        niceMax = niceMin + step;
    }
    return { min: niceMin, max: niceMax, step: step };
}

function parseEpochMs(raw) {
    if (raw === null || raw === undefined) return NaN;
    if (typeof raw === 'number') {
        if (isNaN(raw)) return NaN;
        return raw < 1e11 ? raw * 1000 : raw;
    }
    var d = new Date(raw);
    return d.getTime();
}

var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatAxisTime(d, spanMs) {
    if (!d || isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = MONTH_SHORT[d.getMonth()];
    if (!isFinite(spanMs) || spanMs > 120 * 86400000) {
        return m + ' ' + y;
    }
    return m + ' ' + d.getDate();
}

function formatTooltipTime(d) {
    if (!d || isNaN(d.getTime())) return '';
    var mon = MONTH_SHORT[d.getMonth()];
    return mon + ' ' + d.getDate() + ', ' + d.getFullYear();
}

module.exports = SplunkVisualizationBase.extend({

    initialize: function() {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.style.overflow = 'hidden';
        this.el.style.position = 'relative';

        var canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.cursor = 'crosshair';
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
        tip.style.whiteSpace = 'pre';
        this.el.appendChild(tip);
        this._tooltip = tip;

        this._lastData = null;
        this._lastConfig = null;
        this._lastGoodData = null;
        this._fontsReady = false;
        this._fontLoadStarted = false;
        this._fontDoneQueue = [];
        this._hoverIdx = -1;
        this._plot = null;
        this._mouseX = -1;
        this._mouseY = -1;

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
                'Awaiting data — H&M Trend Area'
            );
        }

        var fields = data.fields;
        var colIdx = {};
        for (var i = 0; i < fields.length; i++) {
            colIdx[fields[i].name] = i;
        }

        var result = { colIdx: colIdx, rows: data.rows, fields: fields };
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
            var p1 = document.fonts.load('400 10px IBM Plex Sans');
            var p2 = document.fonts.load('400 13px IBM Plex Sans');
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
        this._mouseX = ev.clientX - rect.left;
        this._mouseY = ev.clientY - rect.top;
        if (this._lastData && this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    _handleMouseLeave: function() {
        this._mouseX = -1;
        this._mouseY = -1;
        this._hoverIdx = -1;
        if (this._tooltip) this._tooltip.style.display = 'none';
        if (this._lastData && this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    _buildSeriesModel: function(data, timeField, valueField, seriesField) {
        var colIdx = data.colIdx;
        var rows = data.rows;
        if (colIdx[timeField] === undefined) {
            return { error: 'Missing time column: ' + timeField };
        }
        if (colIdx[valueField] === undefined) {
            return { error: 'Missing value column: ' + valueField };
        }
        var ti = colIdx[timeField];
        var vi = colIdx[valueField];
        var si = colIdx[seriesField];
        var hasSeries = si !== undefined;

        var buckets = {};
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            var tMs = parseEpochMs(row[ti]);
            if (isNaN(tMs)) continue;
            var v = parseFloat(row[vi]);
            if (isNaN(v)) continue;
            var key = hasSeries ? String(row[si]) : '_';
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push({ t: tMs, v: v });
        }

        var names = Object.keys(buckets);
        if (names.length === 0) {
            return { error: 'No numeric points' };
        }

        var seriesList = [];
        for (var b = 0; b < names.length; b++) {
            var nm = names[b];
            var pts = buckets[nm];
            pts.sort(function(a, b) { return a.t - b.t; });
            seriesList.push({ name: nm === '_' ? '' : nm, points: pts });
        }

        seriesList.sort(function(a, b) { return a.name.localeCompare(b.name); });

        var tMin = Infinity;
        var tMax = -Infinity;
        var vMin = Infinity;
        var vMax = -Infinity;
        for (var s = 0; s < seriesList.length; s++) {
            var p = seriesList[s].points;
            for (var j = 0; j < p.length; j++) {
                if (p[j].t < tMin) tMin = p[j].t;
                if (p[j].t > tMax) tMax = p[j].t;
                if (p[j].v < vMin) vMin = p[j].v;
                if (p[j].v > vMax) vMax = p[j].v;
            }
        }
        if (!isFinite(tMin) || !isFinite(tMax) || tMin === tMax) {
            tMax = tMin + 1;
        }

        return {
            seriesList: seriesList,
            tMin: tMin,
            tMax: tMax,
            vMin: vMin,
            vMax: vMax
        };
    },

    _nearestIndex: function(plot, mouseX) {
        if (!plot || !plot.flat || plot.flat.length === 0) return -1;
        if (mouseX < plot.x || mouseX > plot.x + plot.w) return -1;
        var best = 0;
        var bestD = Infinity;
        for (var i = 0; i < plot.flat.length; i++) {
            var d = Math.abs(plot.flat[i].px - mouseX);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return best;
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

        var timeField = theme.getOption(config, ns, 'timeField', '_time');
        var valueField = theme.getOption(config, ns, 'valueField', 'value');
        var seriesField = theme.getOption(config, ns, 'seriesField', 'series');
        var lineColor = theme.getOption(config, ns, 'lineColor', '#0F4B7D');
        var fillOpacityStr = theme.getOption(config, ns, 'fillOpacity', '0.12');
        var fillOpacity = parseFloat(fillOpacityStr);
        if (isNaN(fillOpacity)) fillOpacity = 0.12;
        var showAxis = theme.parseBool(theme.getOption(config, ns, 'showAxis', 'true'), true);
        var showGrid = theme.parseBool(theme.getOption(config, ns, 'showGrid', 'true'), true);
        var accentColor = theme.getOption(config, ns, 'accentColor', '#0F4B7D');
        var accentIntensity = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '50'), 50);
        if (accentIntensity < 0) accentIntensity = 0;
        if (accentIntensity > 100) accentIntensity = 100;
        var intensityScale = accentIntensity / 50;
        if (intensityScale < 0.2) intensityScale = 0.2;
        if (intensityScale > 2) intensityScale = 2;

        var decimalsRaw = theme.getOption(config, ns, 'decimals', '-1');
        var decimals = parseInt(decimalsRaw, 10);
        if (isNaN(decimals)) decimals = -1;

        var model = this._buildSeriesModel(data, timeField, valueField, seriesField);
        if (model.error) {
            ctx.fillStyle = t.textDim;
            ctx.font = '12px ' + theme.FONTS.ui;
            ctx.fillText(model.error, 16, 28);
            theme.resetShadow(ctx);
            this._plot = null;
            return;
        }

        var nice = computeNiceY(model.vMin, model.vMax);
        var spanMs = model.tMax - model.tMin;

        var outer = 8;
        var cardX = outer;
        var cardY = outer;
        var cardW = w - outer * 2;
        var cardH = h - outer * 2;
        if (cardW < 80 || cardH < 80) return;

        var padL = 40;
        var padR = 15;
        var padT = 15;
        var padB = 30;
        var plotX = cardX + padL;
        var plotY = cardY + padT;
        var plotW = cardW - padL - padR;
        var plotH = cardH - padT - padB;
        if (plotW < 20 || plotH < 20) return;

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

        function xScale(tm) {
            return plotX + ((tm - model.tMin) / (model.tMax - model.tMin)) * plotW;
        }

        function yScale(val) {
            return plotY + plotH - ((val - nice.min) / (nice.max - nice.min)) * plotH;
        }

        ctx.save();
        theme.roundRect(ctx, cardX, cardY, cardW, cardH, 8);
        ctx.clip();

        if (showGrid) {
            theme.drawHGrid(ctx, t, plotX, plotY, plotW, plotH, 4);
            theme.resetShadow(ctx);
        }

        var palette = [accentColor, lineColor, t.s2, t.s3, t.s1, t.s5];
        var flat = [];

        for (var sIdx = 0; sIdx < model.seriesList.length; sIdx++) {
            var S = model.seriesList[sIdx];
            var pts = S.points;
            if (pts.length < 2) continue;

            var strokeCol = model.seriesList.length === 1 ? lineColor : palette[sIdx % palette.length];
            var fillTopCol = model.seriesList.length === 1 ? accentColor : strokeCol;
            var peakAlpha = fillOpacity * intensityScale;
            if (peakAlpha > 1) peakAlpha = 1;
            if (peakAlpha < 0.02) peakAlpha = 0.02;

            var g = ctx.createLinearGradient(plotX, plotY, plotX, plotY + plotH);
            g.addColorStop(0, theme.withAlpha(fillTopCol, peakAlpha));
            g.addColorStop(1, theme.withAlpha(fillTopCol, 0));

            ctx.beginPath();
            var firstX = xScale(pts[0].t);
            var firstY = yScale(pts[0].v);
            ctx.moveTo(firstX, firstY);
            for (var p = 1; p < pts.length; p++) {
                ctx.lineTo(xScale(pts[p].t), yScale(pts[p].v));
            }
            var lastX = xScale(pts[pts.length - 1].t);
            var baseY = plotY + plotH;
            ctx.lineTo(lastX, baseY);
            ctx.lineTo(firstX, baseY);
            ctx.closePath();
            ctx.fillStyle = g;
            ctx.fill();
            theme.resetShadow(ctx);

            ctx.beginPath();
            ctx.moveTo(firstX, firstY);
            for (var p2 = 1; p2 < pts.length; p2++) {
                ctx.lineTo(xScale(pts[p2].t), yScale(pts[p2].v));
            }
            ctx.strokeStyle = strokeCol;
            ctx.lineWidth = 1.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
            theme.resetShadow(ctx);

            for (var p3 = 0; p3 < pts.length; p3++) {
                var pxv = xScale(pts[p3].t);
                var pyv = yScale(pts[p3].v);
                flat.push({
                    px: pxv,
                    py: pyv,
                    t: pts[p3].t,
                    v: pts[p3].v,
                    series: S.name,
                    strokeCol: strokeCol
                });
            }

        }

        ctx.restore();
        theme.resetShadow(ctx);

        if (showAxis) {
            ctx.save();
            ctx.font = '400 10px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            var tickTarget = 5;
            for (var tk = 0; tk < tickTarget; tk++) {
                var ratio = tickTarget <= 1 ? 0 : tk / (tickTarget - 1);
                var tms = model.tMin + ratio * (model.tMax - model.tMin);
                var xd = Math.round(xScale(tms)) + 0.5;
                var lab = formatAxisTime(new Date(tms), spanMs);
                ctx.fillText(lab, xd, plotY + plotH + 6);
            }
            ctx.restore();
            theme.resetShadow(ctx);
        }

        var plot = { x: plotX, y: plotY, w: plotW, h: plotH, flat: flat };
        this._plot = plot;

        var mx = this._mouseX;
        var my = this._mouseY;
        var hov = -1;
        if (mx >= 0 && my >= 0) {
            hov = this._nearestIndex(plot, mx);
        }
        this._hoverIdx = hov;

        if (hov >= 0 && flat.length > 0) {
            var pt = flat[hov];
            var cx = pt.px;
            var cy = pt.py;

            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(26,26,26,0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.round(cx) + 0.5, plotY);
            ctx.lineTo(Math.round(cx) + 0.5, plotY + plotH);
            ctx.stroke();
            ctx.setLineDash([]);
            theme.resetShadow(ctx);

            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = pt.strokeCol;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
            theme.resetShadow(ctx);

            ctx.save();
            ctx.font = '400 10px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            var yLabel = decimals >= 0
                ? theme.formatValue(pt.v, decimals, false)
                : theme.fmtNum(pt.v, {});
            ctx.fillText(yLabel, cardX + cardW - 10, cy);
            ctx.restore();
            theme.resetShadow(ctx);

            var tipLines = formatTooltipTime(new Date(pt.t));
            if (pt.series) {
                tipLines = tipLines + '\n' + pt.series;
            }
            tipLines = tipLines + '\n' +
                (decimals >= 0 ? theme.formatValue(pt.v, decimals, false) : theme.fmtNum(pt.v, {}));
            this._tooltip.textContent = tipLines;
            this._tooltip.style.display = 'block';
            var tipX = mx + 14;
            var tipY = my - 10;
            var tw = this._tooltip.offsetWidth;
            var th = this._tooltip.offsetHeight;
            if (tipX + tw > w - 4) tipX = mx - tw - 10;
            if (tipY + th > h - 4) tipY = h - th - 4;
            if (tipY < 4) tipY = 4;
            if (tipX < 4) tipX = 4;
            this._tooltip.style.left = tipX + 'px';
            this._tooltip.style.top = tipY + 'px';
        } else if (this._tooltip) {
            this._tooltip.style.display = 'none';
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
