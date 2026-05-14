/*
 * Red Bull Racing Data Table — F1 Timing Tower
 *
 * Monospace data, sharp separators, position column with background,
 * tyre compound badges using F1 colors, no rounded chrome.
 * Feels like the F1 TV live timing tower.
 *
 * Expected SPL: | table Driver Lap Sector1 Sector2 Sector3 Compound Gap
 * Any field named "Compound"/"Category" gets a colored badge.
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

    function fitText(ctx, text, maxWidth) {
        var measured = ctx.measureText(text);
        if (measured.width <= maxWidth) return text;
        while (ctx.measureText(text + '…').width > maxWidth && text.length > 0) {
            text = text.substring(0, text.length - 1);
        }
        return text + '…';
    }

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
            this._tooltip.style.cssText = 'position:absolute;display:none;padding:6px 10px;border-radius:2px;font:11px ' + theme.FONTS.data + ';pointer-events:none;z-index:9999;white-space:pre;';
            this.el.appendChild(this._tooltip);

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this._hoverRow = -1;
            this._rowBounds = [];

            var self = this;
            this.el.addEventListener('mousemove', function(e) { self._onMouse(e); });
            this.el.addEventListener('mouseleave', function() {
                self._hoverRow = -1;
                self._tooltip.style.display = 'none';
                if (self._lastConfig) self._render(self._lastData, self._lastConfig);
            });
        },

        _onMouse: function(e) {
            var rect = this.el.getBoundingClientRect();
            var y = e.clientY - rect.top;
            var x = e.clientX - rect.left;
            var oldRow = this._hoverRow;
            this._hoverRow = -1;

            for (var i = 0; i < this._rowBounds.length; i++) {
                var rb = this._rowBounds[i];
                if (y >= rb.y && y < rb.y + rb.h) {
                    this._hoverRow = i;
                    break;
                }
            }

            if (this._hoverRow !== oldRow && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }

            if (this._hoverRow >= 0 && this._lastData) {
                var row = this._lastData.rows[this._hoverRow];
                var fields = this._lastData.fields;
                var lines = [];
                for (var fi = 0; fi < fields.length; fi++) {
                    lines.push(fields[fi].name + ': ' + (row[fi] || '—'));
                }
                var t = theme.getTheme('dark');
                this._tooltip.textContent = lines.join('\n');
                this._tooltip.style.display = 'block';
                this._tooltip.style.left = (x + 14) + 'px';
                this._tooltip.style.top = (y - 10) + 'px';
                this._tooltip.style.background = t.panelHi;
                this._tooltip.style.color = t.text;
                this._tooltip.style.border = '1px solid ' + t.edgeStrong;
            } else {
                this._tooltip.style.display = 'none';
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
                    'Awaiting data — Red Bull Timing Tower'
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
            var badgeField = getOption(config, ns, 'badgeField', 'Compound');
            var maxRows = parseInt(getOption(config, ns, 'maxRows', '20'), 10);
            var showPosition = getOption(config, ns, 'showPosition', 'true');

            var fields = data.fields;
            var rows = data.rows;
            var numCols = fields.length;
            var numRows = Math.min(rows.length, maxRows);

            // ── Flush background ────────────────────────────────────
            ctx.fillStyle = t.panel;
            ctx.fillRect(0, 0, w, h);

            // ── Layout ──────────────────────────────────────────────
            var posW = (showPosition === 'true') ? 32 : 0;
            var padX = 8;
            var headerH = 28;
            var rowH = Math.max(24, Math.min(34, (h - headerH - 4) / numRows));
            var dataW = w - posW - padX * 2;
            var colW = dataW / numCols;
            var fontSize = Math.max(9, Math.min(12, rowH * 0.40));
            var headerFontSize = Math.max(8, Math.min(10, rowH * 0.32));

            var badgeColIdx = -1;
            for (var bi = 0; bi < fields.length; bi++) {
                if (fields[bi].name.toLowerCase() === badgeField.toLowerCase()) {
                    badgeColIdx = bi;
                    break;
                }
            }

            // ── Header ──────────────────────────────────────────────
            ctx.fillStyle = t.panelHi;
            ctx.fillRect(0, 0, w, headerH);
            // Sharp bottom border
            ctx.fillStyle = t.edgeStrong;
            ctx.fillRect(0, headerH - 1, w, 1);

            ctx.font = 'bold ' + headerFontSize + 'px ' + theme.FONTS.data;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = t.textFaint;

            if (showPosition === 'true') {
                ctx.textAlign = 'center';
                ctx.fillText('P', posW / 2, headerH / 2);
            }

            for (var ci = 0; ci < numCols; ci++) {
                var hx = posW + padX + ci * colW + 6;
                ctx.textAlign = 'left';
                ctx.fillText(fields[ci].name.toUpperCase(), hx, headerH / 2);
            }

            // ── Data rows ───────────────────────────────────────────
            this._rowBounds = [];
            var startY = headerH;

            for (var ri = 0; ri < numRows; ri++) {
                var ry = startY + ri * rowH;
                this._rowBounds.push({ y: ry, h: rowH });

                // Hover highlight
                if (ri === this._hoverRow) {
                    ctx.fillStyle = theme.withAlpha(t.blue, 0.12);
                    ctx.fillRect(0, ry, w, rowH);
                }

                // Row separator (every row, sharp 1px)
                ctx.fillStyle = t.edge;
                ctx.fillRect(0, Math.round(ry + rowH) - 1, w, 1);

                // Position number (left column)
                if (showPosition === 'true') {
                    var posY = ry + rowH / 2;
                    ctx.font = 'bold ' + (fontSize + 1) + 'px ' + theme.FONTS.data;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    // Top 3 get colored position bg
                    if (ri < 3) {
                        var posColors = [t.gold, '#C0C0C0', '#CD7F32'];
                        ctx.fillStyle = theme.withAlpha(posColors[ri], 0.2);
                        ctx.fillRect(0, ry, posW, rowH);
                        ctx.fillStyle = posColors[ri];
                    } else {
                        ctx.fillStyle = t.textDim;
                    }
                    ctx.fillText(String(ri + 1), posW / 2, posY);
                }

                // Data columns
                for (var col = 0; col < numCols; col++) {
                    var cx = posW + padX + col * colW + 6;
                    var cellVal = String(rows[ri][col] || '');
                    var cellY = ry + rowH / 2;

                    if (col === badgeColIdx) {
                        // Tyre compound badge — small colored square + text
                        var badgeColor = theme.tyreColor(cellVal);
                        var sqSize = fontSize * 0.8;

                        ctx.fillStyle = badgeColor;
                        ctx.fillRect(cx - 2, cellY - sqSize / 2, sqSize, sqSize);

                        ctx.font = fontSize + 'px ' + theme.FONTS.data;
                        ctx.fillStyle = badgeColor;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(cellVal.charAt(0).toUpperCase(), cx + sqSize + 4, cellY);
                    } else {
                        ctx.font = fontSize + 'px ' + theme.FONTS.data;
                        ctx.fillStyle = (col === 0) ? t.text : t.textDim;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';

                        // Highlight sector times that are personal best (purple) or fastest (green)
                        var numVal = parseFloat(cellVal);
                        if (!isNaN(numVal) && fields[col].name.toLowerCase().indexOf('sector') >= 0) {
                            ctx.fillStyle = t.textDim;
                        }

                        var fitted = fitText(ctx, cellVal, colW - 12);
                        ctx.fillText(fitted, cx, cellY);
                    }
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
