/*
 * Netflix Content Rank — top title/value leaderboard with neon bars.
 * Multi-row SPL: configurable titleField + valueField columns.
 */
define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('shared/theme');

    /* gradient dark end derived per-accent in _render */

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
        } catch (e2) {}
        return '';
    }

    function clamp(n, lo, hi) {
        if (n < lo) return lo;
        if (n > hi) return hi;
        return n;
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
            tip.setAttribute('class', 'netflix-content-rank-tooltip');
            tip.style.display = 'none';
            tip.style.position = 'absolute';
            tip.style.pointerEvents = 'none';
            tip.style.zIndex = '50';
            tip.style.padding = '6px 10px';
            tip.style.borderRadius = '6px';
            tip.style.border = '1px solid rgba(229,9,20,0.45)';
            tip.style.backgroundColor = '#141418';
            tip.style.color = '#F5E6D3';
            tip.style.fontFamily = '"SF Mono", Menlo, Consolas, monospace';
            tip.style.fontSize = '11px';
            tip.style.lineHeight = '1.35';
            tip.style.whiteSpace = 'pre-line';
            tip.style.boxShadow = '0 0 12px rgba(229,9,20,0.35)';
            this.el.appendChild(tip);
            this._tooltip = tip;

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this._hitRects = [];
            this._hoverIndex = -1;

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
                    'Awaiting data — Netflix Content Rank'
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

        _handleMouseMove: function(ev) {
            var rect = this.canvas.getBoundingClientRect();
            var mx = ev.clientX - rect.left;
            var my = ev.clientY - rect.top;
            var idx = this._hitTest(mx, my);
            if (idx !== this._hoverIndex) {
                this._hoverIndex = idx;
                if (this._lastData && this._lastConfig) {
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
                if (this._lastData && this._lastConfig) {
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

        _formatValue: function(num, decimals, unit) {
            var s;
            if (isNaN(num)) {
                s = '\u2014';
            } else if (decimals >= 0) {
                s = num.toFixed(decimals);
            } else {
                s = theme.fmtNum(num, { compact: true });
            }
            if (unit && !isNaN(num)) {
                s = s + unit;
            }
            return s;
        },

        _rankBadgeFill: function(rank) {
            if (rank === 1) return '#FFD700';
            if (rank === 2) return '#C0C0C0';
            if (rank === 3) return '#CD7F32';
            return 'rgba(245,230,211,0.15)';
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

            this._hitRects = [];

            var ns = getNS(this);
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));
            var titleField = getOption(config, ns, 'titleField', 'title');
            var valueField = getOption(config, ns, 'valueField', 'views');
            var maxRows = parseInt(getOption(config, ns, 'maxRows', '10'), 10);
            if (isNaN(maxRows) || maxRows < 1) maxRows = 10;
            var unit = getOption(config, ns, 'unit', '');
            var decimals = parseInt(getOption(config, ns, 'decimals', '-1'), 10);
            var accentColor = getOption(config, ns, 'accentColor', t.accent);

            var colIdx = data.colIdx;
            var rows = data.rows;
            if (colIdx[titleField] === undefined || colIdx[valueField] === undefined) {
                ctx.fillStyle = t.textDim;
                ctx.font = '12px ' + theme.FONTS.ui;
                ctx.fillText('Missing columns: ' + titleField + ', ' + valueField, 12, 24);
                return;
            }

            var ti = colIdx[titleField];
            var vi = colIdx[valueField];
            var packed = [];
            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];
                var tit = row[ti] !== null && row[ti] !== undefined ? String(row[ti]) : '';
                var val = parseFloat(row[vi]);
                if (isNaN(val)) val = 0;
                packed.push({ title: tit, value: val });
            }
            packed.sort(function(a, b) {
                return b.value - a.value;
            });
            var display = packed.slice(0, maxRows);
            if (display.length === 0) return;

            var maxV = display[0].value;
            if (maxV <= 0) maxV = 1;

            ctx.fillStyle = t.bg;
            ctx.fillRect(0, 0, w, h);

            var outerPad = Math.max(6, Math.min(w, h) * 0.02);
            theme.drawPanel(ctx, t, outerPad, outerPad, w - outerPad * 2, h - outerPad * 2);

            var innerX = outerPad + 10;
            var innerY = outerPad + 10;
            var innerW = w - outerPad * 2 - 20;
            var innerH = h - outerPad * 2 - 20;

            var rowH = innerH / display.length;
            var gap = Math.max(2, rowH * 0.08);
            var rowInner = rowH - gap;

            var valueColW = 0;
            ctx.font = 'bold ' + Math.max(10, Math.min(16, rowInner * 0.38)) + 'px ' + theme.FONTS.mono;
            for (var m = 0; m < display.length; m++) {
                var vs = this._formatValue(display[m].value, decimals, unit);
                var tw = ctx.measureText(vs).width;
                if (tw > valueColW) valueColW = tw;
            }
            valueColW += 8;

            var rankW = Math.max(26, Math.min(34, rowInner * 0.95));

            for (var idx = 0; idx < display.length; idx++) {
                var item = display[idx];
                var rank = idx + 1;
                var y = innerY + idx * rowH + gap / 2;
                var rowTop = innerY + idx * rowH;
                var rowHt = rowH;

                if (idx === this._hoverIndex) {
                    ctx.fillStyle = theme.withAlpha(t.accent, 0.08);
                    ctx.fillRect(innerX - 6, rowTop, innerW + 12, rowHt);
                }

                var titleFont = Math.max(9, Math.min(15, rowInner * 0.36));
                var valStr = this._formatValue(item.value, decimals, unit);

                var titleMaxW = innerW - rankW - valueColW - 16 - 8;
                if (titleMaxW < 40) titleMaxW = 40;
                var barStart = innerX + rankW + 8 + titleMaxW + 8;
                var barW = innerX + innerW - barStart - valueColW;
                if (barW < 20) barW = 20;

                this._hitRects.push({
                    x: innerX - 6,
                    y: rowTop,
                    w: innerW + 12,
                    h: rowHt,
                    tooltipTitle: item.title || '\u2014',
                    tooltipValue: valStr
                });

                var bx = innerX;
                var by = y + rowInner * 0.1;
                var bw = rankW;
                var bh = rowInner * 0.8;
                var badgeFill = this._rankBadgeFill(rank);
                theme.roundRect(ctx, bx, by, bw, bh, 6);
                ctx.fillStyle = badgeFill;
                ctx.fill();
                ctx.strokeStyle = theme.withAlpha(accentColor, 0.35);
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.font = 'bold ' + Math.max(10, bh * 0.45) + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = rank <= 3 ? '#0A0A0F' : t.text;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(rank), bx + bw / 2, by + bh / 2);

                var tx = innerX + rankW + 8;
                var tyMid = y + rowInner / 2;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.font = titleFont + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.text;
                var titleText = item.title || '\u2014';
                var fitted = theme.fitText(ctx, titleText, titleMaxW, titleFont, 8, theme.FONTS.ui);
                ctx.font = fitted + 'px ' + theme.FONTS.ui;
                ctx.fillText(titleText, tx, tyMid);

                var frac = clamp(item.value / maxV, 0, 1);
                var fillW = barW * frac;

                if (fillW > 1) {
                    theme.roundRect(ctx, barStart, y + rowInner * 0.2, fillW, rowInner * 0.6, 4);
                    var grad = ctx.createLinearGradient(barStart, 0, barStart + fillW, 0);
                    grad.addColorStop(0, theme.withAlpha(accentColor, 0.25));
                    grad.addColorStop(1, accentColor);
                    if (rank === 1) {
                        ctx.save();
                        ctx.shadowColor = accentColor;
                        ctx.shadowBlur = 12;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                        ctx.fillStyle = grad;
                        ctx.fill();
                        ctx.restore();
                        ctx.shadowBlur = 0;
                        ctx.shadowColor = 'transparent';
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                    } else {
                        ctx.fillStyle = grad;
                        ctx.fill();
                    }
                }

                theme.roundRect(ctx, barStart, y + rowInner * 0.2, barW, rowInner * 0.6, 4);
                ctx.strokeStyle = theme.withAlpha(t.text, 0.08);
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.font = 'bold ' + Math.max(10, Math.min(16, rowInner * 0.38)) + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'right';
                ctx.fillText(valStr, innerX + innerW, tyMid);
            }
        },

        reflow: function() {
            if (this._lastData && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
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
});
