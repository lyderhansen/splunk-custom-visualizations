/*
 * ACME Dashboard Frame — full canvas wrapper.
 *
 * Composes app bar (48 px) + breadcrumb / title block + status pills +
 * optional filter strip + body slot + footer.
 *
 * Drilldown (FIELD_VALUE_DRILLDOWN action):
 *   - status pill click: { pill: "<label>", value: "<value>", pillIndex: <n> }
 *   - wordmark click:    { pill: "wordmark" }
 *   - filter chip click: { filter: "<label>", value: "<value>" }
 *   - run-search click:  { filter: "_run" }
 *
 * Status pill format:
 *   "Label:Value:#color|Label:Value:#color|…"
 *   omit value with "Label::#color".
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-dashboard-frame-viz');
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
            var appName = config[ns + 'appName'] || 'Enterprise Security';
            var crumb = config[ns + 'breadcrumb'] || 'Apps · Enterprise Security · Dashboards';
            var title = config[ns + 'title'] || 'Security operations overview';
            var subtitle = config[ns + 'subtitle'] || 'Real-time across all production indexes';
            var pillsRaw = config[ns + 'statusPills'] || 'Notables:1247:#ff6600|Open:182:#cba700|Healthy::#118832';
            var footerL = config[ns + 'footerLeft'] || '';
            var footerR = config[ns + 'footerRight'] || '';
            var showFilters = String(config[ns + 'showFilters'] || 'true') !== 'false';
            var titleFontSize = parseInt(config[ns + 'titleFontSize'] || '26', 10);
            var subtitleFontSize = parseInt(config[ns + 'subtitleFontSize'] || '13', 10);
            var bgColor = config[ns + 'bgColor'] || t.bg;
            var sidePad = parseInt(config[ns + 'sidePadding'] || '28', 10);
            var pillRadius = parseFloat(config[ns + 'pillRadius'] || '4');
            var userInitials = config[ns + 'userInitials'] || 'JH';
            var avatarColor = config[ns + 'avatarColor'] || t.s4;
            var showAppBar = String(config[ns + 'showAppBar'] || 'true') !== 'false';
            var showFooter = String(config[ns + 'showFooter'] || 'true') !== 'false';

            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            this._hitRects = [];

            // Backdrop.
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, rect.width, rect.height);

            var topY = 0;

            // ── App bar (48 px) ──
            if (showAppBar) {
                var barH = 48;
                ctx.fillStyle = t.panel;
                ctx.fillRect(0, 0, rect.width, barH);
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, barH - 0.5);
                ctx.lineTo(rect.width, barH - 0.5);
                ctx.stroke();

                ctx.textBaseline = 'middle';
                var bx = 18;
                var wordmarkX = bx;
                ctx.fillStyle = t.orange;
                ctx.font = '700 17px ' + T.FONTS.ui;
                ctx.fillText('›', bx, barH / 2);
                bx += 14;
                ctx.fillStyle = t.text;
                ctx.fillText('splunk', bx, barH / 2);
                var wordmarkW = ctx.measureText('splunk').width + 14 + 6;
                bx += ctx.measureText('splunk').width + 14;
                this._hitRects.push({
                    x: wordmarkX - 4, y: barH / 2 - 12, w: wordmarkW + 8, h: 24,
                    payload: { pill: 'wordmark', pillIndex: -1 }
                });
                ctx.fillStyle = t.textFaint;
                ctx.fillText('|', bx, barH / 2);
                bx += 14;
                ctx.fillStyle = t.textDim;
                ctx.font = '500 13px ' + T.FONTS.ui;
                ctx.fillText(appName, bx, barH / 2);

                // Right of app bar — timestamp + avatar.
                var d = new Date();
                var ts = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                ctx.font = '500 12px ' + T.FONTS.mono;
                ctx.fillStyle = t.textDim;
                var tsW = ctx.measureText(ts).width;
                ctx.fillText(ts, rect.width - 18 - 28 - 12 - tsW, barH / 2);
                ctx.beginPath();
                ctx.arc(rect.width - 18 - 14, barH / 2, 14, 0, Math.PI * 2);
                ctx.fillStyle = avatarColor;
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = '600 11px ' + T.FONTS.ui;
                ctx.textAlign = 'center';
                ctx.fillText(userInitials, rect.width - 18 - 14, barH / 2);
                ctx.textAlign = 'left';
                topY = barH;
            }

            // ── Breadcrumb / title block ──
            var titleY = topY + 18;
            ctx.fillStyle = t.textDim;
            ctx.font = '400 12px ' + T.FONTS.ui;
            ctx.textBaseline = 'top';
            ctx.fillText(crumb, sidePad, titleY);

            ctx.fillStyle = t.text;
            ctx.font = '700 ' + titleFontSize + 'px ' + T.FONTS.ui;
            ctx.fillText(title, sidePad, titleY + 22);

            ctx.fillStyle = t.textDim;
            ctx.font = '500 ' + subtitleFontSize + 'px ' + T.FONTS.ui;
            ctx.fillText(subtitle, sidePad, titleY + 22 + titleFontSize + 8);

            // ── Status pills ──
            var pillsY = titleY + 16;
            var pillX = rect.width - sidePad;
            var pillH = 28;
            ctx.font = '500 12px ' + T.FONTS.ui;
            ctx.textBaseline = 'middle';
            var pills = pillsRaw.split('|');
            // Render right-to-left so the order in the config reads left-to-right.
            for (var pi = pills.length - 1; pi >= 0; pi--) {
                var seg = pills[pi].trim();
                if (!seg) continue;
                var parts = seg.split(':');
                var lbl = parts[0] || '';
                var val = parts[1] || '';
                var pcolor = parts[2] || t.orange;

                ctx.font = '500 12px ' + T.FONTS.ui;
                var lW = lbl ? ctx.measureText(lbl).width : 0;
                ctx.font = '600 13px ' + T.FONTS.mono;
                var vW = val ? ctx.measureText(val).width : 0;
                var totalW = 8 + 8 + lW + (val ? 8 + vW : 0) + 14;
                pillX -= totalW;

                T.roundRect(ctx, pillX, pillsY, totalW, pillH, pillRadius);
                ctx.fillStyle = t.panel;
                ctx.fill();
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = pcolor;
                ctx.beginPath();
                ctx.arc(pillX + 12, pillsY + pillH / 2, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = t.textDim;
                ctx.font = '500 12px ' + T.FONTS.ui;
                ctx.fillText(lbl, pillX + 22, pillsY + pillH / 2);
                if (val) {
                    ctx.fillStyle = t.text;
                    ctx.font = '600 13px ' + T.FONTS.mono;
                    ctx.fillText(val, pillX + 22 + lW + 8, pillsY + pillH / 2);
                }
                this._hitRects.push({
                    x: pillX, y: pillsY, w: totalW, h: pillH,
                    payload: { pill: lbl, value: val, pillIndex: pi }
                });
                pillX -= 8;
            }

            // ── Filter strip ──
            if (showFilters) {
                var stripY = titleY + 22 + titleFontSize + 8 + subtitleFontSize + 22;
                ctx.strokeStyle = t.edge;
                ctx.beginPath();
                ctx.moveTo(sidePad, stripY + 0.5);
                ctx.lineTo(rect.width - sidePad, stripY + 0.5);
                ctx.stroke();

                var fy = stripY + 12;
                var fxx = sidePad;
                var sample = ['Time range:Last 24 hours', 'Environment:Production', 'Index:notable', 'Severity:All'];
                for (var fi2 = 0; fi2 < sample.length; fi2++) {
                    var s = sample[fi2];
                    var c = s.indexOf(':');
                    var fl = s.slice(0, c) + ':';
                    var fv = s.slice(c + 1);
                    ctx.font = '500 12px ' + T.FONTS.ui;
                    var flW = ctx.measureText(fl).width + 4;
                    var fvW = ctx.measureText(fv).width;
                    var cw = flW + fvW + 14 + 24;
                    T.roundRect(ctx, fxx, fy, cw, 28, pillRadius);
                    ctx.fillStyle = t.panel;
                    ctx.fill();
                    ctx.strokeStyle = t.edge;
                    ctx.stroke();
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = t.textFaint;
                    ctx.fillText(fl, fxx + 12, fy + 14);
                    ctx.fillStyle = t.text;
                    ctx.fillText(fv, fxx + 12 + flW, fy + 14);
                    ctx.fillStyle = t.textFaint;
                    ctx.font = '500 10px ' + T.FONTS.ui;
                    ctx.fillText('▾', fxx + cw - 14, fy + 14);
                    this._hitRects.push({
                        x: fxx, y: fy, w: cw, h: 28,
                        payload: { filter: s.slice(0, c), value: fv, filterIndex: fi2 }
                    });
                    fxx += cw + 10;
                }
                // Run search CTA.
                var ctaW = 110, ctaH = 30;
                var ctaX = rect.width - sidePad - ctaW;
                T.roundRect(ctx, ctaX, fy - 1, ctaW, ctaH, pillRadius);
                ctx.fillStyle = t.orange;
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = '600 13px ' + T.FONTS.ui;
                ctx.textAlign = 'center';
                ctx.fillText('Run search', ctaX + ctaW / 2, fy + 13);
                ctx.textAlign = 'left';
                this._hitRects.push({
                    x: ctaX, y: fy - 1, w: ctaW, h: ctaH,
                    payload: { filter: '_run', value: 'run', filterIndex: -1 }
                });
            }

            // ── Footer ──
            if (showFooter) {
                var footerH = 40;
                var fy2 = rect.height - footerH;
                ctx.strokeStyle = t.edge;
                ctx.beginPath();
                ctx.moveTo(0, fy2 + 0.5);
                ctx.lineTo(rect.width, fy2 + 0.5);
                ctx.stroke();
                ctx.fillStyle = t.textFaint;
                ctx.font = '400 11.5px ' + T.FONTS.mono;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                if (footerL) ctx.fillText(footerL, sidePad, fy2 + footerH / 2);
                ctx.textAlign = 'right';
                if (footerR) ctx.fillText(footerR, rect.width - sidePad, fy2 + footerH / 2);
                ctx.textAlign = 'left';
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
