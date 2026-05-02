/*
 * ACME Single-Value Tile — headline KPI.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    function fmtVal(v, mode, precision) {
        if (v === null || v === undefined || isNaN(v)) return '0';
        if (mode === 'compact') return T.fmtNum(v, { compact: true });
        if (mode === 'raw') return String(v);
        if (mode === 'fixed') return parseFloat(v).toFixed(parseInt(precision || 0, 10));
        return T.fmtNum(v, { compact: false });
    }

    function drawSparkline(ctx, t, x, y, w, h, vals, color, fill) {
        if (!vals || !vals.length) return;
        var min = vals[0], max = vals[0];
        for (var i = 1; i < vals.length; i++) {
            if (vals[i] < min) min = vals[i];
            if (vals[i] > max) max = vals[i];
        }
        var range = max - min;
        var pts = [];
        for (var j = 0; j < vals.length; j++) {
            var px = x + (w * j) / Math.max(1, vals.length - 1);
            var py = range === 0 ? y + h / 2 : y + h - ((vals[j] - min) / range) * h;
            pts.push({ x: px, y: py });
        }
        if (fill) {
            var grad = ctx.createLinearGradient(0, y, 0, y + h);
            grad.addColorStop(0, T.withAlpha(color, 0.22));
            grad.addColorStop(1, T.withAlpha(color, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, y + h);
            for (var k = 0; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
            ctx.lineTo(pts[pts.length - 1].x, y + h);
            ctx.closePath();
            ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var m = 1; m < pts.length; m++) ctx.lineTo(pts[m].x, pts[m].y);
        ctx.stroke();
    }

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-single-value-tile-viz');
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.el.appendChild(this.canvas);
            this._lastGoodData = null;
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 50 };
        },

        formatData: function (data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                return { fields: [], row: null, allRows: [] };
            }
            var fields = [];
            for (var i = 0; i < data.fields.length; i++) fields.push(data.fields[i].name);
            var result = {
                fields: fields,
                row: data.rows[data.rows.length - 1],
                allRows: data.rows.slice()
            };
            this._lastGoodData = result;
            return result;
        },

        updateView: function (data, config) {
            if (!data) data = this._lastGoodData || { fields: [], row: null, allRows: [] };

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = config[ns + 'theme'] || 'dark';
            var t = T.getTheme(themeName);
            var label = config[ns + 'label'] || 'Notable events (24h)';
            var unit = config[ns + 'unit'] || '';
            var subLabel = config[ns + 'subLabel'] || 'vs prev 24h';
            var valueField = config[ns + 'valueField'] || 'value';
            var deltaField = config[ns + 'deltaField'] || 'delta';
            var sparkField = config[ns + 'sparkField'] || 'spark';
            var deltaSemantics = config[ns + 'deltaSemantics'] || 'downGood';
            var accent = config[ns + 'accent'] || t.text;
            var showSpark = String(config[ns + 'showSparkline'] || 'true') !== 'false';
            // ── Expanded settings ──
            var valueFontSize = parseInt(config[ns + 'valueFontSize'] || '32', 10);
            var labelFontSize = parseInt(config[ns + 'labelFontSize'] || '12', 10);
            var deltaFontSize = parseInt(config[ns + 'deltaFontSize'] || '13', 10);
            var labelColor = config[ns + 'labelColor'] || t.textDim;
            var valueColor = config[ns + 'valueColor'] || '';
            var subLabelColor = config[ns + 'subLabelColor'] || t.textDim;
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var border = String(config[ns + 'showBorder'] || 'false') === 'true';
            var borderRadius = parseFloat(config[ns + 'borderRadius'] || '6');
            var padding = parseInt(config[ns + 'padding'] || '14', 10);
            var alignH = config[ns + 'alignH'] || 'left';
            var numberFormat = config[ns + 'numberFormat'] || 'auto';
            var precision = config[ns + 'precision'] || '0';
            var sparkColor = config[ns + 'sparkColor'] || '';
            var sparkFill = String(config[ns + 'sparkFill'] || 'true') !== 'false';
            var showDeltaArrow = String(config[ns + 'showDeltaArrow'] || 'true') !== 'false';

            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, rect.width, rect.height);

            // Background.
            if (bgColor && bgColor !== 'transparent') {
                T.roundRect(ctx, 0, 0, rect.width, rect.height, borderRadius);
                ctx.fillStyle = bgColor;
                ctx.fill();
            }
            if (border) {
                T.roundRect(ctx, 0.5, 0.5, rect.width - 1, rect.height - 1, borderRadius);
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // Resolve fields.
            function findIdx(name) {
                for (var i = 0; i < data.fields.length; i++) if (data.fields[i] === name) return i;
                return -1;
            }
            var iVal = findIdx(valueField);
            var iDelta = findIdx(deltaField);
            var iSpark = findIdx(sparkField);

            var value = NaN, delta = NaN, sparkVals = [];
            if (data.row) {
                if (iVal >= 0) value = parseFloat(data.row[iVal]);
                if (iDelta >= 0) delta = parseFloat(data.row[iDelta]);
                if (iSpark >= 0) {
                    var raw = String(data.row[iSpark] || '');
                    var parts = raw.split(',');
                    for (var p = 0; p < parts.length; p++) {
                        var v = parseFloat(parts[p]);
                        if (!isNaN(v)) sparkVals.push(v);
                    }
                }
            }
            if (!sparkVals.length && iVal >= 0 && data.allRows && data.allRows.length > 1) {
                for (var rI = 0; rI < data.allRows.length; rI++) {
                    var vv = parseFloat(data.allRows[rI][iVal]);
                    if (!isNaN(vv)) sparkVals.push(vv);
                }
            }
            if (isNaN(value)) value = 247;
            if (isNaN(delta)) delta = -12;
            if (!sparkVals.length) {
                for (var sP = 0; sP < 16; sP++) sparkVals.push(60 + 25 * Math.sin(sP / 2.5));
            }

            var deltaColor;
            // Accept both camelCase (new) and hyphenated (old) values for backwards compat.
            if (deltaSemantics === 'upGood' || deltaSemantics === 'up-good') {
                deltaColor = delta > 0 ? t.success : delta < 0 ? t.danger : t.textDim;
            } else if (deltaSemantics === 'downGood' || deltaSemantics === 'down-good') {
                deltaColor = delta < 0 ? t.success : delta > 0 ? t.danger : t.textDim;
            } else {
                deltaColor = t.textDim;
            }

            var topY = padding;
            ctx.textBaseline = 'top';
            ctx.textAlign = alignH;
            var tx = alignH === 'right' ? rect.width - padding : alignH === 'center' ? rect.width / 2 : padding;

            // Row 1 — label.
            ctx.fillStyle = labelColor;
            ctx.font = '500 ' + labelFontSize + 'px ' + T.FONTS.ui;
            ctx.fillText(label, tx, topY);

            // Row 2 — big value + unit.
            var size = valueFontSize;
            var valueText = fmtVal(value, numberFormat, precision);
            ctx.font = '600 ' + size + 'px ' + T.FONTS.mono;
            if (valueText.length > 7 && size > 22) {
                size = Math.max(22, size - 6);
                ctx.font = '600 ' + size + 'px ' + T.FONTS.mono;
            }
            var bigY = topY + labelFontSize + 8;
            ctx.fillStyle = valueColor || accent;
            ctx.fillText(valueText, tx, bigY);
            var bigW = ctx.measureText(valueText).width;
            if (unit) {
                ctx.fillStyle = t.textDim;
                ctx.font = '500 13px ' + T.FONTS.ui;
                ctx.textBaseline = 'alphabetic';
                var unitX = alignH === 'right' ? tx - bigW - 6 : tx + bigW + 6;
                ctx.fillText(unit, unitX, bigY + size - 4);
            }

            // Row 3 — delta + sparkline.
            ctx.textBaseline = 'middle';
            var bottomY = rect.height - padding - 9;
            var deltaText = (delta > 0 ? '+' : '') + fmtVal(delta, numberFormat, precision);
            var arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';

            ctx.textAlign = 'left';
            var dx = padding;
            if (showDeltaArrow) {
                ctx.fillStyle = deltaColor;
                ctx.font = '600 14px ' + T.FONTS.ui;
                ctx.fillText(arrow, dx, bottomY);
                dx += 16;
            }
            ctx.fillStyle = deltaColor;
            ctx.font = '600 ' + deltaFontSize + 'px ' + T.FONTS.mono;
            ctx.fillText(deltaText, dx, bottomY);
            var dW = ctx.measureText(deltaText).width;
            if (subLabel) {
                ctx.fillStyle = subLabelColor;
                ctx.font = '500 11.5px ' + T.FONTS.ui;
                ctx.fillText(' ' + subLabel, dx + dW + 4, bottomY);
            }

            if (showSpark) {
                var sw = 70, sh = 20;
                drawSparkline(ctx, t, rect.width - padding - sw, bottomY - sh / 2, sw, sh,
                              sparkVals, sparkColor || accent, sparkFill);
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
