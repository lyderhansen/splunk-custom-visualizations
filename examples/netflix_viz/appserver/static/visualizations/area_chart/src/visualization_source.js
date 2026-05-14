/*
 * Disney+ Area Chart — Splunk Custom Visualization
 *
 * Time-series area chart with Disney+ gradient fill, branded grid,
 * and glow on the primary series.
 *
 * Expected SPL: | timechart span=1d count as Subscribers ...
 * First column = _time (or x-axis labels), remaining = series values.
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

    var SERIES_COLORS = ['#0063E5', '#0080FF', '#4DA3FF', '#A78BFA', '#2BBFB8'];

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;
            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
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
                    'Awaiting data — Disney+ Area Chart'
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
            var showGlow = getOption(config, ns, 'showGlow', 'true');
            var colors = theme.parseColors(
                getOption(config, ns, 'colors', ''),
                SERIES_COLORS
            );

            // Panel chrome
            theme.drawPanel(ctx, t, 0, 0, w, h);

            // Layout
            var titleH = title ? 28 : 8;
            var legendH = 30;
            var padL = 60, padR = 20, padT = titleH + 12, padB = 40 + legendH;
            var chartW = w - padL - padR;
            var chartH = h - padT - padB;
            if (chartW < 40 || chartH < 40) return;

            // Title
            if (title) {
                var tSize = Math.max(10, Math.min(16, h * 0.05));
                ctx.font = tSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(title, padL, 10);
            }

            // Parse series (col 0 = labels/time, col 1+ = values)
            var fields = data.fields;
            var rows = data.rows;
            var seriesNames = [];
            for (var si = 1; si < fields.length; si++) {
                seriesNames.push(fields[si].name);
            }
            var numSeries = seriesNames.length;
            var numPoints = rows.length;
            if (numPoints < 1 || numSeries < 1) return;

            // Extract values and find range
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
            var range = globalMax - globalMin;
            if (range === 0) range = 1;
            var niceMin = Math.floor(globalMin / 10) * 10;
            var niceMax = Math.ceil(globalMax / 10) * 10;
            var niceRange = niceMax - niceMin;
            if (niceRange === 0) niceRange = 10;

            // Draw grid
            var gridLines = 4;
            ctx.strokeStyle = t.grid;
            ctx.lineWidth = 1;
            var labelSize = Math.max(8, Math.min(11, h * 0.035));
            ctx.font = labelSize + 'px ' + theme.FONTS.mono;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (var g = 0; g <= gridLines; g++) {
                var gy = padT + chartH - (g / gridLines) * chartH;
                ctx.beginPath();
                ctx.moveTo(padL, Math.round(gy) + 0.5);
                ctx.lineTo(padL + chartW, Math.round(gy) + 0.5);
                ctx.stroke();
                var gVal = niceMin + (g / gridLines) * niceRange;
                ctx.fillText(abbreviate(gVal), padL - 8, gy);
            }

            // X-axis labels
            var xLabelSize = Math.max(8, Math.min(10, w * 0.008));
            ctx.font = xLabelSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            var labelStep = Math.max(1, Math.floor(numPoints / 6));
            for (var xl = 0; xl < numPoints; xl += labelStep) {
                var xPos = padL + (xl / (numPoints - 1)) * chartW;
                var rawLabel = String(rows[xl][0]);
                var shortLabel = rawLabel.length > 10 ? rawLabel.substring(5, 10) : rawLabel;
                ctx.fillText(shortLabel, xPos, padT + chartH + 6);
            }

            // Draw series (back to front so first series is on top)
            for (var ds = numSeries - 1; ds >= 0; ds--) {
                var sVals = allSeries[ds];
                var sColor = colors[ds % colors.length];
                var isPrimary = ds === 0;
                var opacity = isPrimary ? 0.35 : 0.12;

                // Build path
                var points = [];
                for (var p = 0; p < numPoints; p++) {
                    var px = padL + (p / (numPoints - 1)) * chartW;
                    var py = padT + chartH - ((sVals[p] - niceMin) / niceRange) * chartH;
                    points.push({ x: px, y: py });
                }

                // Glow on primary series
                if (isPrimary && showGlow === 'true') {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (var gp = 1; gp < points.length; gp++) {
                        ctx.lineTo(points[gp].x, points[gp].y);
                    }
                    ctx.strokeStyle = sColor;
                    ctx.lineWidth = 4;
                    ctx.shadowColor = sColor;
                    ctx.shadowBlur = 12;
                    ctx.globalAlpha = 0.5;
                    ctx.stroke();
                    ctx.restore();
                    ctx.shadowBlur = 0;
                    ctx.shadowColor = 'transparent';
                }

                // Area fill with gradient
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (var ap = 1; ap < points.length; ap++) {
                    ctx.lineTo(points[ap].x, points[ap].y);
                }
                ctx.lineTo(points[points.length - 1].x, padT + chartH);
                ctx.lineTo(points[0].x, padT + chartH);
                ctx.closePath();

                var grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
                grad.addColorStop(0, theme.withAlpha(sColor, opacity));
                grad.addColorStop(1, theme.withAlpha(sColor, 0.02));
                ctx.fillStyle = grad;
                ctx.fill();

                // Line stroke
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (var lp = 1; lp < points.length; lp++) {
                    ctx.lineTo(points[lp].x, points[lp].y);
                }
                ctx.strokeStyle = sColor;
                ctx.lineWidth = isPrimary ? 2.5 : 1.5;
                ctx.stroke();
            }

            // Legend
            var legendY = h - legendH + 4;
            var legendX = padL;
            var dotR = 5;
            var legLabelSize = Math.max(9, Math.min(12, h * 0.04));
            ctx.font = legLabelSize + 'px ' + theme.FONTS.ui;
            for (var li = 0; li < numSeries; li++) {
                var lColor = colors[li % colors.length];
                ctx.beginPath();
                ctx.arc(legendX + dotR, legendY + dotR, dotR, 0, Math.PI * 2);
                ctx.fillStyle = lColor;
                ctx.fill();

                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(seriesNames[li], legendX + dotR * 3, legendY + dotR);
                legendX += ctx.measureText(seriesNames[li]).width + dotR * 3 + 24;
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
