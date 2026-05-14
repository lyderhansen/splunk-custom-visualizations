/*
 * Netflix Status Chip — pill-shaped severity badge (Stranger Things neon aesthetic).
 * Uses the last row: configurable status field maps to semantic fill via severityColor().
 */
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
        } catch (e2) {}
        return '';
    }

    function isPulseSeverity(statusStr) {
        var s = (statusStr || '').toString().toLowerCase();
        return s === 'crit' || s === 'critical' || s === 'high'
            || s === 'danger' || s === 'error';
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('netflix-viz-status-chip');
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';

            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            var tip = document.createElement('div');
            tip.className = 'netflix-status-chip-tooltip';
            tip.style.display = 'none';
            this.el.appendChild(tip);
            this._tooltip = tip;

            this._lastData = null;
            this._lastConfig = null;
            this._lastGoodData = null;
            this._chipGeom = null;
            this._pulseHover = false;
            this._lastStatusRaw = '';
            this._pulseRaf = null;

            var self = this;
            this._boundMove = function(ev) {
                self._handleMove(ev);
            };
            this._boundLeave = function() {
                self._handleLeave();
            };
            canvas.addEventListener('mousemove', this._boundMove);
            canvas.addEventListener('mouseleave', this._boundLeave);
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
                    'Awaiting data — Netflix Status Chip'
                );
            }
            var fields = data.fields;
            var colIdx = {};
            var i;
            for (i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }
            var row = data.rows[data.rows.length - 1];
            var result = { colIdx: colIdx, row: row };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!data) return;
            this._lastData = data;
            this._lastConfig = config;
            this._cancelPulseRaf();
            this._render(data, config);
            this._maybeSchedulePulse();
        },

        _cancelPulseRaf: function() {
            if (this._pulseRaf !== null) {
                cancelAnimationFrame(this._pulseRaf);
                this._pulseRaf = null;
            }
        },

        _maybeSchedulePulse: function() {
            if (!this._pulseHover) return;
            if (!isPulseSeverity(this._lastStatusRaw)) return;
            var self = this;
            this._pulseRaf = requestAnimationFrame(function() {
                self._pulseRaf = null;
                if (!self._pulseHover || !self._lastData || !self._lastConfig) return;
                self._render(self._lastData, self._lastConfig);
                self._maybeSchedulePulse();
            });
        },

        _handleMove: function(ev) {
            var rect = this.canvas.getBoundingClientRect();
            var mx = ev.clientX - rect.left;
            var my = ev.clientY - rect.top;
            var hit = this._hitTest(mx, my);
            var nowHover = hit === 1;
            if (nowHover !== this._pulseHover) {
                this._pulseHover = nowHover;
                this._cancelPulseRaf();
                if (this._pulseHover) {
                    this._maybeSchedulePulse();
                } else {
                    if (this._lastData && this._lastConfig) {
                        this._render(this._lastData, this._lastConfig);
                    }
                }
            }
            this._updateTooltip(ev, nowHover, mx, my);
        },

        _handleLeave: function() {
            this._pulseHover = false;
            this._cancelPulseRaf();
            if (this._tooltip) this._tooltip.style.display = 'none';
            if (this._lastData && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
            }
        },

        _updateTooltip: function(ev, show, mx, my) {
            var tip = this._tooltip;
            if (!tip || !this._lastData) return;
            if (!show) {
                tip.style.display = 'none';
                return;
            }
            var ns = getNS(this);
            var cfg = this._lastConfig || {};
            var statusField = getOption(cfg, ns, 'statusField', 'status');
            var labelField = getOption(cfg, ns, 'labelField', 'label');
            var row = this._lastData.row;
            var colIdx = this._lastData.colIdx;
            var st = colIdx[statusField] !== undefined
                ? String(row[colIdx[statusField]] || '')
                : '';
            var lb = colIdx[labelField] !== undefined
                ? String(row[colIdx[labelField]] || '')
                : '';
            tip.textContent = st + (lb ? ' — ' + lb : '');
            tip.style.display = 'block';
            var er = this.el.getBoundingClientRect();
            var lx = (ev ? (ev.clientX - er.left) : mx) + 10;
            var ly = (ev ? (ev.clientY - er.top) : my) + 10;
            tip.style.left = lx + 'px';
            tip.style.top = ly + 'px';
        },

        _hitTest: function(cssX, cssY) {
            var g = this._chipGeom;
            if (!g) return -1;
            if (cssX < g.x || cssX > g.x + g.w || cssY < g.y || cssY > g.y + g.h) {
                return -1;
            }
            return 1;
        },

        _render: function(data, config) {
            var el = this.el;
            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            var ns = getNS(this);
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));
            var statusField = getOption(config, ns, 'statusField', 'status');
            var labelField = getOption(config, ns, 'labelField', 'label');
            var titleText = getOption(config, ns, 'title', '');
            var titleAlign = getOption(config, ns, 'titleAlign', 'center');
            var userFont = parseInt(getOption(config, ns, 'fontSize', '0'), 10);

            var row = data.row;
            var colIdx = data.colIdx;
            var statusRaw = colIdx[statusField] !== undefined
                ? String(row[colIdx[statusField]] || '')
                : 'unknown';
            var labelTxt = colIdx[labelField] !== undefined
                ? String(row[colIdx[labelField]] || '')
                : '';
            this._lastStatusRaw = statusRaw;

            var fillCol = theme.severityColor(t, statusRaw);

            ctx.fillStyle = t.bg;
            ctx.fillRect(0, 0, w, h);

            var phrase = labelTxt ? labelTxt : statusRaw;
            var padX = 18;
            var pillH = Math.max(28, Math.min(h * 0.55, 48));
            var fontPx = userFont > 0
                ? userFont
                : Math.max(11, pillH * 0.42);
            ctx.font = '600 ' + fontPx + 'px ' + theme.FONTS.ui;
            var textW = ctx.measureText(phrase).width;
            var pillW = textW + padX * 2;
            var pillX = (w - pillW) / 2;
            var titleH = 0;
            if (titleText) {
                titleH = Math.max(14, fontPx * 0.95) + 6;
                ctx.save();
                ctx.font = Math.max(10, fontPx * 0.78) + 'px ' + theme.FONTS.ui;
                ctx.fillStyle = t.textDim;
                ctx.textBaseline = 'top';
                if (titleAlign === 'left') {
                    ctx.textAlign = 'left';
                    ctx.fillText(titleText, 10, 8);
                } else if (titleAlign === 'right') {
                    ctx.textAlign = 'right';
                    ctx.fillText(titleText, w - 10, 8);
                } else {
                    ctx.textAlign = 'center';
                    ctx.fillText(titleText, w / 2, 8);
                }
                ctx.restore();
            }
            var pillY = titleH + (h - titleH - pillH) / 2;
            if (pillY < titleH + 4) pillY = titleH + 4;
            var r = pillH / 2;

            this._chipGeom = { x: pillX, y: pillY, w: pillW, h: pillH };

            var pulseExtra = 0;
            if (this._pulseHover && isPulseSeverity(statusRaw)) {
                pulseExtra = 4 + Math.sin(Date.now() / 180) * 4;
            }

            ctx.save();
            ctx.shadowColor = fillCol;
            ctx.shadowBlur = 14 + pulseExtra;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            theme.roundRect(ctx, pillX, pillY, pillW, pillH, r);
            ctx.fillStyle = fillCol;
            ctx.fill();
            ctx.restore();
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            ctx.save();
            theme.roundRect(ctx, pillX, pillY, pillW, pillH, r);
            ctx.strokeStyle = theme.withAlpha('#FFFFFF', 0.22);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();

            var textColor = t.invert;
            ctx.font = '600 ' + fontPx + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(phrase, pillX + pillW / 2, pillY + pillH / 2);
        },

        reflow: function() {
            if (this._lastData && this._lastConfig) {
                this._render(this._lastData, this._lastConfig);
                this._maybeSchedulePulse();
            }
        },

        destroy: function() {
            this._cancelPulseRaf();
            if (this.canvas && this._boundMove) {
                this.canvas.removeEventListener('mousemove', this._boundMove);
                this.canvas.removeEventListener('mouseleave', this._boundLeave);
            }
            if (this._tooltip && this._tooltip.parentNode) {
                this._tooltip.parentNode.removeChild(this._tooltip);
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
