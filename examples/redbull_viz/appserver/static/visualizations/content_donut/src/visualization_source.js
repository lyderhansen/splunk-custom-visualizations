/*
 * Red Bull Racing Sector Breakdown — F1 Tyre/Sector Distribution
 *
 * Hard-cut ring segments with visible gaps between each sector.
 * No smooth donut — each segment is a distinct block.
 * Right-aligned data readout (not legend dots).
 * Feels like F1 strategy analysis or tyre allocation display.
 *
 * Expected: category (string), value (number).
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

    var F1_PALETTE = ['#DC0000', '#FFC906', '#FFFFFF', '#46D369', '#1E3A6E', '#FF6B35', '#7B2FBE'];

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            this.el.style.cursor = 'pointer';
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            this._tooltip = document.createElement('div');
            this._tooltip.style.cssText = 'position:absolute;display:none;padding:6px 10px;border-radius:2px;font:11px ' + theme.FONTS.data + ';pointer-events:none;z-index:9999;';
            this.el.appendChild(this._tooltip);

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this._segments = [];

            var self = this;
            this.el.addEventListener('mousemove', function(e) { self._onMouse(e); });
            this.el.addEventListener('mouseleave', function() {
                self._tooltip.style.display = 'none';
                self._hoverIdx = -1;
                if (self._lastConfig) self._render(self._lastData, self._lastConfig);
            });
        },

        _onMouse: function(e) {
            var rect = this.el.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;

            if (!this._ringCenter) return;
            var dx = mx - this._ringCenter.cx;
            var dy = my - this._ringCenter.cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var angle = Math.atan2(dy, dx);
            if (angle < 0) angle += Math.PI * 2;

            var oldHover = this._hoverIdx;
            this._hoverIdx = -1;

            if (dist >= this._ringCenter.innerR && dist <= this._ringCenter.outerR) {
                for (var i = 0; i < this._segments.length; i++) {
                    var seg = this._segments[i];
                    var sa = seg.start;
                    var ea = seg.end;
                    if (sa < 0) sa += Math.PI * 2;
                    if (ea < 0) ea += Math.PI * 2;

                    var inSeg = false;
                    if (ea > sa) {
                        inSeg = (angle >= sa && angle <= ea);
                    } else {
                        inSeg = (angle >= sa || angle <= ea);
                    }
                    if (inSeg) {
                        this._hoverIdx = i;
                        break;
                    }
                }
            }

            if (this._hoverIdx >= 0) {
                var seg = this._segments[this._hoverIdx];
                this._tooltip.textContent = seg.label + ': ' + seg.value + ' (' + seg.pct + '%)';
                this._tooltip.style.display = 'block';
                this._tooltip.style.left = (mx + 14) + 'px';
                this._tooltip.style.top = (my - 24) + 'px';
                var t = theme.getTheme('dark');
                this._tooltip.style.background = t.panelHi;
                this._tooltip.style.color = t.text;
                this._tooltip.style.border = '1px solid ' + t.edgeStrong;
            } else {
                this._tooltip.style.display = 'none';
            }

            if (this._hoverIdx !== oldHover && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
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
                    'Awaiting data — Red Bull Sector Breakdown'
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

            var catField = getOption(config, ns, 'categoryField', 'category');
            var valField = getOption(config, ns, 'valueField', 'value');
            var showReadout = getOption(config, ns, 'showReadout', 'true');
            var colors = theme.parseColors(
                getOption(config, ns, 'colors', ''),
                F1_PALETTE
            );

            // Parse data
            var colIdx = data.colIdx;
            var items = [];
            var total = 0;
            for (var i = 0; i < data.rows.length; i++) {
                var row = data.rows[i];
                var cat = (colIdx[catField] !== undefined)
                    ? String(row[colIdx[catField]])
                    : 'Unknown';
                var val = (colIdx[valField] !== undefined)
                    ? parseFloat(row[colIdx[valField]])
                    : 0;
                if (isNaN(val)) val = 0;
                items.push({ category: cat, value: val });
                total += val;
            }

            // ── Flush background ────────────────────────────────────
            ctx.fillStyle = t.panel;
            ctx.fillRect(0, 0, w, h);

            // ── Layout: ring left, readout right ────────────────────
            var readoutW = (showReadout === 'true') ? Math.min(200, w * 0.42) : 0;
            var ringAreaW = w - readoutW;
            var cx = ringAreaW / 2;
            var cy = h / 2;
            var outerR = Math.min(ringAreaW, h) * 0.38;
            var innerR = outerR * 0.65;
            var ringWidth = outerR - innerR;

            this._ringCenter = { cx: cx, cy: cy, innerR: innerR, outerR: outerR };

            // ── Draw segmented ring with gaps ───────────────────────
            var gapAngle = 0.04;
            var totalGap = gapAngle * items.length;
            var availableSweep = Math.PI * 2 - totalGap;
            var angle = -Math.PI / 2;

            this._segments = [];

            for (var j = 0; j < items.length; j++) {
                var slice = (total > 0) ? (items[j].value / total) * availableSweep : 0;
                if (slice < 0.01) { angle += slice + gapAngle; continue; }
                var color = colors[j % colors.length];
                var pct = total > 0 ? Math.round((items[j].value / total) * 100) : 0;
                var isHover = (j === this._hoverIdx);

                var segStart = angle;
                var segEnd = angle + slice;

                this._segments.push({
                    start: segStart,
                    end: segEnd,
                    label: items[j].category,
                    value: items[j].value,
                    pct: pct
                });

                // Draw segment as thick arc (butt cap, sharp edges)
                ctx.beginPath();
                ctx.arc(cx, cy, innerR + ringWidth / 2, segStart, segEnd);
                ctx.strokeStyle = color;
                ctx.lineWidth = ringWidth;
                ctx.lineCap = 'butt';

                if (isHover) {
                    ctx.save();
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 10;
                    ctx.stroke();
                    ctx.restore();
                    ctx.shadowBlur = 0;
                    ctx.shadowColor = 'transparent';
                } else {
                    ctx.stroke();
                }

                angle += slice + gapAngle;
            }

            // ── Center total ────────────────────────────────────────
            var totalStr = theme.fmtNum(total, { compact: true });
            var totalSize = Math.max(14, Math.min(32, innerR * 0.40));
            ctx.font = 'bold ' + totalSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(totalStr, cx, cy - totalSize * 0.15);

            var subSize = Math.max(8, totalSize * 0.35);
            ctx.font = subSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = t.textFaint;
            ctx.fillText('TOTAL', cx, cy + totalSize * 0.45);

            // ── Readout (right side) — tabular data, not dot legend ─
            if (showReadout === 'true' && items.length > 0) {
                var readoutX = ringAreaW + 8;
                var lineH = Math.max(18, Math.min(26, h / (items.length + 1)));
                var startY = Math.max(12, (h - items.length * lineH) / 2);
                var labelSize = Math.max(9, Math.min(12, lineH * 0.48));

                for (var k = 0; k < items.length; k++) {
                    var ly = startY + k * lineH;
                    var lColor = colors[k % colors.length];
                    var itemPct = total > 0 ? Math.round((items[k].value / total) * 100) : 0;
                    var isRowHover = (k === this._hoverIdx);

                    // Row highlight on hover
                    if (isRowHover) {
                        ctx.fillStyle = theme.withAlpha(lColor, 0.08);
                        ctx.fillRect(readoutX - 4, ly, readoutW - 4, lineH);
                    }

                    // Color bar (small square, not dot)
                    ctx.fillStyle = lColor;
                    ctx.fillRect(readoutX, ly + (lineH - labelSize) / 2, 3, labelSize);

                    // Category name
                    ctx.font = labelSize + 'px ' + theme.FONTS.data;
                    ctx.fillStyle = isRowHover ? t.text : t.textDim;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(items[k].category, readoutX + 10, ly + lineH / 2);

                    // Percentage right-aligned
                    ctx.font = 'bold ' + labelSize + 'px ' + theme.FONTS.data;
                    ctx.fillStyle = lColor;
                    ctx.textAlign = 'right';
                    ctx.fillText(itemPct + '%', w - 10, ly + lineH / 2);
                }
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
