/*
 * Dashboard Frame — Splunk Custom Visualization
 *
 * Full canvas wrapper for big-screen dashboards (1920x1080 target).
 * Renders the chrome elements — app bar, breadcrumb, title, subtitle,
 * status pills, filter strip, footer. Body area is left empty for
 * other viz panels to fill in the actual dashboard.
 *
 * Config-driven: theme, appName, breadcrumb, title, subtitle,
 *                statusPills, showFilters, filters, footerLeft, footerRight.
 * SPL: | makeresults | eval title="Security Operations"
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {

    var BAR_HEIGHT = 48;
    var FOOTER_HEIGHT = 40;

    // Parse "label:value" pairs from semicolon-separated string
    function parsePairs(str) {
        if (!str) return [];
        var parts = str.split(';');
        var result = [];
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].replace(/^\s+|\s+$/g, '');
            if (!p) continue;
            var colonIdx = p.indexOf(':');
            if (colonIdx >= 0) {
                result.push({
                    label: p.substring(0, colonIdx),
                    value: p.substring(colonIdx + 1)
                });
            } else {
                result.push({ label: '', value: p });
            }
        }
        return result;
    }

    // ── Draw app bar section ─────────────────────────────────────
    function drawAppBar(ctx, w, theme, fonts, appName) {
        var barH = BAR_HEIGHT;
        var midY = barH / 2;

        // Background
        ctx.fillStyle = theme.panel;
        ctx.fillRect(0, 0, w, barH);

        // Bottom border
        ctx.fillStyle = theme.edge;
        ctx.fillRect(0, barH - 1, w, 1);

        // Left cluster
        var curX = 16;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        // Orange chevron
        ctx.font = '700 17px ' + fonts.primary;
        ctx.fillStyle = theme.orange;
        ctx.fillText('›', curX, midY);
        curX += ctx.measureText('›').width + 2;

        // "splunk"
        ctx.font = '700 17px ' + fonts.primary;
        ctx.letterSpacing = '-0.02em';
        ctx.fillStyle = theme.text;
        ctx.fillText('splunk', curX, midY);
        curX += ctx.measureText('splunk').width + 14;
        ctx.letterSpacing = '0em';

        // Separator
        ctx.font = '400 14px ' + fonts.primary;
        ctx.fillStyle = theme.textFaint;
        ctx.fillText('|', curX, midY);
        curX += ctx.measureText('|').width + 14;

        // App name
        ctx.font = '500 13px ' + fonts.primary;
        ctx.fillStyle = theme.textDim;
        var maxAppW = w * 0.25;
        var truncApp = draw.ellipsis(ctx, appName, maxAppW);
        ctx.fillText(truncApp, curX, midY);

        // Nav items (hardcoded for frame context)
        var navItems = ['Dashboards', 'Alerts', 'Search'];
        var navGap = 18;
        var navFontSize = 13;

        // Measure nav width
        var totalNavW = 0;
        var navWidths = [];
        for (var m = 0; m < navItems.length; m++) {
            var isAct = m === 0;
            ctx.font = (isAct ? '600 ' : '500 ') + navFontSize + 'px ' + fonts.primary;
            var nw = ctx.measureText(navItems[m]).width;
            navWidths.push(nw);
            totalNavW += nw;
            if (m < navItems.length - 1) totalNavW += navGap;
        }

        var navStartX = (w - totalNavW) / 2;
        var navX = navStartX;

        for (var n = 0; n < navItems.length; n++) {
            var active = n === 0;
            ctx.font = (active ? '600 ' : '500 ') + navFontSize + 'px ' + fonts.primary;
            ctx.fillStyle = active ? theme.text : theme.textDim;
            ctx.textAlign = 'left';
            ctx.fillText(navItems[n], navX, midY);

            if (active) {
                var underY = midY + navFontSize / 2 + 2;
                ctx.fillStyle = theme.orange;
                ctx.fillRect(navX, underY, navWidths[n], 2);
            }

            navX += navWidths[n] + navGap;
        }
    }

    // ── Draw title section ───────────────────────────────────────
    function drawTitleSection(ctx, w, startY, theme, fonts, breadcrumb, title, subtitle, statusPills) {
        var padX = 24;
        var curY = startY + 16;

        // Breadcrumb
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = '400 12px ' + fonts.primary;
        ctx.fillStyle = theme.textDim;
        var maxBreadW = w * 0.6;
        var truncBread = draw.ellipsis(ctx, breadcrumb, maxBreadW);
        ctx.fillText(truncBread, padX, curY);
        curY += 20;

        // Title
        ctx.font = '700 26px ' + fonts.primary;
        ctx.letterSpacing = '-0.02em';
        ctx.fillStyle = theme.text;
        var maxTitleW = w * 0.55;
        var truncTitle = draw.ellipsis(ctx, title, maxTitleW);
        ctx.fillText(truncTitle, padX, curY);
        var titleBottom = curY + 30;
        ctx.letterSpacing = '0em';

        // Subtitle
        ctx.font = '400 13px ' + fonts.primary;
        ctx.fillStyle = theme.textDim;
        ctx.fillText(subtitle, padX, titleBottom);
        curY = titleBottom + 20;

        // ── Status pills (right-aligned, same vertical as title) ──
        if (statusPills.length > 0) {
            var pillGap = 8;
            var pillPadX = 10;
            var pillPadY = 4;
            var pillFontSize = 12;
            var pillRadius = 4;
            var pillY = startY + 36;

            // Measure total pills width (right to left)
            var pillWidths = [];
            var totalPillW = 0;
            ctx.font = '600 ' + pillFontSize + 'px ' + fonts.primary;
            for (var p = 0; p < statusPills.length; p++) {
                var pillText = statusPills[p].label + '  ' + statusPills[p].value;
                var pw = ctx.measureText(pillText).width + pillPadX * 2;
                pillWidths.push(pw);
                totalPillW += pw;
                if (p < statusPills.length - 1) totalPillW += pillGap;
            }

            var pillStartX = w - padX - totalPillW;
            var pX = pillStartX;
            var pillH = pillPadY * 2 + pillFontSize + 2;

            // Color cycle for pills
            var pillColors = [theme.s4, theme.danger, theme.orange, theme.s2, theme.s5];

            for (var q = 0; q < statusPills.length; q++) {
                var pc = pillColors[q % pillColors.length];

                // Pill background (subtle)
                draw.roundRect(ctx, pX, pillY, pillWidths[q], pillH, pillRadius);
                ctx.fillStyle = theme.panelHi;
                ctx.fill();
                ctx.strokeStyle = theme.edge;
                ctx.lineWidth = 1;
                ctx.stroke();

                // Label + value
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                var pmidY = pillY + pillH / 2;

                ctx.font = '500 ' + pillFontSize + 'px ' + fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.fillText(statusPills[q].label, pX + pillPadX, pmidY);
                var labelW = ctx.measureText(statusPills[q].label).width;

                ctx.font = '600 ' + pillFontSize + 'px ' + fonts.mono;
                ctx.fillStyle = pc;
                ctx.fillText(statusPills[q].value, pX + pillPadX + labelW + 6, pmidY);

                pX += pillWidths[q] + pillGap;
            }
        }

        return curY;
    }

    // ── Draw filter strip ────────────────────────────────────────
    function drawFilterStrip(ctx, w, startY, theme, fonts, filters) {
        var padX = 24;
        var chipGap = 10;
        var chipPadX = 12;
        var chipPadY = 7;
        var chipRadius = 4;
        var fontSize = 12;
        var caretText = '▾';

        // Top border
        ctx.fillStyle = theme.edge;
        ctx.fillRect(padX, startY, w - padX * 2, 1);

        var chipH = chipPadY * 2 + fontSize + 2;
        var chipY = startY + 10;
        var chipX = padX;

        ctx.textBaseline = 'middle';

        for (var i = 0; i < filters.length; i++) {
            var f = filters[i];

            ctx.font = '500 ' + fontSize + 'px ' + fonts.primary;
            var labelW = f.label ? ctx.measureText(f.label + ' ').width : 0;
            var valueW = ctx.measureText(f.value).width;

            ctx.font = '400 10px ' + fonts.primary;
            var caretW = ctx.measureText(caretText).width;

            var contentW = labelW + valueW + 6 + caretW;
            var totalChipW = chipPadX * 2 + contentW;

            if (chipX + totalChipW > w - padX) break;

            // Chip bg
            draw.roundRect(ctx, chipX, chipY, totalChipW, chipH, chipRadius);
            ctx.fillStyle = theme.panel;
            ctx.fill();
            ctx.strokeStyle = theme.edge;
            ctx.lineWidth = 1;
            ctx.stroke();

            var textY = chipY + chipH / 2;
            var innerX = chipX + chipPadX;

            // Label
            if (f.label) {
                ctx.font = '500 ' + fontSize + 'px ' + fonts.primary;
                ctx.fillStyle = theme.textFaint;
                ctx.textAlign = 'left';
                ctx.fillText(f.label + ' ', innerX, textY);
                innerX += labelW;
            }

            // Value
            ctx.font = '500 ' + fontSize + 'px ' + fonts.primary;
            ctx.fillStyle = theme.text;
            ctx.textAlign = 'left';
            ctx.fillText(f.value, innerX, textY);
            innerX += valueW + 6;

            // Caret
            ctx.font = '400 10px ' + fonts.primary;
            ctx.fillStyle = theme.textFaint;
            ctx.fillText(caretText, innerX, textY);

            chipX += totalChipW + chipGap;
        }

        return chipY + chipH + 8;
    }

    // ── Draw footer ──────────────────────────────────────────────
    function drawFooter(ctx, w, footerY, footerH, theme, fonts, footerLeft, footerRight) {
        // Background
        ctx.fillStyle = theme.panel;
        ctx.fillRect(0, footerY, w, footerH);

        // Top border
        ctx.fillStyle = theme.edge;
        ctx.fillRect(0, footerY, w, 1);

        var midY = footerY + footerH / 2;
        var padX = 24;
        var fontSize = 11.5;

        // Left text
        ctx.font = '400 ' + fontSize + 'px ' + fonts.mono;
        ctx.fillStyle = theme.textFaint;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        var maxLeftW = w * 0.65;
        var truncLeft = draw.ellipsis(ctx, footerLeft, maxLeftW);
        ctx.fillText(truncLeft, padX, midY);

        // Right text
        ctx.font = '400 ' + fontSize + 'px ' + fonts.primary;
        ctx.fillStyle = theme.textFaint;
        ctx.textAlign = 'right';
        ctx.fillText(footerRight, w - padX, midY);
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-dashboard-frame-viz');

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
                    'Awaiting data — Dashboard Frame'
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
            var themeName    = config[ns + 'theme']       || 'dark';
            var appName      = config[ns + 'appName']     || 'Enterprise Security';
            var breadcrumb   = config[ns + 'breadcrumb']  || 'Home > Dashboards';
            var title        = config[ns + 'title']       || 'Security Operations';
            var subtitle     = config[ns + 'subtitle']    || 'Real-time monitoring and response';
            var pillsStr     = config[ns + 'statusPills'] || 'Notables:1247;Critical:23;Open:847';
            var showFilters  = (config[ns + 'showFilters'] || 'true') === 'true';
            var filtersStr   = config[ns + 'filters']     || 'Time range:Last 24 hours;Environment:Production';
            var footerLeft   = config[ns + 'footerLeft']  || 'index=notable | stats count by source';
            var footerRight  = config[ns + 'footerRight'] || 'SUPER CO v1.0';

            var theme = tokens.getTheme(themeName);
            var fonts = tokens.fonts;

            var statusPills = parsePairs(pillsStr);
            var filters = showFilters ? parsePairs(filtersStr) : [];

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
            ctx.clearRect(0, 0, w, h);

            // ── Full background ──
            ctx.fillStyle = theme.bg;
            ctx.fillRect(0, 0, w, h);

            // ── App bar (48px) ──
            drawAppBar(ctx, w, theme, fonts, appName);

            // ── Title section ──
            var titleSectionY = BAR_HEIGHT;
            var titleBottom = drawTitleSection(ctx, w, titleSectionY, theme, fonts,
                breadcrumb, title, subtitle, statusPills);

            // ── Filter strip (if enabled) ──
            var bodyTop = titleBottom;
            if (showFilters && filters.length > 0) {
                bodyTop = drawFilterStrip(ctx, w, titleBottom, theme, fonts, filters);
            }

            // ── Body area — just bg, other panels overlay ──
            var footerY = h - FOOTER_HEIGHT;
            // Body is between bodyTop and footerY — already filled with theme.bg

            // ── Footer ──
            drawFooter(ctx, w, footerY, FOOTER_HEIGHT, theme, fonts, footerLeft, footerRight);

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
