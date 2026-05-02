/*
 * ACME Filter Chip Strip — clickable dropdown chips + Run-search CTA.
 *
 * Drilldown payloads (FIELD_VALUE_DRILLDOWN action):
 *   - chip click:  { filter: "<label>", value: "<value>", filterIndex: <n> }
 *   - CTA click:   { filter: "_run", value: "run" }
 *
 * Filter format (config):
 *   "Label:Value|Label:Value|…"
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-filter-strip-viz');
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.el.appendChild(this.canvas);
            this._hitRects = [];

            var self = this;
            this.canvas.addEventListener('click', function (event) {
                var hit = self._findHit(event);
                if (!hit) return;
                event.preventDefault();
                self.drilldown({
                    action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
                    data: hit.payload
                }, event);
            });
            this.canvas.addEventListener('mousemove', function (event) {
                self.canvas.style.cursor = self._findHit(event) ? 'pointer' : 'default';
            });
        },

        _findHit: function (event) {
            if (!this._hitRects || !this._hitRects.length) return null;
            var rect = this.canvas.getBoundingClientRect();
            var x = event.clientX - rect.left;
            var y = event.clientY - rect.top;
            for (var i = 0; i < this._hitRects.length; i++) {
                var r = this._hitRects[i];
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
            }
            return null;
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 1 };
        },

        formatData: function (data) { return data || {}; },

        updateView: function (data, config) {
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = config[ns + 'theme'] || 'dark';
            var t = T.getTheme(themeName);
            var raw = config[ns + 'filters'] ||
                'Time range:Last 24 hours|Environment:Production|Index:notable|Severity:All';
            var ctaLabel = config[ns + 'ctaLabel'] || 'Run search';
            var ctaColor = config[ns + 'ctaColor'] || t.orange;
            var chipRadius = parseFloat(config[ns + 'chipRadius'] || '4');
            var chipGap = parseFloat(config[ns + 'chipGap'] || '10');
            var showCaret = String(config[ns + 'showCaret'] || 'true') !== 'false';
            var showCta = String(config[ns + 'showCta'] || 'true') !== 'false';
            var sidePad = parseFloat(config[ns + 'sidePadding'] || '14');
            var caretGlyph = config[ns + 'caretGlyph'] || '▾';

            var filters = [];
            var groups = raw.split('|');
            for (var i = 0; i < groups.length; i++) {
                var g = groups[i].trim();
                if (!g) continue;
                var c = g.indexOf(':');
                if (c < 0) filters.push({ label: '', value: g });
                else filters.push({ label: g.slice(0, c).trim(), value: g.slice(c + 1).trim() });
            }

            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, rect.width, rect.height);
            this._hitRects = [];

            // Top edge.
            ctx.strokeStyle = t.edge;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, 0.5);
            ctx.lineTo(rect.width, 0.5);
            ctx.stroke();

            var cy = rect.height / 2;
            ctx.textBaseline = 'middle';
            var pillH = 28;

            // CTA metrics — right side.
            var ctaX = rect.width - sidePad;
            var ctaY = cy;
            var ctaW = 0, ctaH = 30;
            if (showCta) {
                ctx.font = '600 13px ' + T.FONTS.ui;
                var ctaTextW = ctx.measureText(ctaLabel).width;
                ctaW = ctaTextW + 28;
                ctaX = rect.width - sidePad - ctaW;
            }

            // Draw chips.
            var x = sidePad;
            for (var fi = 0; fi < filters.length; fi++) {
                var lbl = filters[fi].label ? (filters[fi].label + ':') : '';
                var val = filters[fi].value;
                ctx.font = '500 12px ' + T.FONTS.ui;
                var labW = lbl ? ctx.measureText(lbl).width + 4 : 0;
                var valW = ctx.measureText(val).width;
                var caretW = showCaret ? 14 : 0;
                var pillW = labW + valW + caretW + 24;

                if (x + pillW > ctaX - 12) break;
                T.roundRect(ctx, x, cy - pillH / 2, pillW, pillH, chipRadius);
                ctx.fillStyle = t.panel;
                ctx.fill();
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.stroke();

                if (lbl) {
                    ctx.fillStyle = t.textFaint;
                    ctx.fillText(lbl, x + 12, cy);
                }
                ctx.fillStyle = t.text;
                ctx.fillText(val, x + 12 + labW, cy);
                if (showCaret) {
                    ctx.fillStyle = t.textFaint;
                    ctx.font = '500 10px ' + T.FONTS.ui;
                    ctx.fillText(caretGlyph, x + pillW - 14, cy);
                }
                this._hitRects.push({
                    x: x, y: cy - pillH / 2, w: pillW, h: pillH,
                    payload: { filter: filters[fi].label, value: filters[fi].value, filterIndex: fi }
                });
                x += pillW + chipGap;
            }

            // CTA.
            if (showCta) {
                T.roundRect(ctx, ctaX, ctaY - ctaH / 2, ctaW, ctaH, chipRadius);
                ctx.fillStyle = ctaColor;
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = '600 13px ' + T.FONTS.ui;
                ctx.textAlign = 'center';
                ctx.fillText(ctaLabel, ctaX + ctaW / 2, ctaY);
                ctx.textAlign = 'left';
                this._hitRects.push({
                    x: ctaX, y: ctaY - ctaH / 2, w: ctaW, h: ctaH,
                    payload: { filter: '_run', value: 'run', filterIndex: -1 }
                });
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
