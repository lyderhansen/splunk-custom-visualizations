/*
 * Single Value Tile — Splunk Custom Visualization
 *
 * Headline KPI tile. Renders a 3-row layout:
 *   1. Small label (e.g. "Notable events (24h)")
 *   2. Big number + optional unit (e.g. "247.1 ms")
 *   3. Trend delta with arrow glyph + optional sparkline
 *
 * Expected SPL columns: label, value, unit, delta, deltaDir, sparkline
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {


    // ── Arrow glyph lookup ────────────────────────────────────────

    function arrowGlyph(dir) {
        var d = String(dir).toLowerCase();
        if (d === 'up') return '↑';
        if (d === 'down') return '↓';
        return '→';
    }

    // ── Delta semantic color ──────────────────────────────────────

    function deltaColor(dir, semantics, theme) {
        var d = String(dir).toLowerCase();
        if (semantics === 'neutral') return theme.textDim;
        var isUp = d === 'up';
        if (semantics === 'up-good') {
            return isUp ? theme.success : theme.danger;
        }
        // down-good
        return isUp ? theme.danger : theme.success;
    }

    // ── Parse sparkline string into numeric array ─────────────────

    function parseSparkline(raw) {
        if (!raw) return null;
        var parts = String(raw).split(',');
        var nums = [];
        for (var i = 0; i < parts.length; i++) {
            var v = parseFloat(parts[i]);
            if (!isNaN(v)) nums.push(v);
        }
        return nums.length >= 2 ? nums : null;
    }

    // ── Draw sparkline polyline ───────────────────────────────────

    function drawSparkline(ctx, points, x, y, w, h, strokeColor, fillColor) {
        if (!points || points.length < 2) return null;

        var minV = points[0];
        var maxV = points[0];
        for (var i = 1; i < points.length; i++) {
            if (points[i] < minV) minV = points[i];
            if (points[i] > maxV) maxV = points[i];
        }
        var range = maxV - minV || 1;
        var padV = range * 0.1;
        minV -= padV;
        range += padV * 2;

        var stepX = w / (points.length - 1);
        var canvasPoints = [];

        // Fill area
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        for (var j = 0; j < points.length; j++) {
            var px = x + j * stepX;
            var py = y + h - ((points[j] - minV) / range) * h;
            ctx.lineTo(px, py);
            canvasPoints.push({x: px, y: py, val: points[j]});
        }
        ctx.lineTo(x + (points.length - 1) * stepX, y + h);
        ctx.closePath();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Stroke line
        ctx.beginPath();
        for (var k = 0; k < points.length; k++) {
            var sx = x + k * stepX;
            var sy = y + h - ((points[k] - minV) / range) * h;
            if (k === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        return canvasPoints;
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('single-value-tile-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;

            this._sparkHoverX = -1;
            this._sparkPoints = [];
            this._sparkBounds = null;
            var self = this;
            this.canvas.addEventListener('mousemove', function(e) {
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                var b = self._sparkBounds;
                var newX = -1;
                if (b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h && self._sparkPoints.length > 1) {
                    var closest = -1;
                    var minDist = 999;
                    for (var i = 0; i < self._sparkPoints.length; i++) {
                        var d = Math.abs(mx - self._sparkPoints[i].x);
                        if (d < minDist) { minDist = d; closest = i; }
                    }
                    newX = closest;
                }
                if (newX !== self._sparkHoverX) {
                    self._sparkHoverX = newX;
                    self.invalidateUpdateView();
                }
            });
            this.canvas.addEventListener('mouseleave', function() {
                if (self._sparkHoverX !== -1) { self._sparkHoverX = -1; self.invalidateUpdateView(); }
            });
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 50
            };
        },

        formatData: function(data, config) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Single Value Tile'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            if (colIdx._status !== undefined) {
                var statusRow = data.rows[data.rows.length - 1];
                var statusVal = statusRow[colIdx._status];
                if (statusVal) {
                    return { _status: statusVal };
                }
            }

            var row = data.rows[data.rows.length - 1];
            var result = { colIdx: colIdx, row: row };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (data && data._status) {
                this._ensureCanvas();
                this._drawStatusMessage(data._status);
                return;
            }

            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            // ── Read settings ──
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName      = (config[ns + 'theme'] || 'dark');
            var labelField     = (config[ns + 'labelField'] || 'label');
            var valueField     = (config[ns + 'valueField'] || 'value');
            var unitField      = (config[ns + 'unitField'] || 'unit');
            var deltaField     = (config[ns + 'deltaField'] || 'delta');
            var deltaDirField  = (config[ns + 'deltaDirField'] || 'deltaDir');
            var deltaSemantics = (config[ns + 'deltaSemantics'] || 'up-good');
            var showSparkline  = (config[ns + 'showSparkline'] || 'true') === 'true';
            var sparklineField = (config[ns + 'sparklineField'] || 'sparkline');
            var accentColor    = (config[ns + 'accentColor'] || '#e5eaf2');
            var deltaSubLabel  = (config[ns + 'deltaSubLabel'] || 'vs prev 24h');

            var theme = tokens.getTheme(themeName);

            // ── Extract data ──
            var labelText = '';
            var valueText = '';
            var unitText = '';
            var deltaText = '';
            var deltaDirText = '';
            var sparklineRaw = '';

            if (data.colIdx[labelField] !== undefined) {
                labelText = String(data.row[data.colIdx[labelField]] || '');
            }
            if (data.colIdx[valueField] !== undefined) {
                valueText = String(data.row[data.colIdx[valueField]] || '');
            }
            if (data.colIdx[unitField] !== undefined) {
                unitText = String(data.row[data.colIdx[unitField]] || '');
            }
            if (data.colIdx[deltaField] !== undefined) {
                deltaText = String(data.row[data.colIdx[deltaField]] || '');
            }
            if (data.colIdx[deltaDirField] !== undefined) {
                deltaDirText = String(data.row[data.colIdx[deltaDirField]] || '');
            }
            if (data.colIdx[sparklineField] !== undefined) {
                sparklineRaw = String(data.row[data.colIdx[sparklineField]] || '');
            }

            var sparklinePoints = showSparkline ? parseSparkline(sparklineRaw) : null;
            var hasDelta = deltaText.length > 0;

            // Format value for display
            var numericVal = parseFloat(valueText);
            var displayValue = valueText;
            if (!isNaN(numericVal)) {
                displayValue = draw.formatNumber(numericVal);
            }

            // ── Size canvas ──
            var el = this.el;
            var rect = el.getBoundingClientRect();
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
            this._sparkPoints = [];
            this._sparkBounds = null;

            // ── Layout ──
            var padX = Math.max(12, w * 0.06);
            var padY = Math.max(8, h * 0.08);

            var contentW = w - padX * 2;
            var contentH = h - padY * 2;
            var startX = padX;
            var startY = padY;

            // Row 1: Label
            var labelFontSize = 12;
            var labelRowH = labelText ? labelFontSize + 6 : 0;

            // Row 2: Big number + unit
            var bigFontSize = 32;
            if (displayValue.length > 7) bigFontSize = 26;
            var unitFontSize = 13;
            var bigRowH = bigFontSize + 4;

            // Row 3: Delta + sparkline
            var deltaFontSize = 12;
            var bottomRowH = (hasDelta || sparklinePoints) ? deltaFontSize + 8 : 0;

            // Scale down if too tall
            var totalH = labelRowH + bigRowH + bottomRowH;
            var scale = 1;
            if (totalH > contentH && contentH > 0) {
                scale = contentH / totalH;
                labelFontSize = Math.round(labelFontSize * scale);
                bigFontSize = Math.round(bigFontSize * scale);
                unitFontSize = Math.round(unitFontSize * scale);
                deltaFontSize = Math.round(deltaFontSize * scale);
                labelRowH = labelText ? labelFontSize + 6 * scale : 0;
                bigRowH = bigFontSize + 4 * scale;
                bottomRowH = (hasDelta || sparklinePoints) ? deltaFontSize + 8 * scale : 0;
            }

            var curY = startY;

            // ── Row 1: Label ──
            if (labelText) {
                ctx.font = '500 ' + labelFontSize + 'px ' + tokens.fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                var truncLabel = draw.ellipsis(ctx, labelText, contentW);
                ctx.fillText(truncLabel, startX, curY);
                curY += labelRowH;
            }

            // ── Row 2: Big number + unit ──
            // Draw value
            ctx.font = '600 ' + bigFontSize + 'px ' + tokens.fonts.mono;
            ctx.fillStyle = accentColor;
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';

            var bigY = curY + bigFontSize;
            var fitSize = draw.fitText(ctx, displayValue, contentW, bigFontSize, tokens.fonts.mono);
            ctx.font = '600 ' + fitSize + 'px ' + tokens.fonts.mono;
            ctx.fillText(displayValue, startX, bigY);
            var valueW = ctx.measureText(displayValue).width;

            // Draw unit (if any)
            if (unitText) {
                ctx.font = '500 ' + unitFontSize + 'px ' + tokens.fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.textBaseline = 'alphabetic';
                ctx.textAlign = 'left';
                ctx.fillText(unitText, startX + valueW + 4, bigY);
            }

            curY += bigRowH;

            // ── Row 3: Delta + sparkline ──
            if (hasDelta || sparklinePoints) {
                var deltaEndX = startX;

                if (hasDelta) {
                    var arrow = arrowGlyph(deltaDirText);
                    var dColor = deltaColor(deltaDirText, deltaSemantics, theme);

                    ctx.font = '600 ' + deltaFontSize + 'px ' + tokens.fonts.primary;
                    ctx.fillStyle = dColor;
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'left';

                    var deltaStr = arrow + ' ' + deltaText;
                    ctx.fillText(deltaStr, startX, curY);
                    deltaEndX = startX + ctx.measureText(deltaStr).width;

                    // Optional sub-label
                    var subLabel = deltaSubLabel;
                    ctx.font = '400 ' + Math.max(9, deltaFontSize - 2) + 'px ' + tokens.fonts.primary;
                    ctx.fillStyle = theme.textFaint;
                    ctx.fillText(subLabel, deltaEndX + 6, curY + 1);
                    deltaEndX += 6 + ctx.measureText(subLabel).width;
                }

                // Sparkline in bottom-right
                if (sparklinePoints) {
                    var sparkW = 70;
                    var sparkH = 20;
                    if (scale < 1) {
                        sparkW = Math.round(sparkW * scale);
                        sparkH = Math.round(sparkH * scale);
                    }
                    var sparkX = startX + contentW - sparkW;
                    var sparkY = curY;
                    // Make sure sparkline does not overlap delta
                    if (hasDelta && sparkX < deltaEndX + 10) {
                        sparkX = deltaEndX + 10;
                        sparkW = startX + contentW - sparkX;
                    }
                    if (sparkW > 20) {
                        var pts = drawSparkline(ctx, sparklinePoints, sparkX, sparkY, sparkW, sparkH, theme.s2, theme.s2);
                        if (pts) {
                            this._sparkPoints = pts;
                            this._sparkBounds = {x: sparkX, y: sparkY, w: sparkW, h: sparkH};
                        }

                        // Hover dot + tooltip
                        if (this._sparkHoverX >= 0 && this._sparkHoverX < this._sparkPoints.length) {
                            var hp = this._sparkPoints[this._sparkHoverX];
                            // Dot
                            ctx.beginPath();
                            ctx.arc(hp.x, hp.y, 3, 0, Math.PI * 2);
                            ctx.fillStyle = theme.panel;
                            ctx.fill();
                            ctx.strokeStyle = theme.s2;
                            ctx.lineWidth = 1.5;
                            ctx.stroke();

                            // Tooltip
                            var tipText = draw.formatNumber(hp.val);
                            ctx.font = '600 10px ' + tokens.fonts.mono;
                            var tipW = ctx.measureText(tipText).width + 10;
                            var tipH = 20;
                            var tipX = hp.x - tipW / 2;
                            var tipY = hp.y - tipH - 6;
                            // Keep tooltip in bounds
                            if (tipX < 0) tipX = 0;
                            if (tipX + tipW > w) tipX = w - tipW;
                            if (tipY < 0) tipY = hp.y + 8;

                            ctx.fillStyle = theme.panel;
                            ctx.strokeStyle = theme.edge;
                            ctx.lineWidth = 1;
                            draw.roundRect(ctx, tipX, tipY, tipW, tipH, 4);
                            ctx.fill();
                            ctx.stroke();

                            ctx.fillStyle = theme.text;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(tipText, tipX + tipW / 2, tipY + tipH / 2);
                            ctx.textAlign = 'left';
                            ctx.textBaseline = 'alphabetic';
                        }
                    }
                }
            }

            // Reset
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        },

        // ── Custom no-data message support ──

        _ensureCanvas: function() {
            if (!this.canvas) {
                this.el.innerHTML = '';
                this.canvas = document.createElement('canvas');
                this.canvas.style.width = '100%';
                this.canvas.style.height = '100%';
                this.canvas.style.display = 'block';
                this.el.appendChild(this.canvas);
            }
            var rect = this.el.getBoundingClientRect();
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
        },

        _drawStatusMessage: function(message) {
            var rect = this.el.getBoundingClientRect();
            var dpr = window.devicePixelRatio || 1;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            if (rect.width <= 0 || rect.height <= 0) return;
            ctx.scale(dpr, dpr);
            var w = rect.width;
            var h = rect.height;
            ctx.clearRect(0, 0, w, h);

            var maxTextW = w * 0.85;
            var fontSize = Math.max(10, Math.min(32, Math.min(w, h) * 0.09));
            var emojiSize = Math.round(fontSize * 1.6);
            var gp = fontSize * 0.5;

            ctx.font = '500 ' + fontSize + 'px ' + tokens.fonts.primary;
            while (ctx.measureText(message).width > maxTextW && fontSize > 8) {
                fontSize -= 1;
                emojiSize = Math.round(fontSize * 1.6);
                ctx.font = '500 ' + fontSize + 'px ' + tokens.fonts.primary;
            }

            ctx.font = emojiSize + 'px ' + tokens.fonts.primary;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.fillText('⏳', w / 2, h / 2 - fontSize * 0.5 - gp);

            ctx.font = '500 ' + fontSize + 'px ' + tokens.fonts.primary;
            ctx.fillStyle = 'rgba(255,255,255,0.30)';
            ctx.fillText(message, w / 2, h / 2 + emojiSize * 0.3);

            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
