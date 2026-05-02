/*
 * ACME Splunk App Bar — top-level navigation shell.
 *
 * Clickable: each nav item, the wordmark, and the user avatar fire a
 * drilldown event so dashboard authors can wire them to set tokens or
 * link to other dashboards.
 *
 * Drilldown payload (FIELD_VALUE_DRILLDOWN action):
 *   - clicking a nav item:  { nav: "<item label>", navIndex: <index> }
 *   - clicking the wordmark: { nav: "wordmark" }
 *   - clicking the avatar:   { nav: "user" }
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-app-bar-viz');
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
            var navRaw = config[ns + 'navItems'] || 'Apps,Search & Reporting,Dashboards,Alerts,Datasets';
            var activeIdx = parseInt(config[ns + 'activeNavIndex'] || '2', 10);
            var initials = config[ns + 'userInitials'] || 'JH';
            var timestamp = config[ns + 'timestamp'] || '';
            var wordmarkSize = parseInt(config[ns + 'wordmarkSize'] || '17', 10);
            var navGap = parseInt(config[ns + 'navGap'] || '18', 10);
            var navUnderlineColor = config[ns + 'navUnderlineColor'] || t.orange;
            var avatarColor = config[ns + 'avatarColor'] || t.s4;
            var separator = config[ns + 'separator'] || '|';
            var showAvatar = String(config[ns + 'showAvatar'] || 'true') !== 'false';
            var showTimestamp = String(config[ns + 'showTimestamp'] || 'true') !== 'false';

            if (!timestamp && showTimestamp) {
                var d = new Date();
                timestamp = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            }
            var navItems = navRaw.split(',').map(function (s) { return s.trim(); });

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

            // Background.
            ctx.fillStyle = t.panel;
            ctx.fillRect(0, 0, rect.width, rect.height);
            ctx.strokeStyle = t.edge;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, rect.height - 0.5);
            ctx.lineTo(rect.width, rect.height - 0.5);
            ctx.stroke();

            var cy = rect.height / 2;
            ctx.textBaseline = 'middle';

            // ── Left cluster ──
            var x = 18;
            var wordmarkX = x;
            ctx.fillStyle = t.orange;
            ctx.font = '700 ' + wordmarkSize + 'px ' + T.FONTS.ui;
            ctx.fillText('›', x, cy);
            x += wordmarkSize - 3;
            ctx.fillStyle = t.text;
            ctx.fillText('splunk', x, cy);
            var wordmarkW = ctx.measureText('splunk').width + (wordmarkSize - 3) + 6;
            x += ctx.measureText('splunk').width + 14;
            this._hitRects.push({
                x: wordmarkX - 4, y: cy - wordmarkSize, w: wordmarkW + 8, h: wordmarkSize * 2,
                payload: { nav: 'wordmark', navIndex: -1 }
            });
            if (separator) {
                ctx.fillStyle = t.textFaint;
                ctx.fillText(separator, x, cy);
                x += 14;
            }
            ctx.fillStyle = t.textDim;
            ctx.font = '500 13px ' + T.FONTS.ui;
            ctx.fillText(appName, x, cy);

            // ── Right cluster ──
            var rightX = rect.width - 18;
            if (showAvatar) {
                var avSize = Math.min(28, rect.height - 10);
                var avX = rightX - avSize;
                ctx.beginPath();
                ctx.arc(avX + avSize / 2, cy, avSize / 2, 0, Math.PI * 2);
                ctx.fillStyle = avatarColor;
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = '600 11px ' + T.FONTS.ui;
                ctx.textAlign = 'center';
                ctx.fillText(initials, avX + avSize / 2, cy);
                ctx.textAlign = 'left';
                this._hitRects.push({
                    x: avX, y: cy - avSize / 2, w: avSize, h: avSize,
                    payload: { nav: 'user', navIndex: -1 }
                });
                rightX = avX - 12;
            }
            if (showTimestamp && timestamp) {
                ctx.font = '500 12px ' + T.FONTS.mono;
                ctx.fillStyle = t.textDim;
                var tsW = ctx.measureText(timestamp).width;
                ctx.fillText(timestamp, rightX - tsW, cy);
                rightX -= tsW + 12;
            }

            // ── Centre cluster — nav ──
            ctx.font = '500 13px ' + T.FONTS.ui;
            var widths = [];
            var totalNav = 0;
            for (var i = 0; i < navItems.length; i++) {
                var w = ctx.measureText(navItems[i]).width;
                widths.push(w);
                totalNav += w;
            }
            totalNav += navGap * Math.max(0, navItems.length - 1);
            var nx = (rect.width - totalNav) / 2;
            for (var ni = 0; ni < navItems.length; ni++) {
                var active = ni === activeIdx;
                ctx.fillStyle = active ? t.text : t.textDim;
                ctx.font = (active ? '600 ' : '500 ') + '13px ' + T.FONTS.ui;
                ctx.fillText(navItems[ni], nx, cy);
                if (active) {
                    ctx.fillStyle = navUnderlineColor;
                    ctx.fillRect(nx, rect.height - 2, widths[ni], 2);
                }
                this._hitRects.push({
                    x: nx - 4, y: cy - 12, w: widths[ni] + 8, h: 24,
                    payload: { nav: navItems[ni], navIndex: ni }
                });
                nx += widths[ni] + navGap;
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
