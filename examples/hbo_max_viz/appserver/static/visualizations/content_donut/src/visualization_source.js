/*
 * HBO Max — Content Donut (ES5 Canvas).
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

    function normAngle(t) {
        var twoPi = Math.PI * 2;
        while (t < 0) t += twoPi;
        while (t >= twoPi) t -= twoPi;
        return t;
    }

    return SplunkVisualizationBase.extend({
        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this._canvas = null;
            this._ctx = null;
            this._tooltip = null;
            this._layout = { w: 0, h: 0, dpr: 1 };
            this._hover = false;
            this._tipHtml = '';
            this._hoverSeg = -1;
            this._geom = { cx: 0, cy: 0, rOut: 0, rIn: 0, segs: [] };
        },

        reflow: function () {
            this.invalidateUpdateView();
        },

        _ensureUi: function (root) {
            if (this._canvas) return;
            var wrap = document.createElement('div');
            wrap.style.position = 'relative';
            wrap.style.width = '100%';
            wrap.style.height = '100%';
            this._canvas = document.createElement('canvas');
            this._canvas.style.display = 'block';
            this._canvas.style.width = '100%';
            this._canvas.style.height = '100%';
            wrap.appendChild(this._canvas);
            root.appendChild(wrap);
            this._ctx = this._canvas.getContext('2d');

            this._tooltip = document.createElement('div');
            this._tooltip.setAttribute('role', 'tooltip');
            this._tooltip.style.cssText = [
                'position:absolute',
                'z-index:50',
                'pointer-events:none',
                'display:none',
                'max-width:280px',
                'padding:8px 10px',
                'border-radius:6px',
                'font:12px ' + theme.FONTS.ui.replace(/"/g, ''),
                'box-shadow:0 6px 24px rgba(0,0,0,0.35)',
                'white-space:pre-wrap'
            ].join(';');
            wrap.appendChild(this._tooltip);

            var self = this;
            this._canvas.addEventListener('mousemove', function (ev) {
                self._onMove(ev);
            });
            this._canvas.addEventListener('mouseleave', function () {
                self._hover = false;
                self._hoverSeg = -1;
                if (self._tooltip) self._tooltip.style.display = 'none';
                self.invalidateUpdateView();
            });
        },

        _pickSegment: function (lx, ly) {
            var g = this._geom;
            var dx = lx - g.cx;
            var dy = ly - g.cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var bump = 8;
            if (dist < g.rIn - 2 || dist > g.rOut + bump) return -1;

            var phi = Math.atan2(dy, dx);
            var t = normAngle(phi + Math.PI / 2);
            var twoPi = Math.PI * 2;
            var i;
            for (i = 0; i < g.segs.length; i++) {
                var s = g.segs[i];
                var isLast = i === g.segs.length - 1;
                if (isLast) {
                    if (t >= s.a0 && t <= twoPi + 1e-6) return i;
                } else if (t >= s.a0 && t < s.a1) {
                    return i;
                }
            }
            return -1;
        },

        _onMove: function (ev) {
            var rect = this._canvas.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var y = ev.clientY - rect.top;
            var w = rect.width;
            var h = rect.height;
            this._hover = x >= 0 && y >= 0 && x <= w && y <= h;

            var seg = this._pickSegment(x, y);
            if (seg !== this._hoverSeg) {
                this._hoverSeg = seg;
                this.invalidateUpdateView();
            }

            if (!this._hover || !this._tooltip) return;
            this._tooltip.innerHTML = this._tipHtml;
            this._tooltip.style.display = this._tipHtml ? 'block' : 'none';
            var tx = x + 12;
            var ty = y + 12;
            if (tx + 220 > w) tx = x - 220;
            if (ty + 90 > h) ty = y - 90;
            this._tooltip.style.left = Math.round(tx) + 'px';
            this._tooltip.style.top = Math.round(ty) + 'px';
        },

        updateView: function (data, config) {
            var root = this.el;
            if (!root) return;
            this._ensureUi(root);

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var categoryField = getOption(config, ns, 'categoryField', 'category');
            var valueField = getOption(config, ns, 'valueField', 'count');
            var showLegendStr = getOption(config, ns, 'showLegend', 'true');
            var showLegend = String(showLegendStr) === 'true' || showLegendStr === true;
            var showTotalStr = getOption(config, ns, 'showTotal', 'true');
            var showTotal = String(showTotalStr) === 'true' || showTotalStr === true;
            var colorsRaw = getOption(config, ns, 'colors', '#7B61FF,#4F6984,#8298AB,#A78BFA,#6B7280');
            var totalValueColor = getOption(config, ns, 'totalValueColor', '#E8E8F0');
            var totalLabelColor = getOption(config, ns, 'totalLabelColor', '#9494A8');
            var themeName = getOption(config, ns, 'theme', 'dark');
            var th = theme.getTheme(themeName === 'light' ? 'light' : 'dark');

            var fields = data.fields || [];
            var rows = data.rows || [];
            var ci = fieldIndex(fields, categoryField);
            var vi = fieldIndex(fields, valueField);

            var items = [];
            var total = 0;
            var r;
            if (ci >= 0 && vi >= 0) {
                for (r = 0; r < rows.length; r++) {
                    var cat = rows[r][ci];
                    var val = parseNumber(rows[r][vi]);
                    if (isNaN(val) || val <= 0) continue;
                    items.push({ name: cat === null || cat === undefined ? '' : String(cat), value: val });
                    total += val;
                }
            }

            var fallbackPalette = [th.s1, th.s2, th.s3, th.s4, th.s5];
            var palette = theme.parseColors(colorsRaw, fallbackPalette);

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

            var w = cssW;
            var h = cssH;
            ctx.fillStyle = th.bg;
            ctx.fillRect(0, 0, w, h);

            var legendW = showLegend ? Math.min(200, Math.floor(w * 0.36)) : 0;
            var chartW = w - legendW - Math.max(8, w * 0.04);
            var pad = Math.max(10, Math.min(w, h) * 0.04);
            var cx = pad + chartW * 0.5;
            var cy = h * 0.5;
            var rBase = Math.min(chartW, h) * 0.36;
            var rOut = rBase;
            var rIn = rOut * 0.6;

            this._geom.cx = cx;
            this._geom.cy = cy;
            this._geom.rOut = rOut;
            this._geom.rIn = rIn;
            this._geom.segs = [];

            var mono = theme.FONTS.mono;
            var tip = '';
            if (items.length === 0) {
                ctx.font = '500 14px ' + theme.FONTS.ui;
                ctx.fillStyle = th.textDim;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('No data', cx, cy);
            } else {
                var twoPi = Math.PI * 2;
                var start = -Math.PI / 2;
                var accAngle = 0;
                var idx;
                for (idx = 0; idx < items.length; idx++) {
                    var it = items[idx];
                    var frac = it.value / total;
                    var span = frac * twoPi;
                    var end = start + span;
                    var ro = rOut;
                    if (idx === this._hoverSeg) ro = rOut + 6;
                    var col = palette[idx % palette.length];
                    var a0hit = accAngle;
                    accAngle += span;
                    var a1hit = accAngle;

                    ctx.beginPath();
                    ctx.arc(cx, cy, ro, start, end, false);
                    ctx.arc(cx, cy, rIn, end, start, true);
                    ctx.closePath();
                    ctx.fillStyle = col;
                    ctx.fill();

                    this._geom.segs.push({ a0: a0hit, a1: a1hit });

                    start = end;
                }

                if (showTotal) {
                    var totalStr = theme.fmtNum(total, { compact: true });
                    var lblSize = Math.max(9, Math.min(14, h * 0.035));
                    var numSize = theme.fitText(ctx, totalStr, rIn * 1.85, Math.min(40, rIn * 0.55), 12, mono.replace(/"/g, ''));
                    ctx.font = '600 ' + numSize + 'px ' + mono;
                    ctx.fillStyle = totalValueColor;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(totalStr, cx, cy + numSize * 0.15);
                    ctx.font = '500 ' + lblSize + 'px ' + theme.FONTS.ui;
                    ctx.fillStyle = totalLabelColor;
                    ctx.textBaseline = 'top';
                    ctx.fillText('TOTAL', cx, cy + numSize * 0.2);
                }

                if (this._hoverSeg >= 0 && this._hoverSeg < items.length) {
                    var hi = items[this._hoverSeg];
                    var pct = (hi.value / total) * 100;
                    tip = '<b>' + String(hi.name) + '</b><br/>' +
                        theme.fmtNum(hi.value, {}) + ' (' + pct.toFixed(1) + '%)';
                }

                if (showLegend) {
                    var lx = w - legendW + 8;
                    var ly = pad + 8;
                    var lineH = Math.max(20, (h - pad * 2 - 16) / Math.max(1, items.length));
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    var j;
                    for (j = 0; j < items.length; j++) {
                        var it2 = items[j];
                        var pc2 = (it2.value / total) * 100;
                        var cy2 = ly + j * lineH + lineH * 0.5;
                        var dotX = lx;
                        var ccol = palette[j % palette.length];
                        ctx.beginPath();
                        ctx.arc(dotX + 5, cy2, 5, 0, twoPi);
                        ctx.fillStyle = ccol;
                        ctx.fill();
                        ctx.font = '500 13px ' + theme.FONTS.ui;
                        ctx.fillStyle = th.text;
                        var nm = String(it2.name);
                        if (nm.length > 16) nm = nm.substring(0, 14) + '\u2026';
                        ctx.fillText(nm, lx + 16, cy2 - 7);
                        ctx.font = '500 12px ' + mono;
                        ctx.fillStyle = th.textDim;
                        ctx.fillText(pc2.toFixed(1) + '%', lx + 16, cy2 + 9);
                    }
                }
            }

            this._tipHtml = tip;
            if (this._hover && this._tooltip) {
                this._tooltip.innerHTML = this._tipHtml;
                if (!this._tipHtml) this._tooltip.style.display = 'none';
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
