/*
 * Disney+ Data Table — Splunk Custom Visualization
 *
 * Branded table with franchise-colored category badges, alternating
 * row backgrounds, and Disney+ themed header.
 *
 * Expected SPL: | table Title Category WatchHours CompletionRate
 * Any field named "Category" gets a colored badge.
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

    var FRANCHISE_COLORS = {
        'drama': '#E50914',
        'comedy': '#46D369',
        'thriller': '#FFB53E',
        'documentary': '#1A91A8',
        'action': '#FF3D47',
        'sci-fi': '#9B59B6',
        'romance': '#E91E8C',
        'horror': '#8B0000',
        'anime': '#00D4FF',
        'kids': '#FFD93D',
        'reality': '#FF6B35',
        'crime': '#B20710'
    };

    function franchiseColor(cat) {
        var key = (cat || '').toLowerCase();
        return FRANCHISE_COLORS[key] || '#6B7280';
    }

    function fitText(ctx, text, maxWidth) {
        var measured = ctx.measureText(text);
        if (measured.width <= maxWidth) return text;
        while (ctx.measureText(text + '...').width > maxWidth && text.length > 0) {
            text = text.substring(0, text.length - 1);
        }
        return text + '...';
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
                    'Awaiting data — Disney+ Table'
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
            var title = getOption(config, ns, 'title', '');
            var badgeField = getOption(config, ns, 'badgeField', 'Category');
            var maxRows = parseInt(getOption(config, ns, 'maxRows', '10'), 10);

            var fields = data.fields;
            var rows = data.rows;
            var numCols = fields.length;
            var numRows = Math.min(rows.length, maxRows);

            // Panel chrome
            theme.drawPanel(ctx, t, 0, 0, w, h);

            // Layout
            var padX = 16;
            var titleH = title ? 32 : 8;
            var headerH = 36;
            var rowH = Math.max(28, Math.min(40, (h - titleH - headerH - 8) / numRows));
            var colW = (w - padX * 2) / numCols;
            var fontSize = Math.max(9, Math.min(13, rowH * 0.38));
            var headerFontSize = Math.max(9, Math.min(12, rowH * 0.32));

            // Find badge column index
            var badgeColIdx = -1;
            for (var bi = 0; bi < fields.length; bi++) {
                if (fields[bi].name === badgeField) {
                    badgeColIdx = bi;
                    break;
                }
            }

            // Title
            if (title) {
                ctx.font = 'bold 14px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(title, padX, 10);
            }

            // Header row
            var headerY = titleH;
            ctx.fillStyle = theme.withAlpha(t.accent, 0.15);
            ctx.fillRect(padX, headerY, w - padX * 2, headerH);

            // Header accent line
            ctx.fillStyle = t.accent;
            ctx.fillRect(padX, headerY, w - padX * 2, 2);

            ctx.font = 'bold ' + headerFontSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.text;
            ctx.textBaseline = 'middle';
            for (var ci = 0; ci < numCols; ci++) {
                var hx = padX + ci * colW + 12;
                ctx.textAlign = 'left';
                ctx.fillText(fields[ci].name, hx, headerY + headerH / 2);
            }

            // Data rows
            var startY = headerY + headerH;
            for (var ri = 0; ri < numRows; ri++) {
                var ry = startY + ri * rowH;

                // Alternating row bg
                if (ri % 2 === 0) {
                    ctx.fillStyle = theme.withAlpha(t.panelHi, 0.3);
                    ctx.fillRect(padX, ry, w - padX * 2, rowH);
                }

                // Row separator
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(padX, Math.round(ry + rowH) + 0.5);
                ctx.lineTo(w - padX, Math.round(ry + rowH) + 0.5);
                ctx.stroke();

                for (var col = 0; col < numCols; col++) {
                    var cx = padX + col * colW + 12;
                    var cellVal = String(rows[ri][col] || '');
                    var cellY = ry + rowH / 2;

                    if (col === badgeColIdx) {
                        // Franchise-colored badge
                        var badgeColor = franchiseColor(cellVal);
                        var badgeW = Math.min(colW - 24, ctx.measureText(cellVal).width + 20);
                        var badgeH = rowH * 0.6;
                        var badgeY = cellY - badgeH / 2;

                        ctx.save();
                        theme.roundRect(ctx, cx - 4, badgeY, badgeW, badgeH, badgeH / 2);
                        ctx.fillStyle = theme.withAlpha(badgeColor, 0.2);
                        ctx.fill();
                        ctx.strokeStyle = theme.withAlpha(badgeColor, 0.6);
                        ctx.lineWidth = 1;
                        ctx.stroke();
                        ctx.restore();

                        ctx.font = fontSize + 'px ' + theme.FONTS.ui;
                        ctx.fillStyle = badgeColor;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(cellVal, cx + 6, cellY);
                    } else {
                        ctx.font = fontSize + 'px ' + theme.FONTS.ui;
                        ctx.fillStyle = col === 0 ? t.text : t.textDim;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        var fitted = fitText(ctx, cellVal, colW - 24);
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
