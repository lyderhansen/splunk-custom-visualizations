/*
 * HBO Max Viewing Area — ES5 filled area chart for viewing time trends.
 */
define([
    'api/SplunkVisualizationBase'
], function (SplunkVisualizationBase) {
    var theme = require('shared/theme');

    function getOption(config, ns, key, defaultValue) {
        var v = config[ns + key];
        if (v !== undefined && v !== null) return v;
        v = config[key];
        if (v !== undefined && v !== null) return v;
        return defaultValue;
    }

    function fieldIndex(fields, name) {
        var i;
        for (i = 0; i < fields.length; i++) {
            if (fields[i].name === name) return i;
        }
        return -1;
    }

    function parseNumber(v) {
        if (v === null || v === undefined || v === '') return NaN;
        return parseFloat(v);
    }

    function parseTimeMs(v) {
        if (v === null || v === undefined) return NaN;
        if (typeof v === 'number' && !isNaN(v)) return v < 1e12 ? v * 1000 : v;
        var s = String(v);
        var d = Date.parse(s);
        if (!isNaN(d)) return d;
        var n = parseFloat(s);
        if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;
        return NaN;
    }

    function niceYRange(minV, maxV) {
        if (!isFinite(minV) || !isFinite(maxV)) {
            return { min: 0, max: 10, step: 5 };
        }
        if (minV === maxV) {
            minV = minV - 1;
            maxV = maxV + 1;
        }
        var pad = (maxV - minV) * 0.08;
        var lo = minV - pad;
        var hi = maxV + pad;
        if (lo < 0 && minV >= 0) {
            lo = 0;
        }
        var range = hi - lo;
        var candidates = [5, 10, 50, 100, 500, 1000, 5000, 10000];
        var step = 100;
        var i;
        for (i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var ticks = range / c;
            if (ticks >= 3 && ticks <= 10) {
                step = c;
                break;
            }
            if (range <= c * 12) {
                step = c;
            }
        }
        var y0 = Math.floor(lo / step) * step;
        var y1 = Math.ceil(hi / step) * step;
        if (y1 <= y0) {
            y1 = y0 + step;
        }
        return { min: y0, max: y1, step: step };
    }

    function formatTimeLabel(ms, manyPoints) {
        var d = new Date(ms);
        if (isNaN(d.getTime())) return '';
        if (manyPoints) {
            return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
                (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
                (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
        }
        return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    }

    function extractSeries(data, timeField, valueField) {
        var fields = data.fields || [];
        var rows = data.rows || [];
        var ti = fieldIndex(fields, timeField);
        if (ti < 0 && fields.length > 0) {
            ti = 0;
            timeField = fields[0].name;
        }
        var vi = fieldIndex(fields, valueField);
        if (vi < 0) return { points: [], timeField: timeField, valueField: valueField };
        var pts = [];
        var r;
        for (r = 0; r < rows.length; r++) {
            var tms = parseTimeMs(rows[r][ti]);
            var val = parseNumber(rows[r][vi]);
            if (isNaN(tms) || isNaN(val)) continue;
            pts.push({ t: tms, v: val });
        }
        pts.sort(function (a, b) {
            return a.t - b.t;
        });
        return { points: pts, timeField: timeField, valueField: valueField };
    }

    return SplunkVisualizationBase.extend({
        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this._canvas = null;
            this._ctx = null;
            this._tooltip = null;
            this._wrap = null;
            this._layout = { w: 0, h: 0, dpr: 1 };
            this._hover = false;
            this._tipHtml = '';
            this._series = [];
            this._plot = { x: 0, y: 0, w: 0, h: 0 };
            this._nearest = -1;
        },

        reflow: function () {
            this.invalidateUpdateView();
        },

        _ensureUi: function (root) {
            if (this._canvas) return;
            this._wrap = document.createElement('div');
            this._wrap.style.position = 'relative';
            this._wrap.style.width = '100%';
            this._wrap.style.height = '100%';
            this._canvas = document.createElement('canvas');
            this._canvas.style.display = 'block';
            this._canvas.style.width = '100%';
            this._canvas.style.height = '100%';
            this._wrap.appendChild(this._canvas);
            root.appendChild(this._wrap);
            this._ctx = this._canvas.getContext('2d');

            this._tooltip = document.createElement('div');
            this._tooltip.setAttribute('role', 'tooltip');
            this._tooltip.style.cssText = [
                'position:absolute',
                'z-index:50',
                'pointer-events:none',
                'display:none',
                'max-width:320px',
                'padding:8px 10px',
                'border-radius:6px',
                'font:12px ' + theme.FONTS.ui.replace(/"/g, ''),
                'box-shadow:0 6px 24px rgba(0,0,0,0.35)',
                'white-space:pre-wrap'
            ].join(';');
            this._wrap.appendChild(this._tooltip);

            var self = this;
            this._canvas.addEventListener('mousemove', function (ev) {
                self._onMove(ev);
            });
            this._canvas.addEventListener('mouseleave', function () {
                self._hover = false;
                self._nearest = -1;
                if (self._tooltip) self._tooltip.style.display = 'none';
                self.invalidateUpdateView();
            });
        },

        _onMove: function (ev) {
            var rect = this._canvas.getBoundingClientRect();
            var mx = ev.clientX - rect.left;
            var my = ev.clientY - rect.top;
            var w = rect.width;
            var h = rect.height;
            var p = this._plot;
            this._hover = mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h;
            var series = this._series;
            var prev = this._nearest;
            this._nearest = -1;
            if (this._hover && series.length > 0) {
                var t0 = series[0].t;
                var t1 = series[series.length - 1].t;
                var span = t1 - t0 || 1;
                var fx = p.x + ((mx - p.x) / p.w) * span + t0;
                var best = 0;
                var bestD = Math.abs(series[0].t - fx);
                var i;
                for (i = 1; i < series.length; i++) {
                    var d = Math.abs(series[i].t - fx);
                    if (d < bestD) {
                        bestD = d;
                        best = i;
                    }
                }
                this._nearest = best;
            }
            if (this._tooltip) {
                this._tooltip.innerHTML = this._tipHtml;
                this._tooltip.style.display = this._hover && this._tipHtml ? 'block' : 'none';
                var tx = mx + 12;
                var ty = my + 12;
                if (tx + 220 > w) tx = mx - 220;
                if (ty + 80 > h) ty = my - 80;
                this._tooltip.style.left = Math.round(tx) + 'px';
                this._tooltip.style.top = Math.round(ty) + 'px';
            }
            if (prev !== this._nearest) {
                this.invalidateUpdateView();
            }
        },

        updateView: function (data, config) {
            var root = this.el;
            if (!root) return;
            this._ensureUi(root);

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var valueField = getOption(config, ns, 'valueField', 'viewing_hours');
            var areaColor = getOption(config, ns, 'areaColor', '#7B61FF');
            var showDotsStr = getOption(config, ns, 'showDots', 'false');
            var showDots = String(showDotsStr) === 'true' || showDotsStr === true;
            var showGridStr = getOption(config, ns, 'showGrid', 'true');
            var showGrid = String(showGridStr) !== 'false' && showGridStr !== false;
            var themeName = getOption(config, ns, 'theme', 'dark');
            var th = theme.getTheme(themeName === 'light' ? 'light' : 'dark');

            var pack = extractSeries(data, '_time', valueField);
            var pts = pack.points;
            this._series = pts;

            var cr = root.getBoundingClientRect();
            var cssW = Math.max(1, Math.floor(cr.width));
            var cssH = Math.max(1, Math.floor(cr.height));
            var dpr = window.devicePixelRatio || 1;
            if (this._layout.w !== cssW || this._layout.h !== cssH || this._layout.dpr !== dpr) {
                this._canvas.width = Math.floor(cssW * dpr);
                this._canvas.height = Math.floor(cssH * dpr);
                this._canvas.style.width = cssW + 'px';
                this._canvas.style.height = cssH + 'px';
                this._layout = { w: cssW, h: cssH, dpr: dpr };
            }

            this._tooltip.style.background = th.panelHi;
            this._tooltip.style.color = th.text;
            this._tooltip.style.border = '1px solid ' + th.edgeStrong;

            var ctx = this._ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            var padL = 60;
            var padR = 20;
            var padT = 20;
            var padB = 40;
            var chartX = padL;
            var chartY = padT;
            var chartW = Math.max(10, cssW - padL - padR);
            var chartH = Math.max(10, cssH - padT - padB);
            this._plot = { x: chartX, y: chartY, w: chartW, h: chartH };

            ctx.fillStyle = th.bg;
            ctx.fillRect(0, 0, cssW, cssH);

            var minV = Infinity;
            var maxV = -Infinity;
            var j;
            for (j = 0; j < pts.length; j++) {
                if (pts[j].v < minV) minV = pts[j].v;
                if (pts[j].v > maxV) maxV = pts[j].v;
            }
            var yb = niceYRange(minV, maxV);
            var yMin = yb.min;
            var yMax = yb.max;
            var ySpan = yMax - yMin || 1;

            if (showGrid) {
                theme.drawHGrid(ctx, th, chartX, chartY, chartW, chartH, 4);
            }

            var t0 = pts.length ? pts[0].t : 0;
            var t1 = pts.length > 1 ? pts[pts.length - 1].t : t0 + 1;
            var tSpan = t1 - t0 || 1;
            var manyPts = pts.length > 12;

            ctx.save();
            ctx.font = '11px ' + theme.FONTS.ui;
            ctx.fillStyle = th.textDim;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            var ticks = 5;
            var tk;
            for (tk = 0; tk <= ticks; tk++) {
                var yVal = yMax - (ySpan * tk) / ticks;
                var gy = chartY + (chartH * tk) / ticks;
                ctx.fillText(theme.fmtNum(yVal, { fixed: ySpan < 2 ? 2 : 0 }), chartX - 8, gy);
            }
            ctx.restore();

            if (pts.length >= 2) {
                var xAt = function (t) {
                    return chartX + ((t - t0) / tSpan) * chartW;
                };
                var yAt = function (v) {
                    return chartY + chartH - ((v - yMin) / ySpan) * chartH;
                };

                var grd = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
                grd.addColorStop(0, theme.withAlpha(areaColor, 0.25));
                grd.addColorStop(1, theme.withAlpha(areaColor, 0));

                ctx.beginPath();
                ctx.moveTo(xAt(pts[0].t), yAt(pts[0].v));
                var k;
                for (k = 1; k < pts.length; k++) {
                    ctx.lineTo(xAt(pts[k].t), yAt(pts[k].v));
                }
                ctx.lineTo(xAt(pts[pts.length - 1].t), chartY + chartH);
                ctx.lineTo(xAt(pts[0].t), chartY + chartH);
                ctx.closePath();
                ctx.fillStyle = grd;
                ctx.fill();

                ctx.beginPath();
                ctx.moveTo(xAt(pts[0].t), yAt(pts[0].v));
                for (k = 1; k < pts.length; k++) {
                    ctx.lineTo(xAt(pts[k].t), yAt(pts[k].v));
                }
                ctx.strokeStyle = areaColor;
                ctx.lineWidth = 2;
                ctx.stroke();

                if (showDots) {
                    ctx.fillStyle = areaColor;
                    for (k = 0; k < pts.length; k++) {
                        ctx.beginPath();
                        ctx.arc(xAt(pts[k].t), yAt(pts[k].v), 3, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }

                var ni = this._nearest;
                if (this._hover && ni >= 0 && ni < pts.length) {
                        var nx = xAt(pts[ni].t);
                        var ny = yAt(pts[ni].v);
                        ctx.save();
                        ctx.strokeStyle = theme.withAlpha(th.text, 0.35);
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath();
                        ctx.moveTo(nx, chartY);
                        ctx.lineTo(nx, chartY + chartH);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.fillStyle = areaColor;
                        ctx.strokeStyle = th.bg;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.arc(nx, ny, 5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                        ctx.restore();
                }

                var tipMs = pts[ni >= 0 ? ni : pts.length - 1].t;
                var tipV = pts[ni >= 0 ? ni : pts.length - 1].v;
                this._tipHtml = '<b>' + formatTimeLabel(tipMs, manyPts) + '</b><br/>' +
                    String(pack.valueField) + ': ' + theme.fmtNum(tipV, { fixed: 2 });
            } else {
                this._tipHtml = pts.length === 1 ?
                    (formatTimeLabel(pts[0].t, false) + '<br/>' +
                        String(pack.valueField) + ': ' + theme.fmtNum(pts[0].v, { fixed: 2 })) :
                    'No data';
            }

            ctx.save();
            ctx.font = '10px ' + theme.FONTS.ui;
            ctx.fillStyle = th.textFaint;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            var xl = Math.min(6, Math.max(1, Math.floor(pts.length / 4)));
            if (!manyPts) {
                xl = pts.length;
            }
            if (pts.length > 0) {
                var step = Math.max(1, Math.floor(pts.length / xl));
                var xi;
                for (xi = 0; xi < pts.length; xi += step) {
                    var px = chartX + ((pts[xi].t - t0) / tSpan) * chartW;
                    var lab = formatTimeLabel(pts[xi].t, manyPts);
                    ctx.save();
                    if (manyPts) {
                        ctx.translate(px, chartY + chartH + 6);
                        ctx.rotate(-Math.PI / 6);
                        ctx.textAlign = 'right';
                        ctx.fillText(lab, 0, 0);
                    } else {
                        ctx.fillText(lab, px, chartY + chartH + 6);
                    }
                    ctx.restore();
                }
            }
            ctx.restore();

            if (this._hover && this._tooltip) {
                this._tooltip.innerHTML = this._tipHtml;
            }
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 10000 };
        },

        formatData: function (data) {
            return data;
        }
    });
});
