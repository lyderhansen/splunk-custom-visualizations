var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var SplunkVisualizationUtils = require('api/SplunkVisualizationUtils');
var theme = require('shared/theme');

function safeStr(val) {
    return (val != null && val !== '') ? String(val) : '';
}

function detectTheme(config, ns) {
    var mode = theme.getOption(config, ns, 'themeMode', 'auto');
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    try {
        if (typeof SplunkVisualizationUtils !== 'undefined' &&
            SplunkVisualizationUtils.getCurrentTheme) {
            var st = SplunkVisualizationUtils.getCurrentTheme();
            if (st === 'light' || st === 'dark') return st;
        }
    } catch (e) {}
    try {
        var body = document.body;
        if (body) {
            var dt = body.getAttribute('data-theme');
            if (dt === 'light' || dt === 'dark') return dt;
            if (body.classList.contains('light')) return 'light';
            if (body.classList.contains('dark')) return 'dark';
        }
    } catch (e) {}
    try {
        var bg = window.getComputedStyle(document.body).backgroundColor;
        var m = bg.match(/\d+/g);
        if (m && m.length >= 3) {
            return (parseInt(m[0]) + parseInt(m[1]) + parseInt(m[2])) / 3 < 128
                ? 'dark' : 'light';
        }
    } catch (e) {}
    return 'dark';
}

