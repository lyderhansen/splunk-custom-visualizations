/*
 * Red Bull Racing Tachometer Gauge — F1 Instrument Cluster v2
 *
 * Segmented arc with numbered scale ticks around the outside,
 * red zone, shift light dots, center value. Based on real F1
 * telemetry dashboard aesthetics.
 *
 * Expected: value (0–maxValue), optional label.
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

    function niceStep(max) {
        var raw = max / 6;
        var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
        var norm = raw / mag;
        if (norm <= 1) return mag;
        if (norm <= 2) return 2 * mag;
        if (norm <= 5) return 5 * mag;
        return 10 * mag;
    }

    function abbreviate(val) {
        if (val >= 1000) return (val / 1000).toFixed(val % 1000 === 0 ? 0 : 1) + 'k';
        return String(Math.round(val));
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
            this._tooltip.style.cssText = 'position:absolute;display:none;padding:6px 10px;border-radius:2px;font:11px ' + theme.FONTS.data + ';pointer-events:none;z-index:9999;';
            this.el.appendChild(this._tooltip);

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;

            var self = this;
            this.el.addEventListener('mousemove', function(e) { self._onMouse(e); });
            this.el.addEventListener('mouseleave', function() { self._tooltip.style.display = 'none'; });
        },

        _onMouse: function(e) {
            if (!this._gaugeData) return;
            var rect = this.el.getBoundingClientRect();
            var x = e.clientX - rect.left + 12;
            var y = e.clientY - rect.top - 28;
            var d = this._gaugeData;
            this._tooltip.textContent = d.label + ': ' + d.display + ' / ' + d.max;
            this._tooltip.style.display = 'block';
            this._tooltip.style.left = x + 'px';
            this._tooltip.style.top = y + 'px';
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 50
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Red Bull Tachometer'
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

            var valueField = getOption(config, ns, 'field', 'value');
            var maxValue = parseFloat(getOption(config, ns, 'maxValue', '100'));
            var redZoneStart = parseFloat(getOption(config, ns, 'redZoneStart', '80'));
            var unit = getOption(config, ns, 'unit', '');
            var label = getOption(config, ns, 'label', '');
            var segments = parseInt(getOption(config, ns, 'segments', '24'), 10);

            var row = data.rows[data.rows.length - 1];
            var colIdx = data.colIdx;
            var rawValue = (colIdx[valueField] !== undefined)
                ? parseFloat(row[colIdx[valueField]])
                : 0;
            if (isNaN(rawValue)) rawValue = 0;
            var pct = Math.max(0, Math.min(1, rawValue / maxValue));
            var redZonePct = redZoneStart / maxValue;

            var displayVal = theme.fmtNum(rawValue, { compact: true });
            if (unit) displayVal += unit;

            this._gaugeData = { label: label || 'Value', display: displayVal, max: theme.fmtNum(maxValue, { compact: true }) + (unit || '') };
            this._tooltip.style.background = t.panelHi;
            this._tooltip.style.color = t.text;
            this._tooltip.style.border = '1px solid ' + t.edgeStrong;

            // ── Flush background ────────────────────────────────────
            ctx.fillStyle = t.panel;
            ctx.fillRect(0, 0, w, h);

            // ── Arc geometry ────────────────────────────────────────
            var cx = w / 2;
            var cy = h * 0.56;
            var radius = Math.min(w, h) * 0.32;
            var lineWidth = radius * 0.10;
            var startAngle = Math.PI * 0.8;
            var endAngle = Math.PI * 2.2;
            var totalSweep = endAngle - startAngle;
            var gapAngle = totalSweep * 0.006;
            var segSweep = (totalSweep - gapAngle * segments) / segments;

            // ── Numbered scale ticks around outside ─────────────────
            var tickOuterR = radius + lineWidth * 0.8;
            var majorTickLen = lineWidth * 0.6;
            var minorTickLen = lineWidth * 0.3;
            var step = niceStep(maxValue);
            var labelR = tickOuterR + majorTickLen + 10;
            var tickFontSize = Math.max(7, Math.min(10, radius * 0.09));

            ctx.font = tickFontSize + 'px ' + theme.FONTS.data;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (var tv = 0; tv <= maxValue; tv += step / 2) {
                var tPct = tv / maxValue;
                var tAngle = startAngle + totalSweep * tPct;
                var isMajor = (tv % step === 0);
                var tLen = isMajor ? majorTickLen : minorTickLen;

                var t1x = cx + Math.cos(tAngle) * tickOuterR;
                var t1y = cy + Math.sin(tAngle) * tickOuterR;
                var t2x = cx + Math.cos(tAngle) * (tickOuterR + tLen);
                var t2y = cy + Math.sin(tAngle) * (tickOuterR + tLen);

                ctx.beginPath();
                ctx.moveTo(t1x, t1y);
                ctx.lineTo(t2x, t2y);
                ctx.strokeStyle = (tPct >= redZonePct)
                    ? theme.withAlpha(t.red, 0.6)
                    : theme.withAlpha(t.invert, 0.2);
                ctx.lineWidth = isMajor ? 1.5 : 0.8;
                ctx.stroke();

                if (isMajor) {
                    var lx = cx + Math.cos(tAngle) * labelR;
                    var ly = cy + Math.sin(tAngle) * labelR;
                    ctx.fillStyle = (tPct >= redZonePct)
                        ? theme.withAlpha(t.red, 0.7)
                        : t.textFaint;
                    ctx.fillText(abbreviate(tv), lx, ly);
                }
            }

            // ── Draw segmented arc ──────────────────────────────────
            for (var i = 0; i < segments; i++) {
                var segStart = startAngle + i * (segSweep + gapAngle);
                var segEnd = segStart + segSweep;
                var segPct = (i + 0.5) / segments;
                var isFilled = segPct <= pct;
                var isRedZone = segPct >= redZonePct;

                ctx.beginPath();
                ctx.arc(cx, cy, radius, segStart, segEnd);
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'butt';

                if (isFilled) {
                    if (isRedZone) {
                        ctx.strokeStyle = t.red;
                    } else if (segPct > redZonePct * 0.75) {
                        ctx.strokeStyle = t.gold;
                    } else {
                        ctx.strokeStyle = theme.lerpColor('#1E3A6E', '#4A8FE7', segPct / redZonePct);
                    }
                } else {
                    ctx.strokeStyle = theme.withAlpha(t.invert, 0.04);
                }
                ctx.stroke();
            }

            // ── Shift lights (row of dots at top) ───────────────────
            var numLights = 7;
            var lightRadius = Math.max(2, Math.min(3.5, w * 0.010));
            var lightSpacing = lightRadius * 3.5;
            var lightsWidth = (numLights - 1) * lightSpacing;
            var lightY = h * 0.10;
            var lightStartX = cx - lightsWidth / 2;
            var litCount = Math.floor(pct * numLights);

            for (var li = 0; li < numLights; li++) {
                var lx = lightStartX + li * lightSpacing;
                ctx.beginPath();
                ctx.arc(lx, lightY, lightRadius, 0, Math.PI * 2);

                if (li < litCount) {
                    if (li >= numLights - 2) {
                        ctx.fillStyle = t.red;
                    } else if (li >= numLights - 4) {
                        ctx.fillStyle = t.gold;
                    } else {
                        ctx.fillStyle = '#4A8FE7';
                    }
                    ctx.shadowColor = ctx.fillStyle;
                    ctx.shadowBlur = 4;
                } else {
                    ctx.fillStyle = theme.withAlpha(t.invert, 0.06);
                    ctx.shadowBlur = 0;
                }
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.shadowColor = 'transparent';
            }

            // ── Center value ────────────────────────────────────────
            var valSize = Math.max(16, Math.min(40, radius * 0.50));
            ctx.font = 'bold ' + valSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayVal, cx, cy - valSize * 0.1);

            // ── Label below value ───────────────────────────────────
            if (label) {
                var lblSize = Math.max(8, Math.min(11, radius * 0.12));
                ctx.font = lblSize + 'px ' + theme.FONTS.data;
                ctx.fillStyle = t.textFaint;
                ctx.textAlign = 'center';
                ctx.fillText(label.toUpperCase(), cx, cy + valSize * 0.5);
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
