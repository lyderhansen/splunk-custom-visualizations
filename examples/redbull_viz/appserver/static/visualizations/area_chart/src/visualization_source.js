/*
 * Red Bull Racing Telemetry Chart — F1 Timing Screen
 *
 * Flat-fill area chart with no glow/gradient, sharp grid lines,
 * sector-colored series, crosshair on hover. Feels like F1 TV
 * timing overlay or pit wall telemetry trace.
 *
 * Expected SPL: | timechart span=... metric1 metric2 ...
 * First column = _time/labels, remaining = series values.
 */
define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('../../shared/theme');

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
        } catch (e) {}
        return '';
    }

    function abbreviate(val) {
        if (val >= 1e9) return (val / 1e9).toFixed(1) + 'B';
        if (val >= 1e6) return (val / 1e6).toFixed(0) + 'M';
        if (val >= 1e3) return (val / 1e3).toFixed(0) + 'k';
        return Math.round(val).toString();
    }

    var F1_COLORS = ['#DC0000', '#1E3A6E', '#FFC906', '#46D369', '#FF6B35'];

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            this.el.style.cursor = 'crosshair';
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            this._tooltip = document.createElement('div');
            this._tooltip.style.cssText = 'position:absolute;display:none;padding:8px 12px;border-radius:2px;font:11px ' + theme.FONTS.data + ';pointer-events:none;z-index:9999;white-space:pre;';
            this.el.appendChild(this._tooltip);

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this._mouseX = -1;
            this._chartBounds = null;
            this._points = null;

            var self = this;
            this.el.addEventListener('mousemove', function(e) { self._onMouse(e); });
            this.el.addEventListener('mouseleave', function() {
                self._mouseX = -1;
                self._tooltip.style.display = 'none';
                if (self._lastConfig) self._render(self._lastData, self._lastConfig);
            });
        },

        _onMouse: function(e) {
            var rect = this.el.getBoundingClientRect();
            this._mouseX = e.clientX - rect.left;
            this._mouseY = e.clientY - rect.top;
            if (this._lastConfig) this._render(this._lastData, this._lastConfig);
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
                    'Awaiting data — Red Bull Telemetry Chart'
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
            this._render(data, config);
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
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            var ns = getNS(this);
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));
            var title = getOption(config, ns, 'title', '');
            var colors = theme.parseColors(
                getOption(config, ns, 'colors', ''),
                F1_COLORS
            );

            // ── Flush background ────────────────────────────────────
            ctx.fillStyle = t.panel;
            ctx.fillRect(0, 0, w, h);

            // ── Layout ──────────────────────────────────────────────
            var titleH = title ? 28 : 4;
            var padL = 56, padR = 16, padT = titleH + 8, padB = 50;
            var chartW = w - padL - padR;
            var chartH = h - padT - padB;
            if (chartW < 40 || chartH < 40) return;

            this._chartBounds = { x: padL, y: padT, w: chartW, h: chartH };

            // Title
            if (title) {
                var tSize = Math.max(10, Math.min(13, h * 0.04));
                ctx.font = tSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textFaint;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(title.toUpperCase(), padL, 8);
            }

            // Parse data
            var fields = data.fields;
            var rows = data.rows;
            var seriesNames = [];
            for (var si = 1; si < fields.length; si++) {
                seriesNames.push(fields[si].name);
            }
            var numSeries = seriesNames.length;
            var numPoints = rows.length;
            if (numPoints < 1 || numSeries < 1) return;

            var allSeries = [];
            var globalMin = Infinity, globalMax = -Infinity;
            for (var s = 0; s < numSeries; s++) {
                var vals = [];
                for (var r = 0; r < numPoints; r++) {
                    var v = parseFloat(rows[r][s + 1]);
                    if (isNaN(v)) v = 0;
                    vals.push(v);
                    if (v < globalMin) globalMin = v;
                    if (v > globalMax) globalMax = v;
                }
                allSeries.push(vals);
            }
            var niceMin = Math.floor(globalMin / 10) * 10;
            var niceMax = Math.ceil(globalMax / 10) * 10;
            var niceRange = niceMax - niceMin;
            if (niceRange === 0) niceRange = 10;

            // ── Grid — sharp, technical ─────────────────────────────
            var gridLines = 5;
            ctx.lineWidth = 1;
            var labelSize = Math.max(8, Math.min(10, h * 0.03));
            ctx.font = labelSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';

            for (var g = 0; g <= gridLines; g++) {
                var gy = padT + chartH - (g / gridLines) * chartH;
                ctx.strokeStyle = (g === 0) ? t.edgeStrong : t.grid;
                ctx.beginPath();
                ctx.moveTo(padL, Math.round(gy) + 0.5);
                ctx.lineTo(padL + chartW, Math.round(gy) + 0.5);
                ctx.stroke();
                var gVal = niceMin + (g / gridLines) * niceRange;
                ctx.fillText(abbreviate(gVal), padL - 6, gy);
            }

            // X-axis labels — show percentage through data or clean short labels
            var xLabelSize = Math.max(8, Math.min(10, w * 0.008));
            ctx.font = xLabelSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            var xSteps = [0, 0.25, 0.5, 0.75, 1.0];
            for (var xi = 0; xi < xSteps.length; xi++) {
                var xIdx = Math.round(xSteps[xi] * (numPoints - 1));
                var xPos = padL + xSteps[xi] * chartW;
                var rawLabel = String(rows[xIdx][0]);
                // Try to extract a short meaningful label
                var shortLabel;
                if (rawLabel.length > 10) {
                    // Epoch or date string — show HH:MM
                    var epoch = parseFloat(rawLabel);
                    if (!isNaN(epoch) && epoch > 1e9) {
                        var d = new Date(epoch * 1000);
                        shortLabel = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
                                     (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ':' +
                                     (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();
                    } else {
                        shortLabel = rawLabel.substring(rawLabel.length - 8);
                    }
                } else {
                    shortLabel = rawLabel;
                }
                ctx.fillText(shortLabel, xPos, padT + chartH + 6);
            }

            // ── Draw series — flat fill, no glow ────────────────────
            this._points = [];
            for (var ds = numSeries - 1; ds >= 0; ds--) {
                var sVals = allSeries[ds];
                var sColor = colors[ds % colors.length];
                var isPrimary = ds === 0;

                var points = [];
                for (var p = 0; p < numPoints; p++) {
                    var px = padL + (p / (numPoints - 1)) * chartW;
                    var py = padT + chartH - ((sVals[p] - niceMin) / niceRange) * chartH;
                    points.push({ x: px, y: py });
                }
                if (ds === 0) this._points = points;

                // Flat area fill (no gradient — F1 timing screen style)
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (var ap = 1; ap < points.length; ap++) {
                    ctx.lineTo(points[ap].x, points[ap].y);
                }
                ctx.lineTo(points[points.length - 1].x, padT + chartH);
                ctx.lineTo(points[0].x, padT + chartH);
                ctx.closePath();
                ctx.fillStyle = theme.withAlpha(sColor, isPrimary ? 0.15 : 0.06);
                ctx.fill();

                // Line — 2px, solid, no cap rounding
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (var lp = 1; lp < points.length; lp++) {
                    ctx.lineTo(points[lp].x, points[lp].y);
                }
                ctx.strokeStyle = sColor;
                ctx.lineWidth = isPrimary ? 2 : 1.5;
                ctx.lineCap = 'butt';
                ctx.stroke();
            }

            // ── Crosshair + tooltip on hover ────────────────────────
            if (this._mouseX >= padL && this._mouseX <= padL + chartW) {
                var relX = this._mouseX - padL;
                var idx = Math.round((relX / chartW) * (numPoints - 1));
                if (idx >= 0 && idx < numPoints) {
                    var snapX = padL + (idx / (numPoints - 1)) * chartW;

                    // Vertical crosshair line
                    ctx.save();
                    ctx.setLineDash([3, 3]);
                    ctx.strokeStyle = theme.withAlpha(t.invert, 0.3);
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(Math.round(snapX) + 0.5, padT);
                    ctx.lineTo(Math.round(snapX) + 0.5, padT + chartH);
                    ctx.stroke();
                    ctx.restore();

                    // Dots on each series at this index
                    var tooltipLines = [];
                    for (var di = 0; di < numSeries; di++) {
                        var dv = allSeries[di][idx];
                        var dy = padT + chartH - ((dv - niceMin) / niceRange) * chartH;
                        var dColor = colors[di % colors.length];
                        ctx.beginPath();
                        ctx.arc(snapX, dy, 4, 0, Math.PI * 2);
                        ctx.fillStyle = dColor;
                        ctx.fill();
                        ctx.strokeStyle = t.panel;
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                        tooltipLines.push(seriesNames[di] + ': ' + theme.fmtNum(dv, { compact: true }));
                    }

                    // Tooltip
                    var tipX = this._mouseX + 14;
                    var tipY = this._mouseY - 20;
                    if (tipX + 160 > w) tipX = this._mouseX - 160;
                    this._tooltip.textContent = tooltipLines.join('\n');
                    this._tooltip.style.display = 'block';
                    this._tooltip.style.left = tipX + 'px';
                    this._tooltip.style.top = tipY + 'px';
                    this._tooltip.style.background = t.panelHi;
                    this._tooltip.style.color = t.text;
                    this._tooltip.style.border = '1px solid ' + t.edgeStrong;
                }
            }

            // ── Legend strip at bottom ───────────────────────────────
            var legendY = h - 22;
            var legendX = padL;
            var legFontSize = Math.max(9, Math.min(11, h * 0.032));
            ctx.font = legFontSize + 'px ' + theme.FONTS.data;
            for (var li = 0; li < numSeries; li++) {
                var lColor = colors[li % colors.length];
                // Small square (not circle — technical)
                ctx.fillStyle = lColor;
                ctx.fillRect(legendX, legendY - 4, 8, 8);

                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(seriesNames[li], legendX + 12, legendY);
                legendX += ctx.measureText(seriesNames[li]).width + 28;
            }
        },

        reflow: function() {
            if (this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
