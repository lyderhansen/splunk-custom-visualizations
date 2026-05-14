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

    /* ---------- fuel level color ---------- */
    function fuelColor(t, level, warnThresh, critThresh) {
        if (level <= critThresh) return t.danger;
        if (level <= warnThresh) return t.warn;
        return t.success;
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
                if (self._hoverIdx !== -1) { self._hoverIdx = -1; self._render(self._lastData, self._lastConfig); }
            });
        },
        getInitialDataParams: function() {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 50 };
        },
        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError('Awaiting data');
            }
            var colIdx = {};
            for (var i = 0; i < data.fields.length; i++) { colIdx[data.fields[i].name] = i; }
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
            if (!data || !data.rows || data.rows.length === 0) return;
            var ns = getNS(this);
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));

            var levelField = getOption(config, ns, 'levelField', 'level');
            var lapsField = getOption(config, ns, 'lapsField', 'laps_remaining');
            var consumptionField = getOption(config, ns, 'consumptionField', 'consumption');
            var targetField = getOption(config, ns, 'targetField', 'target');

            var warnThresh = parseFloat(getOption(config, ns, 'warningThreshold', '15'));
            var critThresh = parseFloat(getOption(config, ns, 'criticalThreshold', '5'));
            var showLaps = getOption(config, ns, 'showLapsEstimate', 'true') === 'true';
            var showTarget = getOption(config, ns, 'showTarget', 'true') === 'true';

            var row = data.rows[data.rows.length - 1];
            var ci = data.colIdx;
            var level = ci[levelField] !== undefined ? parseFloat(row[ci[levelField]]) : 0;
            var laps = ci[lapsField] !== undefined ? parseFloat(row[ci[lapsField]]) : -1;
            var consumption = ci[consumptionField] !== undefined ? parseFloat(row[ci[consumptionField]]) : -1;
            var target = ci[targetField] !== undefined ? parseFloat(row[ci[targetField]]) : -1;

            level = Math.max(0, Math.min(100, level));

            var w = this.el.offsetWidth;
            var h = this.el.offsetHeight;
            if (w < 1 || h < 1) return;
            var canvas = this.canvas;
            var dpr = window.devicePixelRatio || 1;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            var ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            ctx.clearRect(0, 0, w, h);

            var padTop = Math.max(16, h * 0.06);
            var padBottom = Math.max(16, h * 0.06);
            var padLeft = Math.max(30, w * 0.10);

            var gaugeW = Math.max(28, Math.min(44, w * 0.14));
            var gaugeX = padLeft;
            var gaugeY = padTop;
            var gaugeH = h - padTop - padBottom;
            var tickW = 6;

            // "FUEL" label rotated on far left
            ctx.save();
            var fuelLabelSize = Math.max(9, Math.round(Math.min(w, h) * 0.035));
            if (fuelLabelSize > 13) fuelLabelSize = 13;
            ctx.font = fuelLabelSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.translate(padLeft * 0.35, h / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('F  U  E  L', 0, 0);
            ctx.restore();

            // Gauge track
            ctx.fillStyle = t.edge;
            ctx.fillRect(gaugeX, gaugeY, gaugeW, gaugeH);

            // Fuel fill
            var fillH = gaugeH * (level / 100);
            var fillY = gaugeY + gaugeH - fillH;
            var fillCol = fuelColor(t, level, warnThresh, critThresh);
            ctx.fillStyle = fillCol;
            ctx.fillRect(gaugeX, fillY, gaugeW, fillH);

            // Hover glow on gauge
            if (this._hoverIdx === 0) {
                ctx.fillStyle = theme.withAlpha(fillCol, 0.15);
                ctx.fillRect(gaugeX - 3, gaugeY, gaugeW + 6, gaugeH);
            }

            // Scale ticks at 0%, 25%, 50%, 75%, 100%
            var tickMarks = [0, 25, 50, 75, 100];
            ctx.strokeStyle = t.textFaint;
            ctx.lineWidth = 1;
            for (var ti = 0; ti < tickMarks.length; ti++) {
                var tickPct = tickMarks[ti];
                var tickY = Math.round(gaugeY + gaugeH - (gaugeH * tickPct / 100)) + 0.5;
                ctx.beginPath();
                ctx.moveTo(gaugeX + gaugeW, tickY);
                ctx.lineTo(gaugeX + gaugeW + tickW, tickY);
                ctx.stroke();
            }

            // Target line
            if (showTarget && target >= 0 && target <= 100) {
                var targetY = Math.round(gaugeY + gaugeH - (gaugeH * target / 100)) + 0.5;
                ctx.setLineDash([4, 3]);
                ctx.strokeStyle = t.textDim;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(gaugeX - 4, targetY);
                ctx.lineTo(gaugeX + gaugeW + tickW + 4, targetY);
                ctx.stroke();
                ctx.setLineDash([]);

                var targetLabelSize = Math.max(8, Math.round(Math.min(w, h) * 0.026));
                if (targetLabelSize > 10) targetLabelSize = 10;
                ctx.font = targetLabelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText('TARGET', gaugeX + gaugeW + tickW + 6, targetY - 2);
            }

            // Level percentage at top-right of fill
            var pctFontSize = Math.max(11, Math.round(Math.min(w, h) * 0.04));
            if (pctFontSize > 16) pctFontSize = 16;
            ctx.font = pctFontSize + 'px ' + theme.FONTS.mono;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            var pctLabelX = gaugeX + gaugeW + tickW + 6;
            var pctLabelY = fillY + pctFontSize + 2;
            if (pctLabelY > gaugeY + gaugeH) pctLabelY = gaugeY + gaugeH;
            ctx.fillText(Math.round(level) + '%', pctLabelX, pctLabelY);

            // Right side: info text
            var infoX = gaugeX + gaugeW + Math.max(30, w * 0.10);
            var infoCenterY = h / 2;

            if (showLaps && laps >= 0) {
                var lapsFontSize = Math.max(20, Math.round(Math.min(w, h) * 0.10));
                if (lapsFontSize > 48) lapsFontSize = 48;
                ctx.font = 'bold ' + lapsFontSize + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(String(Math.round(laps)), infoX, infoCenterY);

                var lapsLabelSize = Math.max(9, Math.round(Math.min(w, h) * 0.032));
                if (lapsLabelSize > 13) lapsLabelSize = 13;
                ctx.font = lapsLabelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textBaseline = 'top';
                ctx.fillText('L A P S', infoX, infoCenterY + 6);

                if (consumption >= 0) {
                    var consFontSize = Math.max(11, Math.round(Math.min(w, h) * 0.04));
                    if (consFontSize > 16) consFontSize = 16;
                    ctx.font = consFontSize + 'px ' + theme.FONTS.mono;
                    ctx.fillStyle = t.textDim;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    ctx.fillText(consumption.toFixed(2) + ' L/LAP', infoX, infoCenterY + 6 + lapsLabelSize + 12);
                }
            } else if (consumption >= 0) {
                var consFontSize2 = Math.max(12, Math.round(Math.min(w, h) * 0.04));
                if (consFontSize2 > 16) consFontSize2 = 16;
                ctx.font = consFontSize2 + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(consumption.toFixed(2) + ' L/LAP', infoX, infoCenterY);
            }

            // Hit regions
            this._hitRegions = [];
            var tip = 'Fuel: ' + Math.round(level) + '%';
            if (laps >= 0) tip += ' | ' + Math.round(laps) + ' laps remaining';
            if (consumption >= 0) tip += ' | ' + consumption.toFixed(2) + ' L/lap';
            this._hitRegions.push({
                type: 'rect',
                x: gaugeX - 4,
                y: gaugeY,
                w: gaugeW + 8,
                h: gaugeH,
                tip: tip
            });
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
                if (tx + 180 > this.el.offsetWidth) tx = mx - 180;
                if (ty < 0) ty = my + 20;
                this._tooltip.style.left = tx + 'px';
                this._tooltip.style.top = ty + 'px';
                this.canvas.style.cursor = 'pointer';
                if (this._hoverIdx !== hit) { this._hoverIdx = hit; this._render(this._lastData, this._lastConfig); }
            } else {
                this._tooltip.style.display = 'none';
                this.canvas.style.cursor = 'default';
                if (this._hoverIdx !== -1) { this._hoverIdx = -1; this._render(this._lastData, this._lastConfig); }
            }
        },
        _hitTest: function(mx, my) {
            for (var i = 0; i < this._hitRegions.length; i++) {
                var r = this._hitRegions[i];
                if (r.type === 'rect') {
                    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i;
                } else if (r.type === 'arc') {
                    var dx = mx - r.cx, dy = my - r.cy;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist >= r.innerR && dist <= r.outerR) return i;
                }
            }
            return null;
        },
        reflow: function() { if (this._lastConfig) this._render(this._lastData, this._lastConfig); },
        destroy: function() {
            if (this._tooltip && this._tooltip.parentNode) this._tooltip.parentNode.removeChild(this._tooltip);
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
