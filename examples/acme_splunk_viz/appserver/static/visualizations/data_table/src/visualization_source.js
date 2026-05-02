/*
 * ACME Data Table — column-typed structured rows.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    function parseColumns(raw) {
        if (!raw) return [];
        var parts = String(raw).split(',');
        var cols = [];
        for (var i = 0; i < parts.length; i++) {
            var seg = parts[i].trim();
            if (!seg) continue;
            var b = seg.split(':');
            if (b.length < 3) continue;
            var width = b[3] || 'flex';
            cols.push({
                key: b[0].trim(),
                label: b[1].trim(),
                type: (b[2] || 'text').trim().toLowerCase(),
                width: width,
                align: (b[4] || (b[2].trim() === 'number' ? 'right' : 'left')).trim().toLowerCase()
            });
        }
        return cols;
    }

    function severityLabel(s) {
        s = String(s).toLowerCase();
        if (s === 'crit' || s === 'critical') return 'Crit';
        if (s === 'high') return 'High';
        if (s === 'med' || s === 'medium') return 'Med';
        if (s === 'low') return 'Low';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function drawSpark(ctx, t, x, y, w, h, vals, color) {
        if (!vals || !vals.length) return;
        var min = vals[0], max = vals[0];
        for (var i = 1; i < vals.length; i++) {
            if (vals[i] < min) min = vals[i];
            if (vals[i] > max) max = vals[i];
        }
        var range = max - min;
        ctx.strokeStyle = color || t.s2;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (var j = 0; j < vals.length; j++) {
            var px = x + (w * j) / Math.max(1, vals.length - 1);
            var py = range === 0 ? y + h / 2 : y + h - ((vals[j] - min) / range) * h;
            if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-data-table-viz');
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.el.appendChild(this.canvas);
            this._lastGoodData = null;
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
            var columnsRaw = config[ns + 'columns'] ||
                'severity:Severity:badge:90,event:Event:text:flex,source:Source:mono:160,time:Time:text:120:right';
            var maxRows = parseInt(config[ns + 'maxRows'] || '50', 10);
            var errThreshold = parseFloat(config[ns + 'errorThreshold'] || '1.0');
            // Expanded
            var rowHeight = parseInt(config[ns + 'rowHeight'] || '32', 10);
            var headerHeight = parseInt(config[ns + 'headerHeight'] || '28', 10);
            var fontSize = parseInt(config[ns + 'fontSize'] || '12', 10);
            var headerFontSize = parseInt(config[ns + 'headerFontSize'] || '11', 10);
            var sidePadding = parseInt(config[ns + 'sidePadding'] || '14', 10);
            var alternatingRow = String(config[ns + 'alternatingRow'] || 'false') === 'true';
            var altRowColor = config[ns + 'altRowColor'] || '';
            var headerColor = config[ns + 'headerColor'] || t.textFaint;
            var headerBgColor = config[ns + 'headerBgColor'] || 'transparent';
            var rowBorderColor = config[ns + 'rowBorderColor'] || '';
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var sortColIdx = parseInt(config[ns + 'sortColIdx'] || '-1', 10);
            var sortDir = config[ns + 'sortDir'] || 'desc';
            var showRowBorders = String(config[ns + 'showRowBorders'] || 'true') !== 'false';

            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, rect.width, rect.height);
            if (bgColor && bgColor !== 'transparent') { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, rect.width, rect.height); }

            var cols = parseColumns(columnsRaw);
            if (!cols.length) return;

            var fields = data.fields;
            var rows = data.rows.slice();
            if (!rows.length) {
                fields = ['severity', 'event', 'source', 'time'];
                rows = [
                    ['high', 'Brute force on web-prod-03', 'auth_combined', '2m ago'],
                    ['crit', 'Suspicious data egress', 'netflow', '5m ago'],
                    ['med', 'DNS tunnelling', 'dns', '14m ago'],
                    ['low', 'Anomalous login from new geo', 'okta', '22m ago'],
                    ['med', 'Malware artifact in upload', 'edr', '38m ago']
                ];
            }
            for (var c = 0; c < cols.length; c++) {
                cols[c].fieldIdx = -1;
                for (var f = 0; f < fields.length; f++) {
                    if (fields[f] === cols[c].key) { cols[c].fieldIdx = f; break; }
                }
            }

            // Sort.
            if (sortColIdx >= 0 && sortColIdx < cols.length) {
                var sortIdx = cols[sortColIdx].fieldIdx;
                if (sortIdx >= 0) {
                    rows.sort(function (a, b) {
                        var av = a[sortIdx], bv = b[sortIdx];
                        var anum = parseFloat(av), bnum = parseFloat(bv);
                        if (!isNaN(anum) && !isNaN(bnum)) {
                            return sortDir === 'desc' ? bnum - anum : anum - bnum;
                        }
                        var as = String(av || ''), bs = String(bv || '');
                        return sortDir === 'desc' ? bs.localeCompare(as) : as.localeCompare(bs);
                    });
                }
            }

            var availW = rect.width - sidePadding * 2;
            var fixedW = 0, flexCount = 0;
            for (var i = 0; i < cols.length; i++) {
                if (cols[i].width === 'flex') flexCount++;
                else fixedW += parseFloat(cols[i].width);
            }
            var perFlex = flexCount ? (availW - fixedW - 12 * (cols.length - 1)) / flexCount : 0;
            var x = sidePadding;
            for (var ii = 0; ii < cols.length; ii++) {
                cols[ii]._w = cols[ii].width === 'flex' ? perFlex : parseFloat(cols[ii].width);
                cols[ii]._x = x;
                x += cols[ii]._w + 12;
            }

            // Header background.
            if (headerBgColor && headerBgColor !== 'transparent') {
                ctx.fillStyle = headerBgColor;
                ctx.fillRect(0, 0, rect.width, headerHeight);
            }

            var hy = (headerHeight - headerFontSize) / 2;
            ctx.fillStyle = headerColor;
            ctx.font = '600 ' + headerFontSize + 'px ' + T.FONTS.ui;
            ctx.textBaseline = 'middle';
            for (var hi = 0; hi < cols.length; hi++) {
                var col = cols[hi];
                ctx.textAlign = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left';
                var tx = col.align === 'right' ? col._x + col._w
                       : col.align === 'center' ? col._x + col._w / 2
                       : col._x;
                ctx.fillText(col.label.toUpperCase(), tx, headerHeight / 2);
            }

            ctx.strokeStyle = rowBorderColor || t.edge;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sidePadding, headerHeight);
            ctx.lineTo(rect.width - sidePadding, headerHeight);
            ctx.stroke();

            var bodyY0 = headerHeight + 2;
            var maxVisible = Math.min(maxRows, rows.length, Math.floor((rect.height - bodyY0) / rowHeight));

            for (var r = 0; r < maxVisible; r++) {
                var row = rows[r];
                var ry = bodyY0 + r * rowHeight + rowHeight / 2;

                if (alternatingRow && r % 2 === 1) {
                    ctx.fillStyle = altRowColor || T.withAlpha(t.text, 0.025);
                    ctx.fillRect(sidePadding - 2, bodyY0 + r * rowHeight, availW + 4, rowHeight);
                }

                for (var ck = 0; ck < cols.length; ck++) {
                    var col2 = cols[ck];
                    var raw = col2.fieldIdx >= 0 ? row[col2.fieldIdx] : '';
                    if (raw === undefined || raw === null) raw = '';

                    if (col2.type === 'badge') {
                        var bgColor2 = T.severityColor(t, raw);
                        var labelText = severityLabel(raw);
                        ctx.font = '600 11px ' + T.FONTS.ui;
                        var bw = Math.min(col2._w, ctx.measureText(labelText).width + 18);
                        T.roundRect(ctx, col2._x, ry - 10, bw, 20, 3);
                        ctx.fillStyle = bgColor2;
                        ctx.fill();
                        ctx.fillStyle = '#ffffff';
                        ctx.textAlign = 'center';
                        ctx.fillText(labelText, col2._x + bw / 2, ry);
                    } else if (col2.type === 'chip') {
                        var col2Color = T.severityColor(t, raw);
                        var labelText2 = String(raw);
                        ctx.font = '500 ' + fontSize + 'px ' + T.FONTS.ui;
                        var cw = Math.min(col2._w, ctx.measureText(labelText2).width + 20);
                        T.roundRect(ctx, col2._x, ry - 10, cw, 20, 3);
                        ctx.fillStyle = T.withAlpha(col2Color, 0.13);
                        ctx.fill();
                        ctx.fillStyle = col2Color;
                        ctx.beginPath();
                        ctx.arc(col2._x + 8, ry, 3, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.textAlign = 'left';
                        ctx.fillText(labelText2, col2._x + 16, ry);
                    } else if (col2.type === 'sparkline') {
                        var vs = String(raw).split(',').map(parseFloat).filter(function (x) { return !isNaN(x); });
                        drawSpark(ctx, t, col2._x + 4, ry - 8, col2._w - 8, 16, vs, t.s2);
                    } else {
                        var isNum = (col2.type === 'number');
                        var text = String(raw);
                        if (col2.type === 'number') {
                            var nv = parseFloat(raw);
                            if (!isNaN(nv)) text = T.fmtNum(nv, { compact: true });
                        }
                        var col2Style = t.text;
                        if (isNum && col2.key && col2.key.toLowerCase().indexOf('err') !== -1) {
                            var nv2 = parseFloat(raw);
                            if (!isNaN(nv2)) col2Style = (nv2 > errThreshold) ? t.danger : t.textDim;
                        }
                        ctx.fillStyle = col2.type === 'mono' ? t.textDim : col2Style;
                        ctx.font = (col2.type === 'mono' ? '500 ' + (fontSize - 1) + 'px ' + T.FONTS.mono
                                  : col2.type === 'number' ? '500 ' + fontSize + 'px ' + T.FONTS.mono
                                  : '500 ' + fontSize + 'px ' + T.FONTS.ui);
                        ctx.textAlign = col2.align === 'right' ? 'right' : col2.align === 'center' ? 'center' : 'left';
                        var tx2 = col2.align === 'right' ? col2._x + col2._w
                                : col2.align === 'center' ? col2._x + col2._w / 2
                                : col2._x;
                        if (ctx.measureText(text).width > col2._w - 6 && ctx.textAlign === 'left') {
                            while (text.length > 3 && ctx.measureText(text + '…').width > col2._w - 6) text = text.slice(0, -1);
                            text += '…';
                        }
                        ctx.fillText(text, tx2, ry);
                    }
                }

                if (showRowBorders) {
                    ctx.strokeStyle = rowBorderColor || t.edge;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(sidePadding, bodyY0 + (r + 1) * rowHeight);
                    ctx.lineTo(rect.width - sidePadding, bodyY0 + (r + 1) * rowHeight);
                    ctx.stroke();
                }
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
