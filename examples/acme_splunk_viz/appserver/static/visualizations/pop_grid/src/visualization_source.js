/*
 * ACME PoP Grid — compact multi-site status grid.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-pop-grid-viz');
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.el.appendChild(this.canvas);
            this._lastGoodData = null;
            this._hitRects = [];

            var self = this;
            this.canvas.addEventListener('click', function (event) {
                var hit = self._findHit(event);
                if (!hit) return;
                event.preventDefault();
                self.drilldown({
                    action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
                    data: hit.payload
                }, event);
            });
            this.canvas.addEventListener('mousemove', function (event) {
                self.canvas.style.cursor = self._findHit(event) ? 'pointer' : 'default';
            });
        },

        _findHit: function (event) {
            if (!this._hitRects || !this._hitRects.length) return null;
            var rect = this.canvas.getBoundingClientRect();
            var x = event.clientX - rect.left;
            var y = event.clientY - rect.top;
            for (var i = 0; i < this._hitRects.length; i++) {
                var r = this._hitRects[i];
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
            }
            return null;
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 10000 };
        },

        formatData: function (data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                return { fields: [], rows: [] };
            }
            var fields = [];
            for (var i = 0; i < data.fields.length; i++) fields.push(data.fields[i].name);
            var result = { fields: fields, rows: data.rows.slice() };
            this._lastGoodData = result;
            return result;
        },

        updateView: function (data, config) {
            if (!data) data = this._lastGoodData || { fields: [], rows: [] };

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = config[ns + 'theme'] || 'dark';
            var t = T.getTheme(themeName);
            var cols = parseInt(config[ns + 'columns'] || '4', 10);
            var codeF = config[ns + 'codeField'] || 'code';
            var nameF = config[ns + 'nameField'] || 'name';
            var statusF = config[ns + 'statusField'] || 'status';
            var utilF = config[ns + 'utilField'] || 'util';
            // Expanded
            var cellRadius = parseFloat(config[ns + 'cellRadius'] || '4');
            var cellPadding = parseInt(config[ns + 'cellPadding'] || '10', 10);
            var gap = parseInt(config[ns + 'gap'] || '10', 10);
            var sidePad = parseInt(config[ns + 'sidePadding'] || '12', 10);
            var sortOrder = config[ns + 'sortOrder'] || 'none';
            var maxCells = parseInt(config[ns + 'maxCells'] || '0', 10);
            var codeFontSize = parseInt(config[ns + 'codeFontSize'] || '13', 10);
            var nameFontSize = parseInt(config[ns + 'nameFontSize'] || '11', 10);
            var utilFontSize = parseInt(config[ns + 'utilFontSize'] || '10', 10);
            var utilBarHeight = parseInt(config[ns + 'utilBarHeight'] || '4', 10);
            var minCellH = parseInt(config[ns + 'minCellHeight'] || '64', 10);
            var maxCellH = parseInt(config[ns + 'maxCellHeight'] || '100', 10);
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var cellBgColor = config[ns + 'cellBgColor'] || '';
            var showStatusDot = String(config[ns + 'showStatusDot'] || 'true') !== 'false';
            var showUtil = String(config[ns + 'showUtil'] || 'true') !== 'false';

            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, rect.width, rect.height);
            this._hitRects = [];
            if (bgColor && bgColor !== 'transparent') { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, rect.width, rect.height); }

            function idx(name) {
                for (var i = 0; i < data.fields.length; i++) if (data.fields[i] === name) return i;
                return -1;
            }
            var iCode = idx(codeF), iName = idx(nameF), iStat = idx(statusF), iUtil = idx(utilF);

            var cells = [];
            for (var r = 0; r < data.rows.length; r++) {
                var row = data.rows[r];
                var code = iCode >= 0 ? String(row[iCode]) : '';
                var name = iName >= 0 ? String(row[iName]) : '';
                var stat = iStat >= 0 ? String(row[iStat]).toLowerCase() : 'ok';
                var util = iUtil >= 0 ? parseFloat(row[iUtil]) : 0;
                if (isNaN(util)) util = 0;
                cells.push({ code: code, name: name, status: stat, util: util });
            }
            if (!cells.length) {
                cells = [
                    { code: 'IAD', name: 'Ashburn', status: 'ok', util: 64 },
                    { code: 'ORD', name: 'Chicago', status: 'ok', util: 48 },
                    { code: 'DFW', name: 'Dallas', status: 'warn', util: 78 },
                    { code: 'SJC', name: 'San Jose', status: 'ok', util: 52 },
                    { code: 'LHR', name: 'London', status: 'ok', util: 61 },
                    { code: 'FRA', name: 'Frankfurt', status: 'warn', util: 82 },
                    { code: 'AMS', name: 'Amsterdam', status: 'ok', util: 44 },
                    { code: 'CDG', name: 'Paris', status: 'ok', util: 55 },
                    { code: 'NRT', name: 'Tokyo', status: 'ok', util: 39 },
                    { code: 'SIN', name: 'Singapore', status: 'warn', util: 71 },
                    { code: 'SYD', name: 'Sydney', status: 'ok', util: 42 },
                    { code: 'HKG', name: 'Hong Kong', status: 'danger', util: 91 },
                    { code: 'GRU', name: 'Sao Paulo', status: 'ok', util: 35 },
                    { code: 'YUL', name: 'Montreal', status: 'ok', util: 48 },
                    { code: 'JNB', name: 'Johannesburg', status: 'ok', util: 29 },
                    { code: 'DXB', name: 'Dubai', status: 'warn', util: 73 }
                ];
            }
            if (sortOrder === 'severity') {
                var rank = { danger: 0, warn: 1, ok: 2 };
                cells.sort(function (a, b) { return (rank[a.status] || 9) - (rank[b.status] || 9); });
            } else if (sortOrder === 'util-desc') {
                cells.sort(function (a, b) { return b.util - a.util; });
            } else if (sortOrder === 'util-asc') {
                cells.sort(function (a, b) { return a.util - b.util; });
            } else if (sortOrder === 'code') {
                cells.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
            }
            if (maxCells > 0) cells = cells.slice(0, maxCells);

            var rowsCount = Math.ceil(cells.length / cols);
            var cellW = (rect.width - sidePad * 2 - gap * (cols - 1)) / cols;
            var cellH = (rect.height - sidePad * 2 - gap * (rowsCount - 1)) / rowsCount;
            cellH = Math.max(minCellH, Math.min(cellH, maxCellH));

            for (var ci = 0; ci < cells.length; ci++) {
                var cc = cells[ci];
                var rIdx = Math.floor(ci / cols);
                var colIdx = ci % cols;
                var cx = sidePad + colIdx * (cellW + gap);
                var cy = sidePad + rIdx * (cellH + gap);

                T.roundRect(ctx, cx, cy, cellW, cellH, cellRadius);
                ctx.fillStyle = cellBgColor || t.panelHi;
                ctx.fill();
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.stroke();
                this._hitRects.push({
                    x: cx, y: cy, w: cellW, h: cellH,
                    payload: { code: cc.code, name: cc.name, status: cc.status }
                });

                var statusColor = T.severityColor(t, cc.status);

                ctx.fillStyle = t.text;
                ctx.font = '700 ' + codeFontSize + 'px ' + T.FONTS.mono;
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.fillText(cc.code, cx + cellPadding, cy + 8);

                if (showStatusDot) {
                    ctx.beginPath();
                    ctx.arc(cx + cellW - cellPadding - 4, cy + 14, 3, 0, Math.PI * 2);
                    ctx.fillStyle = statusColor;
                    ctx.fill();
                }

                ctx.fillStyle = t.textDim;
                ctx.font = '500 ' + nameFontSize + 'px ' + T.FONTS.ui;
                var name2 = cc.name;
                if (ctx.measureText(name2).width > cellW - cellPadding * 2) {
                    while (name2.length > 3 && ctx.measureText(name2 + '…').width > cellW - cellPadding * 2) name2 = name2.slice(0, -1);
                    name2 += '…';
                }
                ctx.fillText(name2, cx + cellPadding, cy + 26);

                if (showUtil) {
                    var trackY = cy + cellH - 22;
                    T.roundRect(ctx, cx + cellPadding, trackY, cellW - cellPadding * 2, utilBarHeight, utilBarHeight / 2);
                    ctx.fillStyle = t.edge;
                    ctx.fill();
                    var fw = Math.min(1, cc.util / 100) * (cellW - cellPadding * 2);
                    if (fw > 0) {
                        T.roundRect(ctx, cx + cellPadding, trackY, Math.max(2, fw), utilBarHeight, utilBarHeight / 2);
                        ctx.fillStyle = statusColor;
                        ctx.fill();
                    }
                    ctx.fillStyle = t.textFaint;
                    ctx.font = '400 ' + utilFontSize + 'px ' + T.FONTS.mono;
                    ctx.fillText(Math.round(cc.util) + '% util', cx + cellPadding, cy + cellH - 14);
                }
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
