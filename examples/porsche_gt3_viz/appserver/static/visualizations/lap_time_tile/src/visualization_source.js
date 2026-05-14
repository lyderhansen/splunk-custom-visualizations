/*
 * Porsche GT3 Lap Time Tile — Splunk Custom Visualization
 *
 * Big KPI tile for lap times. Large monospace time centered,
 * muted uppercase label above, trend delta arrow right-aligned,
 * optional sparkline at bottom with personal-best accent dot.
 *
 * Data: value (string), label (string), trend (number), trend_direction (string).
 * Reads LAST ROW only (single-value KPI).
 * Pure ES5 — no const/let/arrow/template literals.
 */
define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('shared/theme');

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

            // Tooltip (mandatory)
            this._tooltip = document.createElement('div');
            this._tooltip.style.cssText = 'position:absolute;display:none;padding:6px 10px;background:rgba(10,10,10,0.95);color:#E8E8E8;font-size:12px;border-radius:0;pointer-events:none;white-space:nowrap;z-index:100;font-family:JetBrains Mono,monospace;border:1px solid #2A2A2A;';
            this.el.style.position = 'relative';
            this.el.appendChild(this._tooltip);
            this._hitRegions = [];
            this._hoverIdx = -1;

            var self = this;
            this.canvas.addEventListener('mousemove', function(e) { self._onMouseMove(e); });
            this.canvas.addEventListener('mouseleave', function() {
                self._tooltip.style.display = 'none';
                self.canvas.style.cursor = 'default';
                if (self._hoverIdx !== -1) {
                    self._hoverIdx = -1;
                    self._render(self._lastData, self._lastConfig);
                }
            });
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 50
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError('Awaiting data');
            }
            var colIdx = {};
            for (var i = 0; i < data.fields.length; i++) {
                colIdx[data.fields[i].name] = i;
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

            // Settings
            var valueField = getOption(config, ns, 'valueField', 'value');
            var labelField = getOption(config, ns, 'labelField', 'label');
            var trendField = getOption(config, ns, 'trendField', 'trend');
            var trendDirField = getOption(config, ns, 'trendDirectionField', 'trend_direction');
            var decimals = parseInt(getOption(config, ns, 'decimals', '3'), 10);
            var showSparkline = getOption(config, ns, 'showSparkline', 'true');
            var showTrend = getOption(config, ns, 'showTrend', 'true');

            var colIdx = data.colIdx;
            var rows = data.rows;
            var row = rows[rows.length - 1];

            // Extract values from last row
            var value = (colIdx[valueField] !== undefined) ? String(row[colIdx[valueField]]) : '--:--.---';
            var label = (colIdx[labelField] !== undefined) ? String(row[colIdx[labelField]]) : '';
            var trend = (colIdx[trendField] !== undefined) ? parseFloat(row[colIdx[trendField]]) : NaN;
            var trendDir = (colIdx[trendDirField] !== undefined) ? String(row[colIdx[trendDirField]]) : '';

            // Auto-detect trend direction if field not provided
            if (!trendDir && !isNaN(trend)) {
                if (trend < 0) trendDir = 'down';
                else if (trend > 0) trendDir = 'up';
                else trendDir = 'flat';
            }

            // -- Panel chrome: t.panel bg, bottom hairline only --
            ctx.fillStyle = t.panel;
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = t.edge;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, h - 0.5);
            ctx.lineTo(w, h - 0.5);
            ctx.stroke();

            // Layout
            var pad = Math.max(12, w * 0.04);
            var sparklineH = h * 0.2;
            var contentH = (showSparkline === 'true') ? h - sparklineH : h;

            // -- Label: 11px uppercase Geist, letter-spaced, t.textDim --
            var labelSize = Math.max(9, Math.min(12, h * 0.1));
            var labelY = pad + labelSize / 2;
            if (label) {
                ctx.font = labelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                var upperLabel = label.toUpperCase();
                var spacing = labelSize * theme.SIZING.labelSpacing;
                var totalLabelW = 0;
                var ci;
                for (ci = 0; ci < upperLabel.length; ci++) {
                    totalLabelW += ctx.measureText(upperLabel[ci]).width;
                    if (ci < upperLabel.length - 1) totalLabelW += spacing;
                }
                var lx = (w - totalLabelW) / 2;
                for (ci = 0; ci < upperLabel.length; ci++) {
                    ctx.fillText(upperLabel[ci], lx, labelY);
                    lx += ctx.measureText(upperLabel[ci]).width + spacing;
                }
            }

            // -- Value: large JetBrains Mono bold, t.text, centered --
            var valSize = Math.max(18, Math.min(60, Math.min(w * 0.28, h * 0.42)));
            var valY = pad + labelSize + 8 + valSize / 2;
            ctx.font = 'bold ' + valSize + 'px ' + theme.FONTS.mono;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(value, w / 2, valY);

            // -- Trend arrow + delta: centered below value --
            if (showTrend === 'true' && !isNaN(trend)) {
                var trendSize = Math.max(10, Math.min(14, h * 0.12));
                var arrowH = Math.max(5, trendSize * 0.55);
                var arrowW = arrowH;
                var trendColor;

                if (trendDir === 'down' || trend < 0) {
                    trendColor = t.success;
                } else if (trendDir === 'up' || trend > 0) {
                    trendColor = t.danger;
                } else {
                    trendColor = t.textDim;
                }

                var trendText = (trend >= 0 ? '+' : '') + trend.toFixed(decimals);
                var trendY = valY + valSize / 2 + trendSize / 2 + 6;

                ctx.font = trendSize + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = trendColor;
                var trendTextW = ctx.measureText(trendText).width;
                var totalTrendW = arrowW + 4 + trendTextW;
                var trendStartX = (w - totalTrendW) / 2;

                // Arrow triangle
                var arrowCX = trendStartX + arrowW / 2;
                var arrowCY = trendY;

                ctx.beginPath();
                if (trendDir === 'down' || trend < 0) {
                    ctx.moveTo(arrowCX, arrowCY + arrowH / 2);
                    ctx.lineTo(arrowCX + arrowW / 2, arrowCY - arrowH / 2);
                    ctx.lineTo(arrowCX - arrowW / 2, arrowCY - arrowH / 2);
                } else if (trendDir === 'up' || trend > 0) {
                    ctx.moveTo(arrowCX, arrowCY - arrowH / 2);
                    ctx.lineTo(arrowCX + arrowW / 2, arrowCY + arrowH / 2);
                    ctx.lineTo(arrowCX - arrowW / 2, arrowCY + arrowH / 2);
                } else {
                    ctx.rect(arrowCX - arrowW / 2, arrowCY - 1, arrowW, 2);
                }
                ctx.closePath();
                ctx.fill();

                // Delta text right of arrow
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(trendText, trendStartX + arrowW + 4, trendY);
            }

            // -- Sparkline: 1px line at bottom 20%, t.textDim --
            if (showSparkline === 'true' && rows.length > 1) {
                var sparkX = pad;
                var sparkW = w - pad * 2;
                var sparkTop = contentH + 4;
                var sparkBottom = h - 4;
                var sparkRange = sparkBottom - sparkTop;
                if (sparkRange < 4) sparkRange = 4;

                // Parse all row values into numeric seconds
                var sparkVals = [];
                var si;
                for (si = 0; si < rows.length; si++) {
                    var rawVal = (colIdx[valueField] !== undefined) ? String(rows[si][colIdx[valueField]]) : null;
                    if (rawVal !== null) {
                        var parsed = NaN;
                        if (rawVal.indexOf(':') !== -1) {
                            var parts = rawVal.split(':');
                            parsed = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
                        } else {
                            parsed = parseFloat(rawVal);
                        }
                        sparkVals.push(parsed);
                    }
                }

                if (sparkVals.length > 1) {
                    // Find min/max
                    var sMin = sparkVals[0];
                    var sMax = sparkVals[0];
                    var sj;
                    for (sj = 1; sj < sparkVals.length; sj++) {
                        if (!isNaN(sparkVals[sj])) {
                            if (sparkVals[sj] < sMin) sMin = sparkVals[sj];
                            if (sparkVals[sj] > sMax) sMax = sparkVals[sj];
                        }
                    }
                    var sDelta = sMax - sMin;
                    if (sDelta === 0) sDelta = 1;

                    // Personal best = lowest time
                    var pbIdx = 0;
                    for (sj = 1; sj < sparkVals.length; sj++) {
                        if (!isNaN(sparkVals[sj]) && sparkVals[sj] < sparkVals[pbIdx]) {
                            pbIdx = sj;
                        }
                    }

                    // Draw 1px sparkline stroke
                    var step = sparkW / (sparkVals.length - 1);
                    ctx.beginPath();
                    var firstValid = true;
                    for (sj = 0; sj < sparkVals.length; sj++) {
                        if (isNaN(sparkVals[sj])) continue;
                        var sx = sparkX + sj * step;
                        // Invert: lower time = higher position on chart
                        var sy = sparkTop + (1 - (sparkVals[sj] - sMin) / sDelta) * sparkRange;
                        if (firstValid) {
                            ctx.moveTo(sx, sy);
                            firstValid = false;
                        } else {
                            ctx.lineTo(sx, sy);
                        }
                    }
                    ctx.strokeStyle = t.textDim;
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // Accent dot on personal best lap
                    var pbX = sparkX + pbIdx * step;
                    var pbY = sparkTop + (1 - (sparkVals[pbIdx] - sMin) / sDelta) * sparkRange;
                    ctx.beginPath();
                    ctx.arc(pbX, pbY, 3, 0, Math.PI * 2);
                    ctx.fillStyle = t.personalBest;
                    ctx.fill();
                }
            }

            // Hit regions
            this._hitRegions = [{
                x: 0,
                y: 0,
                w: w,
                h: h,
                label: label,
                value: value
            }];

            // Hover highlight
            if (this._hoverIdx === 0) {
                ctx.fillStyle = theme.withAlpha(t.text, 0.03);
                ctx.fillRect(0, 0, w, h);
            }
        },

        _onMouseMove: function(e) {
            var rect = this.canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;
            var hit = this._hitTest(mx, my);

            if (hit !== -1) {
                var region = this._hitRegions[hit];
                this._tooltip.innerHTML = '<span style="color:#707070;">' + (region.label || 'Value') + '</span>  ' + region.value;
                this._tooltip.style.display = 'block';
                var tx = mx + 14;
                var ty = my - 10;
                if (tx + 200 > this.el.offsetWidth) tx = mx - 200;
                if (ty < 0) ty = my + 20;
                this._tooltip.style.left = tx + 'px';
                this._tooltip.style.top = ty + 'px';
                this.canvas.style.cursor = 'default';
                if (this._hoverIdx !== hit) {
                    this._hoverIdx = hit;
                    this._render(this._lastData, this._lastConfig);
                }
            } else {
                this._tooltip.style.display = 'none';
                this.canvas.style.cursor = 'default';
                if (this._hoverIdx !== -1) {
                    this._hoverIdx = -1;
                    this._render(this._lastData, this._lastConfig);
                }
            }
        },

        _hitTest: function(mx, my) {
            for (var i = 0; i < this._hitRegions.length; i++) {
                var r = this._hitRegions[i];
                if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
                    return i;
                }
            }
            return -1;
        },

        reflow: function() {
            if (this._lastConfig) this._render(this._lastData, this._lastConfig);
        },

        destroy: function() {
            if (this._tooltip && this._tooltip.parentNode) {
                this._tooltip.parentNode.removeChild(this._tooltip);
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
