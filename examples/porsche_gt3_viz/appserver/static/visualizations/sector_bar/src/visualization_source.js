/*
 * Porsche GT3 Sector Bar — Splunk Custom Visualization
 *
 * Three horizontal bars side by side for S1, S2, S3 sectors.
 * Width proportional to time fraction of total. Colored by status:
 * purple = personal best, green = session best, muted = slower.
 * Total time right-aligned. Reads LAST ROW only.
 *
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

    function statusColor(t, status) {
        var s = (status || '').toLowerCase();
        if (s === 'pb' || s === 'personal_best') return t.personalBest;
        if (s === 'best' || s === 'session_best') return t.sessionBest;
        return t.textDim;
    }

    function statusLabel(status) {
        var s = (status || '').toLowerCase();
        if (s === 'pb' || s === 'personal_best') return 'Personal Best';
        if (s === 'best' || s === 'session_best') return 'Session Best';
        return 'Slower';
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

            // Settings: configurable field mappings
            var sectorFields = [
                {
                    timeKey: getOption(config, ns, 's1TimeField', 's1_time'),
                    statusKey: getOption(config, ns, 's1StatusField', 's1_status'),
                    label: 'S1'
                },
                {
                    timeKey: getOption(config, ns, 's2TimeField', 's2_time'),
                    statusKey: getOption(config, ns, 's2StatusField', 's2_status'),
                    label: 'S2'
                },
                {
                    timeKey: getOption(config, ns, 's3TimeField', 's3_time'),
                    statusKey: getOption(config, ns, 's3StatusField', 's3_status'),
                    label: 'S3'
                }
            ];
            var totalField = getOption(config, ns, 'totalField', 'total');

            var colIdx = data.colIdx;
            var row = data.rows[data.rows.length - 1];

            // Build sector array from last row
            var sectors = [];
            var sumTime = 0;
            var i;
            for (i = 0; i < sectorFields.length; i++) {
                var sf = sectorFields[i];
                var time = (colIdx[sf.timeKey] !== undefined) ? parseFloat(row[colIdx[sf.timeKey]]) : 0;
                var status = (colIdx[sf.statusKey] !== undefined) ? String(row[colIdx[sf.statusKey]]) : 'slower';
                if (isNaN(time)) time = 0;
                sectors.push({ time: time, status: status, label: sf.label });
                sumTime += time;
            }

            var total = (colIdx[totalField] !== undefined) ? parseFloat(row[colIdx[totalField]]) : sumTime;
            if (isNaN(total) || total === 0) total = sumTime;
            if (total === 0) total = 1; // prevent division by zero

            // -- Background: t.bg (transparent to dashboard) --
            ctx.fillStyle = t.bg;
            ctx.fillRect(0, 0, w, h);

            // Layout metrics
            var pad = Math.max(12, w * 0.04);
            var labelFontSize = Math.max(9, Math.min(13, h * 0.12));
            var timeFontSize = Math.max(11, Math.min(16, h * 0.15));
            var totalFontSize = Math.max(13, Math.min(20, h * 0.2));
            var barGap = 2;

            var barTop = pad + labelFontSize + 6;
            var barBottom = h - pad - timeFontSize - 6;
            var barH = Math.max(8, barBottom - barTop);

            // Reserve space for total time on right
            var totalTimeText = theme.fmtLapTime(total);
            ctx.font = 'bold ' + totalFontSize + 'px ' + theme.FONTS.mono;
            var totalTextW = ctx.measureText(totalTimeText).width;
            var totalPad = 12;

            var availW = (w - pad * 2) - totalTextW - totalPad;
            var totalGaps = (sectors.length - 1) * barGap;
            var usableW = availW - totalGaps;
            if (usableW < 30) usableW = 30;

            this._hitRegions = [];
            var curX = pad;

            for (i = 0; i < sectors.length; i++) {
                var sec = sectors[i];
                var fraction = sumTime > 0 ? sec.time / sumTime : 1 / sectors.length;
                var barW = Math.max(20, Math.round(usableW * fraction));
                var color = statusColor(t, sec.status);

                // Sector label above: 11px Geist uppercase, t.textFaint
                ctx.font = labelFontSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textFaint;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(sec.label, curX + barW / 2, barTop - 4);

                // Bar: solid fill, brighten on hover via lerpColor
                var drawColor = color;
                if (this._hoverIdx === i) {
                    drawColor = theme.lerpColor(color, '#FFFFFF', 0.25);
                }
                ctx.fillStyle = drawColor;
                ctx.fillRect(curX, barTop, barW, barH);

                // Sector time below: 14px JetBrains Mono, same color as bar
                ctx.font = timeFontSize + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(sec.time.toFixed(1) + 's', curX + barW / 2, barBottom + 4);

                // Hit region for tooltip
                this._hitRegions.push({
                    x: curX,
                    y: barTop,
                    w: barW,
                    h: barH,
                    label: sec.label,
                    time: sec.time,
                    status: sec.status,
                    color: color
                });

                curX += barW + barGap;
            }

            // Total time: right-aligned, 18px JetBrains Mono bold, t.text
            var totalX = w - pad;
            var totalY = barTop + barH / 2;
            ctx.font = 'bold ' + totalFontSize + 'px ' + theme.FONTS.mono;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(totalTimeText, totalX, totalY);
        },

        _onMouseMove: function(e) {
            var rect = this.canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;
            var hit = this._hitTest(mx, my);

            if (hit !== -1) {
                var region = this._hitRegions[hit];
                this._tooltip.innerHTML = '<b style="color:' + region.color + '">' + region.label + '</b>: ' +
                    region.time.toFixed(1) + 's (' + statusLabel(region.status) + ')';
                this._tooltip.style.display = 'block';
                var tx = mx + 14;
                var ty = my - 10;
                if (tx + 200 > this.el.offsetWidth) tx = mx - 200;
                if (ty < 0) ty = my + 20;
                this._tooltip.style.left = tx + 'px';
                this._tooltip.style.top = ty + 'px';
                this.canvas.style.cursor = 'pointer';
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
