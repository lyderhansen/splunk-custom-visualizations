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

    function parseBool(val, fb) {
        if (val === undefined || val === null) return fb;
        return val === 'true' || val === true;
    }

    var PODIUM_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

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
                count: 10000
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

            var posField = getOption(config, ns, 'positionField', 'position');
            var nameField = getOption(config, ns, 'nameField', 'name');
            var gapField = getOption(config, ns, 'gapField', 'gap');
            var changeField = getOption(config, ns, 'changeField', 'change');
            var carNumField = getOption(config, ns, 'carNumberField', 'car_number');
            var highlightField = getOption(config, ns, 'highlightField', 'highlight');
            var maxRows = parseInt(getOption(config, ns, 'maxRows', '20'), 10);
            var showGap = parseBool(getOption(config, ns, 'showGap', 'true'), true);
            var showChange = parseBool(getOption(config, ns, 'showChange', 'true'), true);

            var colIdx = data.colIdx;
            var rows = data.rows;
            var count = Math.min(rows.length, maxRows);

            var pad = Math.max(8, w * 0.03);
            var headerH = 22;
            var rowH = Math.max(22, Math.min(32, (h - headerH - pad) / count));

            // Column widths
            var posW = 36;
            var changeW = showChange ? 28 : 0;
            var gapW = showGap ? Math.max(60, w * 0.25) : 0;
            var nameW = w - pad * 2 - posW - gapW - changeW - 4;

            // Header
            var hFontSize = Math.max(8, Math.min(11, h * 0.025));
            ctx.font = hFontSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textFaint;
            ctx.textBaseline = 'bottom';
            var headerY = headerH;

            ctx.textAlign = 'left';
            ctx.fillText('POS', pad, headerY - 4);
            ctx.fillText('DRIVER', pad + posW + 4, headerY - 4);
            if (showGap) {
                ctx.textAlign = 'right';
                ctx.fillText('GAP', w - pad - changeW, headerY - 4);
            }
            if (showChange) {
                ctx.textAlign = 'center';
                ctx.fillText('±', w - pad - changeW / 2, headerY - 4);
            }

            // Header underline
            ctx.strokeStyle = t.edge;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pad, headerY - 0.5);
            ctx.lineTo(w - pad, headerY - 0.5);
            ctx.stroke();

            this._hitRegions = [];

            var posFontSize = Math.max(12, Math.min(16, rowH * 0.5));
            var nameFontSize = Math.max(11, Math.min(14, rowH * 0.45));
            var gapFontSize = Math.max(11, Math.min(14, rowH * 0.45));

            for (var i = 0; i < count; i++) {
                var row = rows[i];
                var pos = colIdx[posField] !== undefined ? parseInt(row[colIdx[posField]], 10) : i + 1;
                var name = colIdx[nameField] !== undefined ? String(row[colIdx[nameField]]) : '';
                var gap = colIdx[gapField] !== undefined ? String(row[colIdx[gapField]]) : '';
                var change = colIdx[changeField] !== undefined ? parseInt(row[colIdx[changeField]], 10) : 0;
                var carNum = colIdx[carNumField] !== undefined ? String(row[colIdx[carNumField]]) : '';
                var isHighlight = colIdx[highlightField] !== undefined &&
                    (row[colIdx[highlightField]] === 'true' || row[colIdx[highlightField]] === true || row[colIdx[highlightField]] === '1');

                var ry = headerH + i * rowH;

                // Hover highlight
                if (this._hoverIdx === i) {
                    ctx.fillStyle = theme.withAlpha(t.accent, 0.08);
                    ctx.fillRect(pad, ry, w - pad * 2, rowH);
                }

                // Highlighted row (our car) — Guards Red left border
                if (isHighlight) {
                    ctx.fillStyle = t.panelHi;
                    ctx.fillRect(pad, ry, w - pad * 2, rowH);
                    ctx.fillStyle = t.guardsRed;
                    ctx.fillRect(pad, ry, 4, rowH);
                }

                // Podium accent bar (P1-P3)
                if (pos >= 1 && pos <= 3) {
                    ctx.fillStyle = theme.withAlpha(PODIUM_COLORS[pos - 1], 0.15);
                    ctx.fillRect(pad, ry, 3, rowH);
                }

                var textY = ry + rowH / 2;

                // Position number
                ctx.font = 'bold ' + posFontSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = (pos >= 1 && pos <= 3) ? PODIUM_COLORS[pos - 1] : t.text;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(pos), pad + posW / 2, textY);

                // Driver name
                ctx.font = nameFontSize + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = isHighlight ? t.text : t.text;
                ctx.textAlign = 'left';
                ctx.fillText(name, pad + posW + 4, textY);

                // Gap
                if (showGap) {
                    ctx.font = gapFontSize + 'px ' + theme.FONTS.mono;
                    var isLeader = gap.toUpperCase() === 'LEADER' || pos === 1;
                    ctx.fillStyle = isLeader ? t.accent : t.textDim;
                    ctx.textAlign = 'right';
                    ctx.fillText(isLeader ? 'LEADER' : gap, w - pad - changeW - 4, textY);
                }

                // Change arrow
                if (showChange && change !== 0) {
                    var arrowSize = Math.max(6, rowH * 0.2);
                    var arrowX = w - pad - changeW / 2;
                    var arrowY = textY;

                    if (change > 0) {
                        ctx.fillStyle = t.success;
                        ctx.beginPath();
                        ctx.moveTo(arrowX, arrowY + arrowSize / 2);
                        ctx.lineTo(arrowX - arrowSize / 2, arrowY - arrowSize / 2 + 2);
                        ctx.lineTo(arrowX + arrowSize / 2, arrowY - arrowSize / 2 + 2);
                        ctx.closePath();
                        ctx.fill();
                    } else {
                        ctx.fillStyle = t.danger;
                        ctx.beginPath();
                        ctx.moveTo(arrowX, arrowY - arrowSize / 2);
                        ctx.lineTo(arrowX - arrowSize / 2, arrowY + arrowSize / 2 - 2);
                        ctx.lineTo(arrowX + arrowSize / 2, arrowY + arrowSize / 2 - 2);
                        ctx.closePath();
                        ctx.fill();
                    }
                } else if (showChange) {
                    ctx.font = gapFontSize + 'px ' + theme.FONTS.mono;
                    ctx.fillStyle = t.textFaint;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('–', w - pad - changeW / 2, textY);
                }

                // Row separator
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(pad, ry + rowH - 0.5);
                ctx.lineTo(w - pad, ry + rowH - 0.5);
                ctx.stroke();

                // Change text for tooltip
                var changeText = change > 0 ? '▲' + change : (change < 0 ? '▼' + Math.abs(change) : '–');

                this._hitRegions.push({
                    x: pad, y: ry, w: w - pad * 2, h: rowH,
                    tip: (carNum ? '#' + carNum + ' ' : '') + '<b>' + name + '</b> | P' + pos +
                         (showGap ? ' | Gap: ' + gap : '') +
                         (showChange ? ' | ' + changeText : '')
                });
            }
        },

        _onMouseMove: function(e) {
            var rect = this.canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;
            var hit = this._hitTest(mx, my);
            if (hit !== null) {
                var region = this._hitRegions[hit];
                this._tooltip.innerHTML = region.tip;
                this._tooltip.style.display = 'block';
                var tx = mx + 14;
                var ty = my - 10;
                if (tx + 220 > this.el.offsetWidth) tx = mx - 220;
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
                if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i;
            }
            return null;
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
