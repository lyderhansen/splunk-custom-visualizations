/*
 * H&M Global Sales — Region Rank (horizontal bar leaderboard).
 * Scandinavian minimalism, light theme. ES5 only.
 *
 * Data: region (string), value (number), trend (number, optional YoY %).
 */
var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var theme = require('shared/theme');

module.exports = SplunkVisualizationBase.extend({

    initialize: function() {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.classList.add('hm-viz-region-rank');
        this.el.style.overflow = 'hidden';
        this.el.style.position = 'relative';

        var canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.cursor = 'default';
        this.el.appendChild(canvas);
        this.canvas = canvas;

        var tip = document.createElement('div');
        tip.className = 'hm-region-rank-tooltip';
        tip.style.display = 'none';
        tip.style.position = 'absolute';
        tip.style.pointerEvents = 'none';
        tip.style.zIndex = '50';
        tip.style.padding = '8px 12px';
        tip.style.borderRadius = '6px';
        tip.style.border = '1px solid rgba(26,26,26,0.08)';
        tip.style.backgroundColor = '#FFFFFF';
        tip.style.color = '#1A1A1A';
        tip.style.fontFamily = theme.FONTS.ui;
        tip.style.fontSize = '11px';
        tip.style.lineHeight = '1.35';
        tip.style.whiteSpace = 'pre-line';
        tip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
        this.el.appendChild(tip);
        this._tooltip = tip;

        this._lastData = null;
        this._lastConfig = null;
        this._lastGoodData = null;
        this._hitRects = [];
        this._hoverIndex = -1;
        this._fontsReady = false;
        this._ro = null;

        var self = this;
        this._onMove = function(ev) { self._handleMouseMove(ev); };
        this._onLeave = function() { self._handleMouseLeave(); };
        this.canvas.addEventListener('mousemove', this._onMove);
        this.canvas.addEventListener('mouseleave', this._onLeave);

        this._setupResizeObserver();
        this._primeFonts();
    },

    _setupResizeObserver: function() {
        var self = this;
        if (typeof ResizeObserver === 'undefined') return;
        this._ro = new ResizeObserver(function() {
            if (self._lastData && self._lastConfig) {
                self._render(self._lastData, self._lastConfig);
            }
        });
        this._ro.observe(this.el);
    },

    _primeFonts: function() {
        var self = this;
        function done() {
            self._fontsReady = true;
            if (self._lastData && self._lastConfig) {
                self._render(self._lastData, self._lastConfig);
            }
        }
        if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) {
            done();
            return;
        }
        var p1 = document.fonts.load('400 13px IBMPlexSans');
        var p2 = document.fonts.load('400 12px IBMPlexMono');
        if (typeof Promise !== 'undefined' && Promise.all) {
            Promise.all([p1, p2]).then(function() { done(); }, function() { done(); });
        } else {
            p1.then(function() { return p2; }).then(function() { done(); }, function() { done(); });
        }
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
                'Awaiting data — Region Rank'
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
        if (!this._fontsReady) return;
        this._render(data, config);
    },

    _handleMouseMove: function(ev) {
        var rect = this.canvas.getBoundingClientRect();
        var mx = ev.clientX - rect.left;
        var my = ev.clientY - rect.top;
        var idx = this._hitTest(mx, my);
        if (idx !== this._hoverIndex) {
            this._hoverIndex = idx;
            if (this._lastData && this._lastConfig && this._fontsReady) {
                this._render(this._lastData, this._lastConfig);
            }
        }
        if (idx >= 0 && this._hitRects[idx]) {
            var r = this._hitRects[idx];
            this._tooltip.style.display = 'block';
            this._tooltip.textContent = r.tooltipTitle + '\n' + r.tooltipValue;
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
        if (this._hoverIndex !== -1) {
            this._hoverIndex = -1;
            if (this._lastData && this._lastConfig && this._fontsReady) {
                this._render(this._lastData, this._lastConfig);
            }
        }
    },

    _hitTest: function(mx, my) {
        for (var i = 0; i < this._hitRects.length; i++) {
            var r = this._hitRects[i];
            if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
                return i;
            }
        }
        return -1;
    },

    _formatTrendText: function(trend, hasTrend) {
        if (!hasTrend || trend === null || trend === undefined || isNaN(trend)) return '';
        var sign = trend > 0 ? '+' : '';
        return sign + trend.toFixed(1) + '%';
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
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        theme.resetShadow(ctx);

        this._hitRects = [];

        var ns = theme.getNS(this);
        var t = theme.getTheme(theme.getOption(config, ns, 'theme', 'light'));
        var regionField = theme.getOption(config, ns, 'regionField', 'region');
        var valueField = theme.getOption(config, ns, 'valueField', 'value');
        var trendField = theme.getOption(config, ns, 'trendField', 'trend');
        var maxBars = parseInt(theme.getOption(config, ns, 'maxBars', '10'), 10);
        if (isNaN(maxBars) || maxBars < 1) maxBars = 10;
        var barColor = theme.getOption(config, ns, 'barColor', '#0F4B7D');
        var showTrend = theme.parseBool(theme.getOption(config, ns, 'showTrend', 'true'), true);
        var compactNumber = theme.parseBool(theme.getOption(config, ns, 'compactNumber', 'true'), true);
        var accentColor = theme.getOption(config, ns, 'accentColor', '#0F4B7D');
        var accentIntensity = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '50'), 50);
        var decimals = parseInt(theme.getOption(config, ns, 'decimals', '-1'), 10);
        var hoverAlpha = (accentIntensity / 100) * 0.12;
        if (hoverAlpha > 0.25) hoverAlpha = 0.25;
        if (hoverAlpha < 0.02) hoverAlpha = 0.02;

        var colIdx = data.colIdx;
        var rows = data.rows;
        if (colIdx[regionField] === undefined || colIdx[valueField] === undefined) {
            ctx.fillStyle = t.textDim;
            ctx.font = '400 12px ' + theme.FONTS.ui;
            ctx.fillText(
                'Missing columns: ' + regionField + ', ' + valueField,
                12,
                24
            );
            theme.resetShadow(ctx);
            return;
        }

        var ri = colIdx[regionField];
        var vi = colIdx[valueField];
        var ti = colIdx[trendField];
        var packed = [];
        for (var rr = 0; rr < rows.length; rr++) {
            var row = rows[rr];
            var reg = row[ri] !== null && row[ri] !== undefined ? String(row[ri]) : '';
            var val = parseFloat(row[vi]);
            if (isNaN(val)) val = 0;
            var tr = null;
            var hasTr = false;
            if (ti !== undefined && row[ti] !== null && row[ti] !== undefined && row[ti] !== '') {
                tr = parseFloat(row[ti]);
                if (!isNaN(tr)) hasTr = true;
            }
            packed.push({ region: reg, value: val, trend: tr, hasTrend: hasTr });
        }
        packed.sort(function(a, b) {
            return b.value - a.value;
        });
        var display = packed.slice(0, maxBars);
        if (display.length === 0) {
            theme.resetShadow(ctx);
            return;
        }

        var maxV = display[0].value;
        if (maxV <= 0) maxV = 1;

        var cardInset = 8;
        theme.drawPanel(ctx, t, cardInset, cardInset, w - cardInset * 2, h - cardInset * 2);
        theme.resetShadow(ctx);

        var pad = 15;
        var ix = cardInset + pad;
        var iy = cardInset + pad;
        var iw = w - (cardInset + pad) * 2;
        var ih = h - (cardInset + pad) * 2;

        var gap = 4;
        var n = display.length;
        var rowH = (ih - (n - 1) * gap) / n;

        ctx.font = '400 13px ' + theme.FONTS.ui;
        ctx.textBaseline = 'middle';

        var rightBlockW = 0;
        var k;
        ctx.font = '400 12px ' + theme.FONTS.mono;
        for (k = 0; k < display.length; k++) {
            var d0 = display[k];
            var vStr = theme.formatValue(d0.value, decimals, compactNumber);
            var combo = vStr;
            if (showTrend && d0.hasTrend) {
                combo = combo + '  ' + this._formatTrendText(d0.trend, d0.hasTrend);
            }
            var cw = ctx.measureText(combo).width;
            var arrowBudget = showTrend && d0.hasTrend ? 18 : 0;
            if (cw + arrowBudget > rightBlockW) rightBlockW = cw + arrowBudget;
        }
        rightBlockW += 6;

        var regionCap = Math.min(iw * 0.42, iw - rightBlockW - 24);
        if (regionCap < 72) regionCap = Math.max(52, iw * 0.28);

        var barGap = 8;
        var barLeft = ix + regionCap + barGap;
        var barRight = ix + iw - rightBlockW - barGap;
        var barTotalW = barRight - barLeft;
        if (barTotalW < 28) barTotalW = 28;

        for (var idx = 0; idx < display.length; idx++) {
            var item = display[idx];
            var rowTop = iy + idx * (rowH + gap);
            var frac = maxV <= 0 ? 0 : item.value / maxV;
            if (frac < 0) frac = 0;
            if (frac > 1) frac = 1;
            var fillW = barTotalW * frac;

            if (idx === this._hoverIndex) {
                ctx.fillStyle = theme.withAlpha(accentColor, hoverAlpha);
                ctx.fillRect(ix, rowTop, iw, rowH);
                theme.resetShadow(ctx);
            }

            var tooltipVal = theme.formatValue(item.value, decimals, compactNumber);
            var tooltipBody = tooltipVal;
            if (showTrend && item.hasTrend && !isNaN(item.trend)) {
                tooltipBody = tooltipBody + '  YoY ' + this._formatTrendText(item.trend, item.hasTrend);
            }
            this._hitRects.push({
                x: ix,
                y: rowTop,
                w: iw,
                h: rowH,
                tooltipTitle: item.region || '\u2014',
                tooltipValue: tooltipBody
            });

            var barH = rowH * 0.6;
            var barY = rowTop + (rowH - barH) / 2;

            if (fillW > 1) {
                theme.roundRect(ctx, barLeft, barY, fillW, barH, 3);
                var fillOpacity = idx === 0 ? 0.4 : 0.2;
                ctx.fillStyle = theme.withAlpha(barColor, fillOpacity);
                ctx.fill();
                theme.resetShadow(ctx);
            }

            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '400 13px ' + theme.FONTS.ui;
            ctx.fillStyle = t.text;
            var regText = item.region || '\u2014';
            var regFit = theme.fitText(ctx, regText, regionCap - 4, 13, 9, theme.FONTS.ui);
            ctx.font = '400 ' + regFit + 'px ' + theme.FONTS.ui;
            ctx.fillText(regText, ix, rowTop + rowH / 2);

            var valStr = theme.formatValue(item.value, decimals, compactNumber);

            var rowMid = rowTop + rowH / 2;
            var anchorRight = ix + iw;

            ctx.textBaseline = 'middle';
            ctx.textAlign = 'right';

            if (showTrend && item.hasTrend) {
                var trendStr = this._formatTrendText(item.trend, item.hasTrend);
                ctx.font = '400 11px ' + theme.FONTS.mono;
                if (item.trend > 0) {
                    ctx.fillStyle = t.success;
                } else if (item.trend < 0) {
                    ctx.fillStyle = t.danger;
                } else {
                    ctx.fillStyle = t.textDim;
                }
                ctx.fillText(trendStr, anchorRight, rowMid);

                anchorRight -= ctx.measureText(trendStr).width + 6;

                if (item.trend !== 0) {
                    var arrSize = 6;
                    var arrX = anchorRight - arrSize;
                    var arrDirection = item.trend > 0 ? 1 : -1;
                    theme.drawDelta(
                        ctx,
                        arrX,
                        rowMid - arrSize / 2,
                        arrSize,
                        arrDirection,
                        t.success,
                        t.danger
                    );
                    theme.resetShadow(ctx);
                    anchorRight -= arrSize + 4;
                } else {
                    anchorRight -= 2;
                }

                ctx.font = '400 12px ' + theme.FONTS.mono;
                ctx.fillStyle = t.text;
                ctx.fillText(valStr, anchorRight, rowMid);
            } else {
                ctx.font = '400 12px ' + theme.FONTS.mono;
                ctx.fillStyle = t.text;
                ctx.fillText(valStr, anchorRight, rowMid);
            }

            ctx.textAlign = 'left';
            theme.resetShadow(ctx);
        }

        theme.resetShadow(ctx);
    },

    reflow: function() {
        if (this._lastData && this._lastConfig && this._fontsReady) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    destroy: function() {
        if (this._ro) {
            this._ro.disconnect();
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
