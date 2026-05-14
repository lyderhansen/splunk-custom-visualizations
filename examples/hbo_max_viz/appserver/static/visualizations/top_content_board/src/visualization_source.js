/*
 * HBO Max — Top Content Board (ES5 Canvas leaderboard).
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

    return SplunkVisualizationBase.extend({
        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this._canvas = null;
            this._ctx = null;
            this._tooltip = null;
            this._layout = { w: 0, h: 0, dpr: 1 };
            this._hover = false;
            this._tipHtml = '';
            this._hoverRow = -1;
            this._rowsGeom = [];
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
                'max-width:320px',
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
                self._hoverRow = -1;
                if (self._tooltip) self._tooltip.style.display = 'none';
                self.invalidateUpdateView();
            });
        },

        _pickRow: function (y) {
            var g = this._rowsGeom;
            var i;
            for (i = 0; i < g.length; i++) {
                if (y >= g[i].y0 && y < g[i].y1) return g[i].index;
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

            var row = this._pickRow(y);
            if (row !== this._hoverRow) {
                this._hoverRow = row;
                this.invalidateUpdateView();
            }

            if (!this._hover || !this._tooltip) return;
            this._tooltip.innerHTML = this._tipHtml;
            this._tooltip.style.display = this._tipHtml ? 'block' : 'none';
            var tx = x + 12;
            var ty = y + 12;
            if (tx + 240 > w) tx = x - 240;
            if (ty + 88 > h) ty = y - 88;
            this._tooltip.style.left = Math.round(tx) + 'px';
            this._tooltip.style.top = Math.round(ty) + 'px';
        },

        updateView: function (data, config) {
            var root = this.el;
            if (!root) return;
            this._ensureUi(root);

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var nameField = getOption(config, ns, 'nameField', 'title');
            var valueField = getOption(config, ns, 'valueField', 'views');
            var maxRowsRaw = getOption(config, ns, 'maxRows', '10');
            var maxRows = parseInt(maxRowsRaw, 10);
            if (isNaN(maxRows) || maxRows < 1) maxRows = 10;
            var valueColor = getOption(config, ns, 'valueColor', '#7B61FF');
            var themeName = getOption(config, ns, 'theme', 'dark');
            var th = theme.getTheme(themeName === 'light' ? 'light' : 'dark');

            var fields = data.fields || [];
            var rows = data.rows || [];
            var ni = fieldIndex(fields, nameField);
            var vi = fieldIndex(fields, valueField);

            var items = [];
            var r;
            if (ni >= 0 && vi >= 0) {
                for (r = 0; r < rows.length; r++) {
                    var nm = rows[r][ni];
                    var val = parseNumber(rows[r][vi]);
                    if (isNaN(val)) continue;
                    items.push({
                        name: nm === null || nm === undefined ? '' : String(nm),
                        value: val
                    });
                }
            }

            var count = Math.min(items.length, maxRows);

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

            this._rowsGeom = [];
            var tip = '';

            if (count === 0) {
                ctx.font = '500 14px ' + theme.FONTS.ui;
                ctx.fillStyle = th.textDim;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('No data', w * 0.5, h * 0.5);
            } else {
                var pad = Math.max(10, Math.min(w, h) * 0.04);
                var rowH = (h - pad * 2) / count;
                var mono = theme.FONTS.mono;
                var ui = theme.FONTS.ui;
                var rankColW = Math.max(36, Math.min(52, w * 0.1));
                var valueColW = Math.max(56, w * 0.22);
                var textLeft = pad + rankColW + 10;
                var textRight = w - pad - valueColW;

                var i;
                for (i = 0; i < count; i++) {
                    var it = items[i];
                    var y0 = pad + i * rowH;
                    var y1 = y0 + rowH;
                    this._rowsGeom.push({ y0: y0, y1: y1, index: i });

                    var rowBg = i % 2 === 0 ? th.panel : th.panelHi;
                    ctx.fillStyle = rowBg;
                    ctx.fillRect(0, y0, w, rowH);

                    if (i === this._hoverRow) {
                        ctx.fillStyle = theme.withAlpha(valueColor, 0.08);
                        ctx.fillRect(0, y0, w, rowH);
                    }

                    var rank = i + 1;
                    var rcx = pad + rankColW * 0.48;
                    var rcy = y0 + rowH * 0.5;

                    if (rank <= 3) {
                        var gg = ctx.createRadialGradient(rcx, rcy, 2, rcx, rcy, rankColW * 0.65);
                        gg.addColorStop(0, theme.withAlpha(valueColor, 0.42));
                        gg.addColorStop(0.55, theme.withAlpha(valueColor, 0.12));
                        gg.addColorStop(1, theme.withAlpha(valueColor, 0));
                        ctx.fillStyle = gg;
                        ctx.fillRect(pad * 0.2, y0, rankColW + 8, rowH);
                    }

                    var rankSize = Math.max(12, Math.min(20, rowH * 0.42));
                    ctx.font = '600 ' + rankSize + 'px ' + mono;
                    ctx.fillStyle = valueColor;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('#' + rank, rcx, rcy);

                    var nameSize = Math.max(11, Math.min(16, rowH * 0.38));
                    ctx.font = '500 ' + nameSize + 'px ' + ui;
                    ctx.fillStyle = th.text;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    var title = it.name;
                    var maxNameW = textRight - textLeft - 8;
                    ctx.font = '500 ' + nameSize + 'px ' + ui;
                    while (ctx.measureText(title).width > maxNameW && title.length > 3) {
                        title = title.substring(0, title.length - 2) + '\u2026';
                    }
                    ctx.fillText(title, textLeft, rcy);

                    var valStr = theme.fmtNum(it.value, { compact: true });
                    ctx.font = '600 ' + Math.max(11, Math.round(nameSize * 0.95)) + 'px ' + mono;
                    ctx.fillStyle = valueColor;
                    ctx.textAlign = 'right';
                    ctx.fillText(valStr, w - pad, rcy);

                    ctx.strokeStyle = th.textFaint;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(pad, y1 - 0.5);
                    ctx.lineTo(w - pad, y1 - 0.5);
                    ctx.stroke();

                    if (i === this._hoverRow) {
                        tip = '<b>' + String(it.name) + '</b><br/>' +
                            String(valueField) + ': ' + valStr;
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
