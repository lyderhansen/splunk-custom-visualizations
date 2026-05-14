define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var T = require('shared/theme');

    function parseEpochMs(raw) {
        if (raw === null || raw === undefined) return NaN;
        if (typeof raw === 'number') {
            if (isNaN(raw)) return NaN;
            return raw < 1e11 ? raw * 1000 : raw;
        }
        var d = new Date(raw);
        var ms = d.getTime();
        return isNaN(ms) ? NaN : ms;
    }

    function extractPoints(rows, colIdx, timeField, valueField) {
        var ti = colIdx[timeField];
        var vi = colIdx[valueField];
        if (ti === undefined || vi === undefined) {
            return [];
        }
        var out = [];
        var r;
        for (r = 0; r < rows.length; r++) {
            var row = rows[r];
            var tMs = parseEpochMs(row[ti]);
            var v = parseFloat(row[vi]);
            if (isNaN(tMs) || isNaN(v)) continue;
            out.push({ time: tMs, value: v });
        }
        out.sort(function(a, b) { return a.time - b.time; });
        return out;
    }

    function drawVignette(ctx, w, h) {
        var r = Math.max(w, h) * 0.55;
        var g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.15, w * 0.5, h * 0.5, r);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.65, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.42)');
        ctx.save();
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }

    function appendSmoothTop(ctx, xs, ys) {
        var n = xs.length;
        if (n < 2) return;
        var i;
        for (i = 0; i < n - 1; i++) {
            var x0 = xs[i];
            var y0 = ys[i];
            var x1 = xs[i + 1];
            var y1 = ys[i + 1];
            var cx = (x0 + x1) * 0.5;
            var cy = (y0 + y1) * 0.5;
            ctx.quadraticCurveTo(x0, y0, cx, cy);
        }
        ctx.lineTo(xs[n - 1], ys[n - 1]);
    }

    function formatAxisTime(d) {
        if (!d || isNaN(d.getTime())) return '';
        try {
            return d.toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return String(d);
        }
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';
            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this._mouseX = -1;
            this._hoverIdx = -1;
            this._hit = null;
            this.setupView();
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 500
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError('Awaiting data — Energy Consumption');
            }
            var fields = data.fields;
            var colIdx = {};
            var i;
            for (i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }
            var result = { fields: fields, rows: data.rows, colIdx: colIdx };
            this._lastGoodData = result;
            return result;
        },

        setupView: function() {
            if (this.canvas) {
                return;
            }
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            canvas.style.cursor = 'crosshair';
            this.el.appendChild(canvas);
            this.canvas = canvas;
            var self = this;
            canvas.addEventListener('mousemove', function(ev) {
                var el = self.el;
                var w = el.offsetWidth;
                var rect = canvas.getBoundingClientRect();
                if (rect.width <= 0) return;
                self._mouseX = (ev.clientX - rect.left) * (w / rect.width);
                self._nearestHover();
                self.invalidateUpdateView();
            });
            canvas.addEventListener('mouseleave', function() {
                self._mouseX = -1;
                self._hoverIdx = -1;
                self.invalidateUpdateView();
            });
            T.loadFonts(function() {
                self.invalidateUpdateView();
            });
        },

        _nearestHover: function() {
            this._hoverIdx = -1;
            var hit = this._hit;
            if (!hit || !hit.xs || hit.xs.length === 0 || this._mouseX < 0) {
                return;
            }
            var mx = this._mouseX;
            var best = -1;
            var bestD = Infinity;
            var j;
            for (j = 0; j < hit.xs.length; j++) {
                var d = Math.abs(hit.xs[j] - mx);
                if (d < bestD) {
                    bestD = d;
                    best = j;
                }
            }
            this._hoverIdx = best;
        },

        updateView: function(data, config) {
            if (SplunkVisualizationUtils) {
                /* externals reference */
            }
            if (!data || !data.rows) return;
            this._lastData = data;
            this._lastConfig = config;
            this._render(data, config);
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        _render: function(data, config) {
            var el = this.el;
            var canvas = this.canvas;
            if (!canvas) return;

            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            var ns = T.getNS(this);
            var t = T.getTheme('dark');
            var timeField = T.getOption(config, ns, 'timeField', '_time');
            var valueField = T.getOption(config, ns, 'valueField', 'value');
            var titleText = T.getOption(config, ns, 'title', 'Energy Consumption');
            var unitStr = T.getOption(config, ns, 'unit', 'kWh/100km');
            var fillColor = T.getOption(config, ns, 'fillColor', '#00C9A7');
            var lineColor = T.getOption(config, ns, 'lineColor', '#00C9A7');
            var gridDivisions = parseInt(T.getOption(config, ns, 'gridDivisions', '4'), 10);
            if (isNaN(gridDivisions) || gridDivisions < 1) gridDivisions = 4;

            var vfUser = parseInt(T.getOption(config, ns, 'valueFontSize', '0'), 10);
            var lfUser = parseInt(T.getOption(config, ns, 'labelFontSize', '0'), 10);
            var accentIntensity = parseFloat(T.getOption(config, ns, 'accentIntensity', '0.7'));
            if (isNaN(accentIntensity)) accentIntensity = 0.7;
            if (accentIntensity < 0) accentIntensity = 0;
            if (accentIntensity > 1) accentIntensity = 1;

            var minDim = Math.min(w, h);
            var labelPx = lfUser > 0 ? lfUser : Math.max(9, Math.min(14, minDim * 0.032));
            var titlePx = lfUser > 0 ? Math.round(lfUser * 1.15) : Math.max(11, Math.min(18, minDim * 0.045));
            var tipPx = vfUser > 0 ? vfUser : Math.max(10, Math.min(16, minDim * 0.028));

            var points = extractPoints(data.rows, data.colIdx, timeField, valueField);

            var outerPad = Math.max(8, minDim * 0.04);
            var rCard = Math.max(10, minDim * 0.03);

            T.drawGlassPanel(ctx, t, outerPad, outerPad, w - 2 * outerPad, h - 2 * outerPad, rCard);

            if (!points || points.length === 0) {
                ctx.save();
                ctx.font = '500 ' + labelPx + 'px ' + T.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('No data for ' + valueField + ' / ' + timeField, w * 0.5, h * 0.5);
                ctx.restore();
                drawVignette(ctx, w, h);
                this._hit = null;
                return;
            }

            var p;
            var tMin = points[0].time;
            var tMax = points[points.length - 1].time;
            var vMin = points[0].value;
            var vMax = points[0].value;
            for (p = 1; p < points.length; p++) {
                if (points[p].value < vMin) vMin = points[p].value;
                if (points[p].value > vMax) vMax = points[p].value;
            }
            if (vMax - vMin < 1e-9) {
                vMin = vMin - 1;
                vMax = vMax + 1;
            }

            var gap = Math.max(4, minDim * 0.02);
            var maxYLabel = '';
            var gy;
            for (gy = 0; gy <= gridDivisions; gy++) {
                var gv = vMax - (gy / gridDivisions) * (vMax - vMin);
                var yTickStr = T.fmtNum(gv, { decimals: 2 });
                if (yTickStr.length > maxYLabel.length) maxYLabel = yTickStr;
            }
            ctx.save();
            ctx.font = '400 ' + labelPx + 'px ' + T.FONTS.mono;
            var leftAxisW = ctx.measureText(maxYLabel).width + gap * 1.2;
            ctx.restore();
            leftAxisW = Math.max(leftAxisW, minDim * 0.1);

            var bottomH = Math.max(labelPx * 1.6, minDim * 0.065);
            var titleBlock = titlePx + gap * 0.6;

            var plotX = outerPad + leftAxisW;
            var plotY = outerPad + titleBlock;
            var plotW = w - plotX - outerPad;
            var plotH = h - plotY - bottomH - outerPad;
            if (plotW < 20 || plotH < 20) return;

            var plotBottom = plotY + plotH;

            ctx.save();
            ctx.font = '600 ' + titlePx + 'px ' + T.FONTS.ui;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(titleText, outerPad + gap * 0.4, outerPad + gap * 0.25);
            ctx.restore();

            T.drawHGrid(ctx, t, plotX, plotY, plotW, plotH, gridDivisions);

            var xs = [];
            var ys = [];
            var spanT = tMax - tMin;
            if (spanT <= 0) spanT = 1;
            var spanV = vMax - vMin;

            for (p = 0; p < points.length; p++) {
                var px = plotX + ((points[p].time - tMin) / spanT) * plotW;
                var py = plotY + ((vMax - points[p].value) / spanV) * plotH;
                xs.push(px);
                ys.push(py);
            }

            this._hit = { xs: xs, points: points, plotX: plotX, plotY: plotY, plotW: plotW, plotH: plotH };

            if (this._mouseX >= 0) {
                this._nearestHover();
            }

            var fillAlphaTop = 0.35 * accentIntensity;
            var gFill = ctx.createLinearGradient(0, plotY, 0, plotBottom);
            gFill.addColorStop(0, T.withAlpha(fillColor, fillAlphaTop));
            gFill.addColorStop(1, T.withAlpha(fillColor, 0));

            ctx.beginPath();
            if (points.length === 1) {
                var hw = Math.max(3, plotW * 0.04);
                ctx.moveTo(xs[0] - hw, plotBottom);
                ctx.lineTo(xs[0] - hw, ys[0]);
                ctx.lineTo(xs[0] + hw, ys[0]);
                ctx.lineTo(xs[0] + hw, plotBottom);
            } else {
                ctx.moveTo(xs[0], plotBottom);
                ctx.lineTo(xs[0], ys[0]);
                appendSmoothTop(ctx, xs, ys);
                ctx.lineTo(xs[points.length - 1], plotBottom);
            }
            ctx.closePath();
            ctx.fillStyle = gFill;
            ctx.fill();

            ctx.beginPath();
            if (points.length === 1) {
                ctx.moveTo(xs[0], ys[0]);
            } else {
                ctx.moveTo(xs[0], ys[0]);
                appendSmoothTop(ctx, xs, ys);
            }
            T.resetShadow(ctx);
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.shadowColor = lineColor;
            ctx.shadowBlur = 6;
            ctx.stroke();
            T.resetShadow(ctx);

            ctx.save();
            ctx.fillStyle = lineColor;
            var pr;
            for (pr = 0; pr < xs.length; pr++) {
                ctx.beginPath();
                ctx.arc(xs[pr], ys[pr], 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            ctx.save();
            ctx.font = '400 ' + labelPx + 'px ' + T.FONTS.mono;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (gy = 0; gy <= gridDivisions; gy++) {
                var gvy = vMax - (gy / gridDivisions) * (vMax - vMin);
                var gyPx = plotY + (gy / gridDivisions) * plotH;
                ctx.fillText(T.fmtNum(gvy, { decimals: 2 }), plotX - gap * 0.45, gyPx);
            }
            ctx.restore();

            ctx.save();
            ctx.font = '400 ' + labelPx + 'px ' + T.FONTS.mono;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            var t0 = formatAxisTime(new Date(points[0].time));
            var t1 = formatAxisTime(new Date(points[points.length - 1].time));
            ctx.fillText(t0, plotX, plotBottom + gap * 0.35);
            ctx.textAlign = 'right';
            ctx.fillText(t1, plotX + plotW, plotBottom + gap * 0.35);
            ctx.restore();

            drawVignette(ctx, w, h);

            var hi = this._hoverIdx;
            if (hi >= 0 && hi < xs.length) {
                ctx.save();
                ctx.strokeStyle = T.withAlpha(lineColor, 0.5);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(xs[hi], plotY);
                ctx.lineTo(xs[hi], plotBottom);
                ctx.stroke();
                ctx.restore();

                var hv = points[hi].value;
                var ht = new Date(points[hi].time);
                var line1 = T.fmtNum(hv, { decimals: 2 }) + ' ' + unitStr;
                var line2 = formatAxisTime(ht);

                ctx.save();
                ctx.font = '600 ' + tipPx + 'px ' + T.FONTS.mono;
                var tw1 = ctx.measureText(line1).width;
                ctx.font = '400 ' + Math.max(9, tipPx - 1) + 'px ' + T.FONTS.ui;
                var tw2 = ctx.measureText(line2).width;
                var tw = tw1 > tw2 ? tw1 : tw2;
                var th = tipPx * 2 + 14;
                var tx = xs[hi] + 10;
                var ty = ys[hi] - th - 10;
                if (tx + tw + 20 > w - outerPad) tx = xs[hi] - tw - 28;
                if (ty < plotY) ty = ys[hi] + 12;
                if (tx < outerPad) tx = outerPad;
                T.roundRect(ctx, tx, ty, tw + 16, th, 6);
                ctx.fillStyle = T.withAlpha(t.panel, 0.92);
                ctx.fill();
                ctx.strokeStyle = t.edgeStrong;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.font = '600 ' + tipPx + 'px ' + T.FONTS.mono;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(line1, tx + 8, ty + 8);
                ctx.font = '400 ' + Math.max(9, tipPx - 1) + 'px ' + T.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.fillText(line2, tx + 8, ty + 8 + tipPx + 4);
                ctx.restore();
            }
        }
    });
});
