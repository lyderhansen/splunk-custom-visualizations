/*
 * Pop Grid — Splunk Custom Visualization
 *
 * Compact multi-site status grid — shows 16+ PoPs in a configurable
 * grid layout with site code, name, status dot, and utilization bar.
 *
 * Expected SPL:
 *   | stats latest(status) as status latest(util) as util by site_code site_name
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {


    // ── Status → semantic color mapping ─────────────────────────

    function statusColor(status, theme) {
        if (!status) return theme.textFaint;
        var s = String(status).toLowerCase().trim();
        if (s === 'ok' || s === 'healthy' || s === 'up' || s === 'active') {
            return theme.success;
        }
        if (s === 'warn' || s === 'degraded' || s === 'slow') {
            return theme.warn;
        }
        if (s === 'critical' || s === 'down' || s === 'error') {
            return theme.danger;
        }
        return theme.textFaint;
    }

    // ── Tooltip helper ──────────────────────────────────────────

    function drawHoverTooltip(ctx, mx, my, lines, theme, fonts, canvasW, canvasH) {
        var padX = 10, padY = 8, lineH = 18;
        var maxW = 0;
        for (var i = 0; i < lines.length; i++) {
            ctx.font = lines[i].bold ? '600 12px ' + fonts.mono : '11px ' + fonts.primary;
            var tw = ctx.measureText(lines[i].text).width;
            if (lines[i].dot) tw += 14;
            if (tw > maxW) maxW = tw;
        }
        var cardW = padX * 2 + maxW;
        var cardH = padY * 2 + lines.length * lineH;
        var tx = mx + 12;
        var ty = my - cardH / 2;
        if (tx + cardW > canvasW) tx = mx - cardW - 12;
        if (ty + cardH > canvasH) ty = canvasH - cardH - 4;
        if (ty < 4) ty = 4;

        draw.roundRect(ctx, tx, ty, cardW, cardH, 6);
        ctx.fillStyle = theme.panel;
        ctx.fill();
        ctx.strokeStyle = theme.edgeStrong;
        ctx.lineWidth = 1;
        ctx.stroke();

        for (var i = 0; i < lines.length; i++) {
            var ry = ty + padY + i * lineH + lineH / 2;
            var lx = tx + padX;
            if (lines[i].dot) {
                ctx.beginPath();
                ctx.arc(lx + 4, ry, 4, 0, Math.PI * 2);
                ctx.fillStyle = lines[i].dot;
                ctx.fill();
                lx += 14;
            }
            ctx.font = lines[i].bold ? '600 12px ' + fonts.mono : '11px ' + fonts.primary;
            ctx.fillStyle = lines[i].dimmed ? theme.textFaint : (lines[i].colored || theme.text);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(lines[i].text, lx, ry);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-pop-grid-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
            this._hoverIndex = -1;
            this._lastMouseEvent = null;
            var self = this;
            this.canvas.addEventListener('mousemove', function(e) {
                self._lastMouseEvent = e;
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                var newIdx = -1;
                for (var i = 0; i < self._hitAreas.length; i++) {
                    var h = self._hitAreas[i];
                    if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) {
                        newIdx = i;
                        break;
                    }
                }
                if (newIdx !== self._hoverIndex) {
                    self._hoverIndex = newIdx;
                    self.invalidateUpdateView();
                }
                self.canvas.style.cursor = newIdx >= 0 ? 'pointer' : 'default';
            });
            this.canvas.addEventListener('mouseleave', function() {
                self._lastMouseEvent = null;
                if (self._hoverIndex !== -1) {
                    self._hoverIndex = -1;
                    self.invalidateUpdateView();
                }
                self.canvas.style.cursor = 'default';
            });
            this._hitAreas = [];
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data, config) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Pop Grid'
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
            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            // ── Read settings ──
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName   = (config[ns + 'theme'] || 'dark');
            var columns     = parseInt(config[ns + 'columns'] || '4', 10);
            var codeField   = (config[ns + 'codeField'] || 'site_code');
            var nameField   = (config[ns + 'nameField'] || 'site_name');
            var statusField = (config[ns + 'statusField'] || 'status');
            var utilField   = (config[ns + 'utilField'] || 'util');

            var theme = tokens.getTheme(themeName);

            // ── Extract site data from rows ──
            var rows = data.rows;
            var colIdx = data.colIdx;
            var sites = [];

            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                var code = '';
                var name = '';
                var status = '';
                var util = 0;

                if (colIdx[codeField] !== undefined) {
                    code = String(row[colIdx[codeField]] || '');
                }
                if (colIdx[nameField] !== undefined) {
                    name = String(row[colIdx[nameField]] || '');
                }
                if (colIdx[statusField] !== undefined) {
                    status = String(row[colIdx[statusField]] || '');
                }
                if (colIdx[utilField] !== undefined) {
                    var v = parseFloat(row[colIdx[utilField]]);
                    if (!isNaN(v)) util = v;
                }

                sites.push({
                    code: code,
                    name: name,
                    status: status,
                    util: util
                });
            }

            if (sites.length === 0) return;

            // ── Size canvas for HiDPI ──
            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);

            var w = rect.width;
            var h = rect.height;
            ctx.clearRect(0, 0, w, h);

            this._hitAreas = [];

            // ── Grid layout ──
            var numRows = Math.ceil(sites.length / columns);
            var layout = draw.gridLayout(w, h, numRows, columns, 8);
            var cells = layout.cells;

            // ── Draw each site cell ──
            var padH = 8;   // horizontal padding inside card
            var padV = 10;  // vertical padding inside card
            var dotSize = 6;
            var barHeight = 4;
            var barRadius = 2;
            var cardRadius = 4;

            var hasHover = this._hoverIndex >= 0;

            for (var s = 0; s < sites.length; s++) {
                var site = sites[s];
                var cell = cells[s];
                if (!cell) break;

                var cx = cell.x;
                var cy = cell.y;
                var cw = cell.w;
                var ch = cell.h;

                var innerW = cw - padH * 2;
                var sColor = statusColor(site.status, theme);

                // ── Register hit area ──
                this._hitAreas.push({
                    x: cx, y: cy, w: cw, h: ch,
                    label: site.code,
                    value: site.name,
                    status: site.status,
                    statusColor: sColor,
                    util: site.util
                });

                var isHovered = hasHover && this._hoverIndex === s;

                // a. Card background
                draw.roundRect(ctx, cx, cy, cw, ch, cardRadius);
                ctx.fillStyle = theme.panelHi;
                ctx.fill();
                if (isHovered) {
                    ctx.strokeStyle = theme.edgeStrong;
                    ctx.lineWidth = 2;
                } else {
                    ctx.strokeStyle = theme.edge;
                    ctx.lineWidth = 1;
                }
                ctx.stroke();

                // b. Site code — top-left
                ctx.font = '700 13px ' + tokens.fonts.mono;
                ctx.fillStyle = theme.text;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                var codeText = draw.ellipsis(ctx, site.code, innerW - dotSize - 6);
                ctx.fillText(codeText, cx + padH, cy + padV);

                // c. Status dot — top-right
                var dotX = cx + cw - padH - dotSize / 2;
                var dotY = cy + padV + 6; // vertically center with code text
                ctx.beginPath();
                ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
                ctx.fillStyle = sColor;
                ctx.fill();

                // d. Site name — below code
                var nameY = cy + padV + 18;
                ctx.font = '500 10.5px ' + tokens.fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                var nameText = draw.ellipsis(ctx, site.name, innerW);
                ctx.fillText(nameText, cx + padH, nameY);

                // e. Utilization bar track — near bottom
                var barY = cy + ch - padV - barHeight - 14;
                // Track
                draw.roundRect(ctx, cx + padH, barY, innerW, barHeight, barRadius);
                ctx.fillStyle = theme.edge;
                ctx.fill();

                // f. Utilization bar fill
                var utilPct = Math.max(0, Math.min(100, site.util));
                var fillW = (utilPct / 100) * innerW;
                if (fillW > 0) {
                    draw.roundRect(ctx, cx + padH, barY, fillW, barHeight, barRadius);
                    ctx.fillStyle = sColor;
                    ctx.fill();
                }

                // g. Utilization label — below bar
                var labelY = barY + barHeight + 3;
                ctx.font = '400 10px ' + tokens.fonts.mono;
                ctx.fillStyle = theme.textFaint;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(Math.round(utilPct) + '% util', cx + padH, labelY);
            }

            // ── Hover tooltip ──
            if (hasHover && this._hoverIndex < this._hitAreas.length) {
                var hit = this._hitAreas[this._hoverIndex];
                var mRect = this.canvas.getBoundingClientRect();
                var lastEvt = this._lastMouseEvent;
                var tooltipMx = hit.x + hit.w / 2;
                var tooltipMy = hit.y + hit.h / 2;
                if (lastEvt) {
                    tooltipMx = lastEvt.clientX - mRect.left;
                    tooltipMy = lastEvt.clientY - mRect.top;
                }

                var hUtilPct = Math.max(0, Math.min(100, hit.util));
                var tooltipLines = [
                    { text: hit.label, bold: true },
                    { text: hit.value, dimmed: true },
                    { text: hit.status || 'unknown', dot: hit.statusColor },
                    { text: Math.round(hUtilPct) + '% utilization', dimmed: true }
                ];
                drawHoverTooltip(ctx, tooltipMx, tooltipMy, tooltipLines, theme, tokens.fonts, w, h);
            }

            // ── Reset state ──
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