module.exports = SplunkVisualizationBase.extend({

    initialize: function() {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.style.overflow = 'hidden';
        this.el.style.position = 'relative';

        var canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        this.el.appendChild(canvas);
        this.canvas = canvas;

        this._lastData = null;
        this._lastConfig = null;
        this._lastGoodData = null;
        this._hoverIdx = -1;
        this._hitRegions = [];
        this._animProgress = 0;
        this._animTimer = null;
        this._targetValue = 0;

        this._tooltip = document.createElement('div');
        this._tooltip.style.cssText =
            'position:absolute;display:none;padding:8px 14px;' +
            'border-radius:2px;pointer-events:none;white-space:nowrap;' +
            'z-index:100;';
        this.el.appendChild(this._tooltip);

        var self = this;
        this.canvas.addEventListener('mousemove', function(e) {
            self._onMouseMove(e);
        });
        this.canvas.addEventListener('mouseleave', function() {
            self._tooltip.style.display = 'none';
            self.canvas.style.cursor = 'default';
            if (self._hoverIdx !== -1) {
                self._hoverIdx = -1;
                self._render(self._lastData, self._lastConfig);
            }
        });

        this._observer = new MutationObserver(function() {
            var nodes = self.el.querySelectorAll(
                '.viz-placeholder, .shared-viz-no-results, ' +
                '[data-test="viz-no-results"], .viz-controller-no-results'
            );
            for (var i = 0; i < nodes.length; i++) {
                nodes[i].style.display = 'none';
            }
        });
        this._observer.observe(this.el, { childList: true, subtree: true });
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
            return data;
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
            if (this._lastGoodData) data = this._lastGoodData;
            else return;
        }
        this._lastData = data;
        this._lastConfig = config;

        var self = this;
        theme.loadFonts(function() {
            self._startAnim(data, config);
        });
    },

    _startAnim: function(data, config) {
        var self = this;
        if (this._animTimer) {
            clearInterval(this._animTimer);
            this._animTimer = null;
        }

        var ns = theme.getNS(this);
        var valueField = theme.getOption(config, ns, 'valueField', 'value');
        var colIdx = data.colIdx || {};
        var row = data.rows ? data.rows[data.rows.length - 1] : null;
        var vIdx = colIdx[valueField];
        var rawVal = (row && vIdx !== undefined) ? parseFloat(row[vIdx]) : 0;
        if (isNaN(rawVal)) rawVal = 0;

        this._targetValue = rawVal;
        this._animProgress = 0;

        var frames = 0;
        var totalFrames = 40;
        this._animTimer = setInterval(function() {
            frames++;
            var t = frames / totalFrames;
            t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            self._animProgress = t;
            self._render(data, config);
            if (frames >= totalFrames) {
                clearInterval(self._animTimer);
                self._animTimer = null;
                self._animProgress = 1;
                self._render(data, config);
            }
        }, 16);
    },

    _render: function(data, config) {
        var el = this.el;
        var w = el.clientWidth || el.offsetWidth || window.innerWidth || 300;
        var h = el.clientHeight || el.offsetHeight || window.innerHeight || 200;
        if (w < 10) w = window.innerWidth || 300;
        if (h < 10) h = window.innerHeight || 200;

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

        var ns = theme.getNS(this);
        var themeName = detectTheme(config, ns);
        var t = theme.getTheme(themeName);

        var accentColor = theme.getOption(config, ns, 'accentColor', '#CDFF00');
        var maxValue = theme.parseNum(theme.getOption(config, ns, 'maxValue', '100'), 100);
        var showTarget = theme.getOption(config, ns, 'showTarget', 'true') !== 'false';
        var gi = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '70'), 70) / 100;
        var valueField = theme.getOption(config, ns, 'valueField', 'value');
        var targetField = theme.getOption(config, ns, 'targetField', 'target');
        var labelField = theme.getOption(config, ns, 'labelField', 'label');

        this._tooltip.style.background = t.panelHi;
        this._tooltip.style.color = t.text;
        this._tooltip.style.border = '1px solid ' + t.edgeStrong;
        this._tooltip.style.fontFamily = theme.FONTS.data;
        this._tooltip.style.fontSize = '11px';

        var colIdx = data.colIdx || {};
        var row = data.rows ? data.rows[data.rows.length - 1] : null;

        var vIdx = colIdx[valueField];
        var tIdx = colIdx[targetField];
        var lIdx = colIdx[labelField];

        var rawValue = 0;
        var rawTarget = 0;
        var label = '';

        if (row) {
            var rv = (vIdx !== undefined) ? parseFloat(row[vIdx]) : NaN;
            rawValue = isNaN(rv) ? 0 : rv;
            var rt = (tIdx !== undefined) ? parseFloat(row[tIdx]) : NaN;
            rawTarget = isNaN(rt) ? 0 : rt;
            label = safeStr((lIdx !== undefined) ? row[lIdx] : '');
        }

        var valuePct = maxValue > 0 ? Math.min(rawValue / maxValue, 1) : 0;
        var targetPct = maxValue > 0 ? Math.min(rawTarget / maxValue, 1) : 0;
        var animatedPct = valuePct * this._animProgress;

        var pad = Math.max(12, Math.min(w, h) * 0.06);
        var arcThick = Math.max(8, Math.min(w, h) * 0.08);
        var maxR_w = (w - pad * 2) / 2;
        var maxR_h = (h - pad * 2) * 0.48;
        var radius = Math.min(maxR_w, maxR_h);
        var cx = w / 2;
        var cy = pad + radius + arcThick / 2 + Math.max(0, h * 0.04);

        var startAngle = 0.75 * Math.PI;
        var endAngle = 2.25 * Math.PI;
        var sweep = endAngle - startAngle;

        // Track arc (background)
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.strokeStyle = themeName === 'dark'
            ? 'rgba(255,255,255,0.06)'
            : 'rgba(0,0,0,0.08)';
        ctx.lineWidth = arcThick;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Subtle tick marks
        var tickCount = 10;
        var tickLen = Math.max(4, arcThick * 0.35);
        ctx.lineWidth = 1;
        ctx.lineCap = 'butt';
        for (var i = 0; i <= tickCount; i++) {
            var tickAngle = startAngle + (sweep * i / tickCount);
            var innerR = radius - arcThick / 2 - 2;
            var outerR = radius - arcThick / 2 - 2 - tickLen;
            var tx1 = cx + innerR * Math.cos(tickAngle);
            var ty1 = cy + innerR * Math.sin(tickAngle);
            var tx2 = cx + outerR * Math.cos(tickAngle);
            var ty2 = cy + outerR * Math.sin(tickAngle);
            ctx.beginPath();
            ctx.moveTo(tx1, ty1);
            ctx.lineTo(tx2, ty2);
            ctx.strokeStyle = t.textFaint;
            ctx.stroke();
        }

        // Value arc with glow
        if (animatedPct > 0.001) {
            var valueAngle = startAngle + sweep * animatedPct;

            // Glow layer
            if (gi > 0.05) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAngle, valueAngle, false);
                ctx.strokeStyle = theme.withAlpha(accentColor, 0.3 * gi);
                ctx.lineWidth = arcThick + Math.max(8, arcThick * 0.8) * gi;
                ctx.lineCap = 'round';
                ctx.shadowBlur = Math.max(10, 30 * gi);
                ctx.shadowColor = theme.withAlpha(accentColor, 0.5 * gi);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.shadowColor = 'transparent';
                ctx.restore();
            }

            // Main value arc
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, valueAngle, false);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = arcThick;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Arc tip highlight
            var tipX = cx + radius * Math.cos(valueAngle);
            var tipY = cy + radius * Math.sin(valueAngle);
            if (gi > 0.1) {
                ctx.save();
                var tipGlow = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, arcThick * 1.2 * gi);
                tipGlow.addColorStop(0, theme.withAlpha(accentColor, 0.6 * gi));
                tipGlow.addColorStop(1, 'transparent');
                ctx.fillStyle = tipGlow;
                ctx.beginPath();
                ctx.arc(tipX, tipY, arcThick * 1.2 * gi, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // Target marker
        if (showTarget && rawTarget > 0 && targetPct > 0) {
            var targetAngle = startAngle + sweep * targetPct;
            var markerInner = radius - arcThick / 2 - 4;
            var markerOuter = radius + arcThick / 2 + 4;
            var mx1 = cx + markerInner * Math.cos(targetAngle);
            var my1 = cy + markerInner * Math.sin(targetAngle);
            var mx2 = cx + markerOuter * Math.cos(targetAngle);
            var my2 = cy + markerOuter * Math.sin(targetAngle);

            ctx.beginPath();
            ctx.moveTo(mx1, my1);
            ctx.lineTo(mx2, my2);
            ctx.strokeStyle = t.text;
            ctx.lineWidth = Math.max(2, arcThick * 0.12);
            ctx.lineCap = 'round';
            ctx.stroke();

            // Target label
            var targetLabelR = markerOuter + Math.max(8, radius * 0.06);
            var tlx = cx + targetLabelR * Math.cos(targetAngle);
            var tly = cy + targetLabelR * Math.sin(targetAngle);
            var targetFontSize = Math.max(8, Math.min(w, h) * 0.032);
            ctx.font = '600 ' + targetFontSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textDim;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('TARGET', tlx, tly);
        }

        // Center value
        var displayPct = Math.round(rawValue * this._animProgress);
        var valueFontSize = Math.max(24, Math.min(w, h) * 0.22);
        ctx.font = '900 ' + valueFontSize + 'px ' + theme.FONTS.ui;
        ctx.fillStyle = t.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var valueY = cy + Math.max(4, radius * 0.05);
        ctx.fillText(displayPct + '%', cx, valueY);

        // "of <max>" subtext
        var subFontSize = Math.max(9, Math.min(w, h) * 0.04);
        ctx.font = '400 ' + subFontSize + 'px ' + theme.FONTS.ui;
        ctx.fillStyle = t.textDim;
        ctx.fillText('of ' + Math.round(maxValue), cx, valueY + valueFontSize * 0.55);

        // Label below arc
        if (label) {
            var labelFontSize = Math.max(10, Math.min(w, h) * 0.045);
            var labelY = cy + radius + arcThick / 2 + Math.max(16, h * 0.05);
            ctx.font = '800 ' + labelFontSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = accentColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(label.toUpperCase(), cx, labelY);
        }

        // Bottom metrics bar
        if (showTarget && rawTarget > 0) {
            var barY = h - pad - Math.max(14, h * 0.06);
            var metricFont = Math.max(9, Math.min(w, h) * 0.035);
            var gap = rawValue - rawTarget;
            var gapSign = gap >= 0 ? '+' : '';
            var gapColor = gap >= 0 ? accentColor : t.danger;

            ctx.font = '700 ' + metricFont + 'px ' + theme.FONTS.data;
            ctx.textBaseline = 'top';

            // Value
            ctx.textAlign = 'left';
            ctx.fillStyle = t.textDim;
            ctx.fillText('VALUE', pad + 4, barY);
            ctx.fillStyle = t.text;
            ctx.font = '700 ' + (metricFont * 1.15) + 'px ' + theme.FONTS.data;
            ctx.fillText(rawValue.toFixed(1), pad + 4, barY + metricFont + 2);

            // Target
            ctx.font = '700 ' + metricFont + 'px ' + theme.FONTS.data;
            ctx.textAlign = 'center';
            ctx.fillStyle = t.textDim;
            ctx.fillText('TARGET', cx, barY);
            ctx.fillStyle = t.text;
            ctx.font = '700 ' + (metricFont * 1.15) + 'px ' + theme.FONTS.data;
            ctx.fillText(rawTarget.toFixed(1), cx, barY + metricFont + 2);

            // Gap
            ctx.font = '700 ' + metricFont + 'px ' + theme.FONTS.data;
            ctx.textAlign = 'right';
            ctx.fillStyle = t.textDim;
            ctx.fillText('GAP', w - pad - 4, barY);
            ctx.fillStyle = gapColor;
            ctx.font = '700 ' + (metricFont * 1.15) + 'px ' + theme.FONTS.data;
            ctx.fillText(gapSign + gap.toFixed(1), w - pad - 4, barY + metricFont + 2);
        }

        // Hit regions for tooltip
        this._hitRegions = [];
        this._hitRegions.push({
            x: cx - radius, y: cy - radius,
            w: radius * 2, h: radius * 2,
            tip: (label ? label + ': ' : '') + rawValue.toFixed(1) + '%' +
                 (showTarget && rawTarget > 0 ? ' (target: ' + rawTarget.toFixed(1) + '%)' : '')
        });

        // Aria label for accessibility
        canvas.setAttribute('aria-label',
            (label ? label + ': ' : '') + rawValue.toFixed(1) + '% of ' + maxValue);
    },

    _onMouseMove: function(e) {
        var rect = this.canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;
        var hit = this._hitTest(mx, my);
        if (hit !== null) {
            var region = this._hitRegions[hit];
            this._tooltip.textContent = region.tip;
            this._tooltip.style.display = 'block';
            var tx = mx + 14;
            var ty = my - 10;
            if (tx + 200 > this.el.offsetWidth) tx = mx - 200;
            if (ty < 0) ty = my + 20;
            this._tooltip.style.left = tx + 'px';
            this._tooltip.style.top = ty + 'px';
            this.canvas.style.cursor = 'pointer';
        } else {
            this._tooltip.style.display = 'none';
            this.canvas.style.cursor = 'default';
        }
    },

    _hitTest: function(mx, my) {
        for (var i = 0; i < this._hitRegions.length; i++) {
            var r = this._hitRegions[i];
            if (mx >= r.x && mx <= r.x + r.w &&
                my >= r.y && my <= r.y + r.h) {
                return i;
            }
        }
        return null;
    },

    reflow: function() {
        if (this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    destroy: function() {
        if (this._animTimer) {
            clearInterval(this._animTimer);
            this._animTimer = null;
        }
        if (this._observer) this._observer.disconnect();
        if (this._tooltip && this._tooltip.parentNode) {
            this._tooltip.parentNode.removeChild(this._tooltip);
        }
        SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
    }
});
