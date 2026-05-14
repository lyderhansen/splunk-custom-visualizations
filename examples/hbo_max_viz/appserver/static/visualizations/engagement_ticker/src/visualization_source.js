/*
 * HBO Max Engagement Ticker — ES5 horizontal scrolling event band.
 */
define([
    'api/SplunkVisualizationBase'
], function (SplunkVisualizationBase) {
    var theme = require('shared/theme');

    function getOption(config, ns, key, defaultValue) {
        var v = config[ns + key];
        if (v !== undefined && v !== null) return v;
        v = config[key];
        if (v !== undefined && v !== null) return v;
        return defaultValue;
    }

    function fieldIndex(fields, name) {
        var i;
        for (i = 0; i < fields.length; i++) {
            if (fields[i].name === name) return i;
        }
        return -1;
    }

    function extractEvents(data, f1name, f2name) {
        var fields = data.fields || [];
        var rows = data.rows || [];
        var i1 = fieldIndex(fields, f1name);
        var i2 = fieldIndex(fields, f2name);
        var out = [];
        if (i1 < 0 || i2 < 0) {
            return out;
        }
        var r;
        for (r = 0; r < rows.length; r++) {
            var a = rows[r][i1];
            var b = rows[r][i2];
            if (a === null || a === undefined) a = '';
            if (b === null || b === undefined) b = '';
            out.push({ f1: String(a), f2: String(b) });
        }
        return out;
    }

    function speedFromChoice(choice) {
        var c = (choice || 'medium').toString().toLowerCase();
        if (c === 'slow') return 0.3;
        if (c === 'fast') return 1.0;
        return 0.6;
    }

    return SplunkVisualizationBase.extend({
        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this._canvas = null;
            this._ctx = null;
            this._tooltip = null;
            this._wrap = null;
            this._layout = { w: 0, h: 0, dpr: 1 };
            this._animTimer = null;
            this._scroll = 0;
            this._events = [];
            this._layoutItems = [];
            this._totalChain = 1;
            this._speed = 0.6;
            this._tipHtml = '';
            this._mx = -1;
            this._my = -1;
            this._hoverI = -1;
            this._lastConfig = {};
            this._lastData = null;
        },

        destroy: function () {
            if (this._animTimer) {
                clearInterval(this._animTimer);
                this._animTimer = null;
            }
            if (SplunkVisualizationBase.prototype.destroy) {
                SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
            }
        },

        reflow: function () {
            this.invalidateUpdateView();
        },

        _ensureUi: function (root) {
            if (this._canvas) return;
            this._wrap = document.createElement('div');
            this._wrap.style.position = 'relative';
            this._wrap.style.width = '100%';
            this._wrap.style.height = '100%';
            this._canvas = document.createElement('canvas');
            this._canvas.style.display = 'block';
            this._canvas.style.width = '100%';
            this._canvas.style.height = '100%';
            this._wrap.appendChild(this._canvas);
            root.appendChild(this._wrap);
            this._ctx = this._canvas.getContext('2d');

            this._tooltip = document.createElement('div');
            this._tooltip.setAttribute('role', 'tooltip');
            this._tooltip.style.cssText = [
                'position:absolute',
                'z-index:50',
                'pointer-events:none',
                'display:none',
                'max-width:360px',
                'padding:8px 10px',
                'border-radius:6px',
                'font:12px ' + theme.FONTS.ui.replace(/"/g, ''),
                'box-shadow:0 6px 24px rgba(0,0,0,0.35)',
                'white-space:pre-wrap'
            ].join(';');
            this._wrap.appendChild(this._tooltip);

            var self = this;
            this._canvas.addEventListener('mousemove', function (ev) {
                self._onMove(ev);
            });
            this._canvas.addEventListener('mouseleave', function () {
                self._mx = -1;
                self._my = -1;
                self._hoverI = -1;
                if (self._tooltip) self._tooltip.style.display = 'none';
                self.invalidateUpdateView();
            });

            this._animTimer = setInterval(function () {
                self._tick();
            }, 33);
        },

        _onMove: function (ev) {
            var rect = this._canvas.getBoundingClientRect();
            this._mx = ev.clientX - rect.left;
            this._my = ev.clientY - rect.top;
            this.invalidateUpdateView();
        },

        _tick: function () {
            this._scroll += this._speed;
            this.invalidateUpdateView();
        },

        _measureChain: function (ctx, events, accentColor, th, h) {
            var fontPx = Math.max(10, Math.round(h * 0.34));
            ctx.font = '500 ' + fontPx + 'px ' + theme.FONTS.ui;
            var pipe = ' | ';
            var gap = 28;
            var items = [];
            var total = 0;
            var i;
            for (i = 0; i < events.length; i++) {
                var t1 = events[i].f1;
                var t2 = events[i].f2;
                var mid = t1 + pipe + t2;
                var wDot = 10;
                var wText = ctx.measureText(mid).width;
                var w = wDot + 8 + wText + gap;
                items.push({ f1: t1, f2: t2, w: w, mid: mid, dotX: 0, textX: 0, y: 0 });
                total += w;
            }
            if (total < 1) {
                total = 1;
            }
            return { items: items, fontPx: fontPx, total: total, pipe: pipe };
        },

        updateView: function (data, config) {
            var root = this.el;
            if (!root) return;
            this._ensureUi(root);
            this._lastData = data;
            this._lastConfig = config;

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var f1 = getOption(config, ns, 'field1', 'user');
            var f2 = getOption(config, ns, 'field2', 'action');
            var accentColor = getOption(config, ns, 'accentColor', '#7B61FF');
            var speedKey = getOption(config, ns, 'scrollSpeed', 'medium');
            this._speed = speedFromChoice(speedKey);
            var themeName = getOption(config, ns, 'theme', 'dark');
            var th = theme.getTheme(themeName === 'light' ? 'light' : 'dark');
            var events = extractEvents(data, f1, f2);
            this._events = events;

            var cr = root.getBoundingClientRect();
            var cssW = Math.max(1, Math.floor(cr.width));
            var cssH = Math.max(1, Math.floor(cr.height));
            var dpr = window.devicePixelRatio || 1;
            if (this._layout.w !== cssW || this._layout.h !== cssH || this._layout.dpr !== dpr) {
                this._canvas.width = Math.floor(cssW * dpr);
                this._canvas.height = Math.floor(cssH * dpr);
                this._canvas.style.width = cssW + 'px';
                this._canvas.style.height = cssH + 'px';
                this._layout = { w: cssW, h: cssH, dpr: dpr };
            }

            this._tooltip.style.background = th.panelHi;
            this._tooltip.style.color = th.text;
            this._tooltip.style.border = '1px solid ' + th.edgeStrong;

            var ctx = this._ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            ctx.fillStyle = th.bg;
            ctx.fillRect(0, 0, cssW, cssH);

            var bandY = Math.round(cssH * 0.28);
            var bandH = Math.max(22, Math.round(cssH * 0.44));
            var meas = this._measureChain(ctx, events, accentColor, th, bandH);
            var items = meas.items;
            var total = meas.total;
            this._totalChain = total;
            this._layoutItems = items;

            var fontPx = meas.fontPx;
            var midY = bandY + bandH * 0.52;

            var shift = this._scroll % total;
            if (shift < 0) {
                shift += total;
            }
            var x = -shift;
            if (items.length > 0) {
                while (x < cssW + total) {
                    var idx;
                    for (idx = 0; idx < items.length; idx++) {
                        var it = items[idx];
                        var ix = x;
                        x += it.w;
                        if (ix > cssW + 40 || ix + it.w < -40) {
                            continue;
                        }
                        var dx = ix + 5;
                        var ty = midY;
                        ctx.fillStyle = accentColor;
                        ctx.beginPath();
                        ctx.arc(dx + 3, ty, 3.2, 0, Math.PI * 2);
                        ctx.fill();
                        var tx = dx + 14;
                        ctx.fillStyle = th.textDim;
                        var part1 = it.f1;
                        var part2 = it.f2;
                        ctx.fillText(part1, tx, ty);
                        var w1 = ctx.measureText(part1).width;
                        ctx.fillStyle = th.textFaint;
                        ctx.fillText(meas.pipe, tx + w1, ty);
                        var wp = ctx.measureText(meas.pipe).width;
                        ctx.fillStyle = th.text;
                        ctx.fillText(part2, tx + w1 + wp, ty);
                    }
                }
            }

            var fadeW = Math.min(80, Math.round(cssW * 0.12));
            var gL = ctx.createLinearGradient(0, 0, fadeW, 0);
            gL.addColorStop(0, th.bg);
            gL.addColorStop(1, theme.withAlpha(th.bg, 0));
            ctx.fillStyle = gL;
            ctx.fillRect(0, 0, fadeW, cssH);

            var gR = ctx.createLinearGradient(cssW - fadeW, 0, cssW, 0);
            gR.addColorStop(0, theme.withAlpha(th.bg, 0));
            gR.addColorStop(1, th.bg);
            ctx.fillStyle = gR;
            ctx.fillRect(cssW - fadeW, 0, fadeW, cssH);

            var pulse = 0.55 + 0.45 * Math.sin(new Date().getTime() / 220);
            var pillX = 10;
            var pillY = 8;
            var pillW = 54;
            var pillH = 20;
            ctx.save();
            theme.roundRect(ctx, pillX, pillY, pillW, pillH, 10);
            ctx.fillStyle = th.panelHi;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = th.edgeStrong;
            ctx.stroke();
            ctx.beginPath();
            ctx.fillStyle = theme.withAlpha(accentColor, pulse);
            ctx.arc(pillX + 14, pillY + pillH * 0.5, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = th.text;
            ctx.font = '600 10px ' + theme.FONTS.ui;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('LIVE', pillX + 24, pillY + pillH * 0.5);
            ctx.restore();

            this._hoverI = -1;
            if (this._mx >= 0 && this._my >= 0 && events.length > 0) {
                if (this._my >= bandY && this._my <= bandY + bandH) {
                    var localX = this._mx + shift;
                    localX = localX % total;
                    if (localX < 0) {
                        localX += total;
                    }
                    var acc = 0;
                    var hit = -1;
                    var hi;
                    for (hi = 0; hi < items.length; hi++) {
                        var wz = items[hi].w;
                        if (localX >= acc && localX < acc + wz) {
                            hit = hi;
                            break;
                        }
                        acc += wz;
                    }
                    this._hoverI = hit;
                    if (hit >= 0) {
                        var ev = events[hit];
                        this._tipHtml = '<b>' + String(f1) + '</b>: ' + String(ev.f1) +
                            '<br/><b>' + String(f2) + '</b>: ' + String(ev.f2);
                    } else {
                        this._tipHtml = '';
                    }
                } else {
                    this._tipHtml = '';
                }
            } else {
                this._tipHtml = events.length ? 'Hover an event for details' : 'No data';
            }

            if (this._tooltip) {
                if (this._mx >= 0 && this._hoverI >= 0 && this._tipHtml) {
                    this._tooltip.innerHTML = this._tipHtml;
                    this._tooltip.style.display = 'block';
                    var txp = this._mx + 14;
                    var typ = this._my + 14;
                    if (txp + 240 > cssW) txp = this._mx - 240;
                    if (typ + 72 > cssH) typ = this._my - 72;
                    this._tooltip.style.left = Math.round(txp) + 'px';
                    this._tooltip.style.top = Math.round(typ) + 'px';
                } else {
                    this._tooltip.style.display = 'none';
                }
            }
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 50 };
        },

        formatData: function (data) {
            return data;
        }
    });
});
