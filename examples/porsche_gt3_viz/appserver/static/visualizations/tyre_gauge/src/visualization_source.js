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

    /* ---------- car silhouette ---------- */
    function drawCarOutline(ctx, cx, cy, carW, carH, color) {
        var bw = carW * 0.42;
        var bh = carH * 0.5;
        var noseW = bw * 0.65;
        var tailW = bw * 0.70;
        var archD = carW * 0.06;
        var archH = carH * 0.10;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();

        // Nose (front)
        ctx.moveTo(cx - noseW, cy - bh);
        ctx.lineTo(cx + noseW, cy - bh);

        // Front-right edge down to front-right wheel arch
        ctx.lineTo(cx + bw, cy - bh * 0.70);

        // Front-right wheel arch (bump out)
        ctx.lineTo(cx + bw + archD, cy - bh * 0.55);
        ctx.lineTo(cx + bw + archD, cy - bh * 0.55 + archH);
        ctx.lineTo(cx + bw, cy - bh * 0.40);

        // Right side body
        ctx.lineTo(cx + bw, cy + bh * 0.35);

        // Rear-right wheel arch
        ctx.lineTo(cx + bw + archD, cy + bh * 0.40);
        ctx.lineTo(cx + bw + archD, cy + bh * 0.40 + archH);
        ctx.lineTo(cx + bw, cy + bh * 0.60);

        // Rear-right to tail
        ctx.lineTo(cx + tailW, cy + bh);

        // Tail (rear)
        ctx.lineTo(cx - tailW, cy + bh);

        // Rear-left to rear-left wheel arch
        ctx.lineTo(cx - bw, cy + bh * 0.60);

        // Rear-left wheel arch
        ctx.lineTo(cx - bw - archD, cy + bh * 0.40 + archH);
        ctx.lineTo(cx - bw - archD, cy + bh * 0.40);
        ctx.lineTo(cx - bw, cy + bh * 0.35);

        // Left side body
        ctx.lineTo(cx - bw, cy - bh * 0.40);

        // Front-left wheel arch
        ctx.lineTo(cx - bw - archD, cy - bh * 0.55 + archH);
        ctx.lineTo(cx - bw - archD, cy - bh * 0.55);
        ctx.lineTo(cx - bw, cy - bh * 0.70);

        ctx.closePath();
        ctx.stroke();

        // Center line (spine)
        ctx.beginPath();
        ctx.strokeStyle = theme.withAlpha(color, 0.3);
        ctx.lineWidth = 1;
        ctx.moveTo(cx, cy - bh * 0.85);
        ctx.lineTo(cx, cy + bh * 0.85);
        ctx.stroke();

        ctx.restore();
    }

    /* ---------- arc gauge ---------- */
    function drawArcGauge(ctx, cx, cy, radius, trackWidth, value, minVal, maxVal, optMin, optMax, t, unit, isHover) {
        var startAngle = Math.PI * 0.75;
        var endAngle = Math.PI * 2.25;
        var sweep = endAngle - startAngle;
        var ratio = Math.max(0, Math.min(1, (value - minVal) / (maxVal - minVal)));
        var fillAngle = startAngle + sweep * ratio;
        var fillColor = theme.tempToColor(t, value, minVal, maxVal, optMin, optMax);

        // Track
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.strokeStyle = t.edge;
        ctx.lineWidth = trackWidth;
        ctx.lineCap = 'butt';
        ctx.stroke();

        // Fill
        if (ratio > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, fillAngle, false);
            ctx.strokeStyle = fillColor;
            ctx.lineWidth = trackWidth;
            ctx.lineCap = 'butt';
            ctx.stroke();
        }

        // Hover glow
        if (isHover) {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, fillAngle, false);
            ctx.strokeStyle = theme.withAlpha(fillColor, 0.3);
            ctx.lineWidth = trackWidth + 4;
            ctx.lineCap = 'butt';
            ctx.stroke();
        }

        // Center value text
        var valueStr = Math.round(value) + unit;
        var fontSize = Math.max(10, Math.round(radius * 0.55));
        ctx.font = 'bold ' + fontSize + 'px ' + theme.FONTS.mono;
        ctx.fillStyle = t.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(valueStr, cx, cy);

        return fillColor;
    }

    /* ---------- wear bar ---------- */
    function drawWearBar(ctx, cx, cy, barW, barH, wearPct, color, t) {
        ctx.fillStyle = t.edge;
        ctx.fillRect(cx - barW / 2, cy, barW, barH);
        if (wearPct > 0) {
            var fillW = barW * Math.min(1, wearPct / 100);
            ctx.fillStyle = color;
            ctx.fillRect(cx - barW / 2, cy, fillW, barH);
        }
    }

    /* ---------- status label ---------- */
    function tempStatus(val, optMin, optMax) {
        if (val < optMin) return 'Cold';
        if (val > optMax) return 'Hot';
        return 'Optimal';
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

            var flField = getOption(config, ns, 'flField', 'fl_temp');
            var frField = getOption(config, ns, 'frField', 'fr_temp');
            var rlField = getOption(config, ns, 'rlField', 'rl_temp');
            var rrField = getOption(config, ns, 'rrField', 'rr_temp');
            var compoundField = getOption(config, ns, 'compoundField', 'compound');
            var wearFlField = getOption(config, ns, 'wearFlField', 'wear_fl');
            var wearFrField = getOption(config, ns, 'wearFrField', 'wear_fr');
            var wearRlField = getOption(config, ns, 'wearRlField', 'wear_rl');
            var wearRrField = getOption(config, ns, 'wearRrField', 'wear_rr');

            var minTemp = parseFloat(getOption(config, ns, 'minTemp', '60'));
            var maxTemp = parseFloat(getOption(config, ns, 'maxTemp', '140'));
            var optimalMin = parseFloat(getOption(config, ns, 'optimalMin', '85'));
            var optimalMax = parseFloat(getOption(config, ns, 'optimalMax', '110'));
            var unit = getOption(config, ns, 'unit', '°C');
            var showWear = getOption(config, ns, 'showWear', 'true') === 'true';

            var row = data.rows[data.rows.length - 1];
            var ci = data.colIdx;
            var fl = ci[flField] !== undefined ? parseFloat(row[ci[flField]]) : 0;
            var fr = ci[frField] !== undefined ? parseFloat(row[ci[frField]]) : 0;
            var rl = ci[rlField] !== undefined ? parseFloat(row[ci[rlField]]) : 0;
            var rr = ci[rrField] !== undefined ? parseFloat(row[ci[rrField]]) : 0;
            var compound = ci[compoundField] !== undefined ? String(row[ci[compoundField]]) : '';
            var wfl = ci[wearFlField] !== undefined ? parseFloat(row[ci[wearFlField]]) : -1;
            var wfr = ci[wearFrField] !== undefined ? parseFloat(row[ci[wearFrField]]) : -1;
            var wrl = ci[wearRlField] !== undefined ? parseFloat(row[ci[wearRlField]]) : -1;
            var wrr = ci[wearRrField] !== undefined ? parseFloat(row[ci[wearRrField]]) : -1;

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

            var cx = w / 2;
            var cy = h / 2;
            var carW = w * 0.40;
            var carH = h * 0.70;
            var minDim = Math.min(w, h);
            var arcR = minDim * 0.15;
            var trackWidth = Math.max(4, Math.round(arcR * 0.18));

            var wheelOffsetX = carW * 0.42 + carW * 0.12;
            var wheelOffsetYFront = carH * 0.28;
            var wheelOffsetYRear = carH * 0.28;

            var wheels = [
                { label: 'FL', temp: fl, wear: wfl, x: cx - wheelOffsetX, y: cy - wheelOffsetYFront },
                { label: 'FR', temp: fr, wear: wfr, x: cx + wheelOffsetX, y: cy - wheelOffsetYFront },
                { label: 'RL', temp: rl, wear: wrl, x: cx - wheelOffsetX, y: cy + wheelOffsetYRear },
                { label: 'RR', temp: rr, wear: wrr, x: cx + wheelOffsetX, y: cy + wheelOffsetYRear }
            ];

            drawCarOutline(ctx, cx, cy, carW, carH, t.edgeStrong);

            this._hitRegions = [];

            for (var i = 0; i < wheels.length; i++) {
                var wh = wheels[i];
                var isHover = (this._hoverIdx === i);
                var arcColor = drawArcGauge(ctx, wh.x, wh.y, arcR, trackWidth, wh.temp, minTemp, maxTemp, optimalMin, optimalMax, t, unit, isHover);

                var labelSize = Math.max(9, Math.round(arcR * 0.28));
                ctx.font = labelSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(wh.label, wh.x, wh.y - arcR - trackWidth - labelSize * 0.6);

                if (showWear && wh.wear >= 0) {
                    var barW = arcR * 1.4;
                    var barH = 3;
                    var barY = wh.y + arcR + trackWidth + 4;
                    drawWearBar(ctx, wh.x, barY, barW, barH, wh.wear, arcColor, t);
                }

                var status = tempStatus(wh.temp, optimalMin, optimalMax);
                var tip = wh.label + ': ' + Math.round(wh.temp) + unit + ' (' + status + ')';
                if (showWear && wh.wear >= 0) {
                    tip += ' | Wear: ' + Math.round(wh.wear) + '%';
                }
                this._hitRegions.push({
                    type: 'arc',
                    cx: wh.x,
                    cy: wh.y,
                    innerR: 0,
                    outerR: arcR + trackWidth + 10,
                    tip: tip
                });
            }

            if (compound) {
                var pillColor = theme.compoundColor(t, compound);
                var pillText = compound.toUpperCase();
                var pillFontSize = Math.max(9, Math.round(minDim * 0.025));
                ctx.font = 'bold ' + pillFontSize + 'px ' + theme.FONTS.ui;
                var pillTextW = ctx.measureText(pillText).width;
                var pillW = pillTextW + pillFontSize * 1.8;
                var pillH = pillFontSize * 2;

                ctx.fillStyle = pillColor;
                ctx.fillRect(cx - pillW / 2, cy - pillH / 2, pillW, pillH);

                var compLower = compound.toLowerCase();
                var pillTextColor = (compLower === 'medium' || compLower === 'hard') ? '#0A0A0A' : '#FFFFFF';
                ctx.font = 'bold ' + pillFontSize + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = pillTextColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(pillText, cx, cy);
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
