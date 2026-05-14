/*
 * App Bar — Splunk Custom Visualization
 *
 * Top-level navigation shell replacing stock Splunk header for
 * big-screen / kiosk dashboards. 48 px tall.
 *
 * Anatomy (left → right):
 *   Left cluster  — orange chevron + "splunk" wordmark | app name
 *   Center cluster — nav items (active item has orange underline)
 *   Right cluster  — timestamp + user avatar circle
 *
 * Config-driven: theme, appName, navItems, activeNavIndex, userInitials,
 *                showTimestamp.
 * SPL: | makeresults | eval app="Enterprise Security"
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {

    var BAR_HEIGHT = 48;

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-app-bar-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
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
                    'Awaiting data — App Bar'
                );
            }

            var result = { rows: data.rows };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            // ── Read settings ──
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName      = config[ns + 'theme']          || 'dark';
            var appName        = config[ns + 'appName']        || 'Enterprise Security';
            var navItemsStr    = config[ns + 'navItems']       || 'Apps,Search & Reporting,Dashboards,Alerts,Datasets';
            var activeNavIdx   = parseInt(config[ns + 'activeNavIndex'] || '2', 10);
            var userInitials   = config[ns + 'userInitials']   || 'SC';
            var showTimestamp  = (config[ns + 'showTimestamp']  || 'true') === 'true';

            var theme = tokens.getTheme(themeName);
            var fonts = tokens.fonts;

            // Parse nav items
            var navItems = navItemsStr.split(',');
            for (var ni = 0; ni < navItems.length; ni++) {
                navItems[ni] = navItems[ni].replace(/^\s+|\s+$/g, '');
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
            var barH = Math.min(BAR_HEIGHT, h);
            ctx.clearRect(0, 0, w, h);

            // ── Background ──
            ctx.fillStyle = theme.panel;
            ctx.fillRect(0, 0, w, barH);

            // ── Bottom border ──
            ctx.fillStyle = theme.edge;
            ctx.fillRect(0, barH - 1, w, 1);

            // ── Left cluster ──
            var padL = 16;
            var curX = padL;
            var midY = barH / 2;

            // Orange chevron
            ctx.font = '700 17px ' + fonts.primary;
            ctx.fillStyle = theme.orange;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText('›', curX, midY);
            curX += ctx.measureText('›').width + 2;

            // "splunk" text
            ctx.font = '700 17px ' + fonts.primary;
            ctx.letterSpacing = '-0.02em';
            ctx.fillStyle = theme.text;
            ctx.fillText('splunk', curX, midY);
            curX += ctx.measureText('splunk').width + 14;

            // Reset letter-spacing
            ctx.letterSpacing = '0em';

            // Separator
            ctx.font = '400 14px ' + fonts.primary;
            ctx.fillStyle = theme.textFaint;
            ctx.fillText('|', curX, midY);
            curX += ctx.measureText('|').width + 14;

            // App name
            ctx.font = '500 13px ' + fonts.primary;
            ctx.fillStyle = theme.textDim;
            var maxAppW = w * 0.2;
            var truncApp = draw.ellipsis(ctx, appName, maxAppW);
            ctx.fillText(truncApp, curX, midY);
            var leftClusterEnd = curX + ctx.measureText(truncApp).width;

            // ── Right cluster ──
            var padR = 16;
            var rightX = w - padR;

            // User avatar circle
            var avatarR = 14;
            var avatarCX = rightX - avatarR;
            ctx.beginPath();
            ctx.arc(avatarCX, midY, avatarR, 0, Math.PI * 2);
            ctx.fillStyle = theme.s4;
            ctx.fill();

            // Initials
            ctx.font = '600 14px ' + fonts.primary;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(userInitials, avatarCX, midY);

            rightX = avatarCX - avatarR - 16;

            // Timestamp
            if (showTimestamp) {
                var now = new Date();
                var hours = now.getHours();
                var mins = now.getMinutes();
                var ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                if (hours === 0) hours = 12;
                var minStr = mins < 10 ? '0' + mins : String(mins);
                var timeStr = hours + ':' + minStr + ' ' + ampm;

                ctx.font = '400 12px ' + fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(timeStr, rightX, midY);
                rightX -= ctx.measureText(timeStr).width + 20;
            }

            var rightClusterStart = rightX;

            // ── Center cluster (nav items) ──
            var navGap = 18;
            var navFontSize = 13;

            // Measure total nav width
            var totalNavW = 0;
            var navWidths = [];
            for (var m = 0; m < navItems.length; m++) {
                var isActive = m === activeNavIdx;
                ctx.font = (isActive ? '600 ' : '500 ') + navFontSize + 'px ' + fonts.primary;
                var nw = ctx.measureText(navItems[m]).width;
                navWidths.push(nw);
                totalNavW += nw;
                if (m < navItems.length - 1) totalNavW += navGap;
            }

            // Center within available space
            var availCenter = rightClusterStart - leftClusterEnd;
            var centerStart = leftClusterEnd + (availCenter - totalNavW) / 2;
            if (centerStart < leftClusterEnd + 20) centerStart = leftClusterEnd + 20;

            var navX = centerStart;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            for (var n = 0; n < navItems.length; n++) {
                var active = n === activeNavIdx;
                ctx.font = (active ? '600 ' : '500 ') + navFontSize + 'px ' + fonts.primary;
                ctx.fillStyle = active ? theme.text : theme.textDim;
                ctx.fillText(navItems[n], navX, midY);

                if (active) {
                    // 2px orange underline, 2px below text
                    var underY = midY + navFontSize / 2 + 2;
                    ctx.fillStyle = theme.orange;
                    ctx.fillRect(navX, underY, navWidths[n], 2);
                }

                navX += navWidths[n] + navGap;
            }

            // ── Reset ──
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
