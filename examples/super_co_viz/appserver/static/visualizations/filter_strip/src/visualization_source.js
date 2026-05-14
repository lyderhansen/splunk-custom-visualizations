/*
 * Filter Strip — Splunk Custom Visualization
 *
 * Row of dropdown filter chips that scope a search.
 * Purely config-driven: filters are semicolon-separated "label:value" pairs.
 *
 * Anatomy:
 *   - 12 px top padding, 1 px edge top-border
 *   - Chips: 7/12 padding, 1 px edge border, 4 px radius, panel bg
 *     Label (textFaint) + value (text) + caret glyph
 *   - Right-aligned CTA button: orange bg, white text
 *
 * SPL: | makeresults | eval filter="Last 24 hours"
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils',
    'shared/tokens',
    'shared/draw'
], function(SplunkVisualizationBase, SplunkVisualizationUtils, tokens, draw) {

    // Parse "label:value" pairs from semicolon-separated string
    function parseFilters(str) {
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

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-filter-strip-viz');

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
                    'Awaiting data — Filter Strip'
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
            var themeName  = config[ns + 'theme']    || 'dark';
            var filtersStr = config[ns + 'filters']  || 'Time range:Last 24 hours;Environment:Production;Severity:All';
            var ctaLabel   = config[ns + 'ctaLabel'] || 'Run search';

            var theme = tokens.getTheme(themeName);
            var fonts = tokens.fonts;

            var filters = parseFilters(filtersStr);

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

            // ── Top border ──
            ctx.fillStyle = theme.edge;
            ctx.fillRect(0, 0, w, 1);

            // ── Layout constants ──
            var topPad = 12;
            var chipGap = 10;
            var chipPadX = 12;
            var chipPadY = 7;
            var chipRadius = 4;
            var fontSize = 12;
            var ctaFontSize = 13;
            var ctaPadX = 14;
            var ctaPadY = 7;
            var caretText = '▾'; // ▾

            // Vertical center within available height below top pad
            var availH = h - topPad - 1;
            var chipH = chipPadY * 2 + fontSize + 2;
            var chipY = topPad + Math.max(0, (availH - chipH) / 2);

            // ── Measure CTA button ──
            ctx.font = '600 ' + ctaFontSize + 'px ' + fonts.primary;
            var ctaTextW = ctx.measureText(ctaLabel).width;
            var ctaW = ctaTextW + ctaPadX * 2;
            var ctaH = ctaPadY * 2 + ctaFontSize + 2;
            var ctaX = w - 16 - ctaW;
            var ctaY = chipY + (chipH - ctaH) / 2;

            var maxChipsRight = ctaX - chipGap;

            // ── Draw filter chips ──
            var chipX = 16;
            ctx.textBaseline = 'middle';

            for (var i = 0; i < filters.length; i++) {
                var f = filters[i];

                // Measure chip width
                ctx.font = '500 ' + fontSize + 'px ' + fonts.primary;
                var labelW = f.label ? ctx.measureText(f.label + ' ').width : 0;
                var valueW = ctx.measureText(f.value).width;

                ctx.font = '400 10px ' + fonts.primary;
                var caretW = ctx.measureText(caretText).width;

                var contentW = labelW + valueW + 6 + caretW;
                var totalChipW = chipPadX * 2 + contentW;

                // Stop if chip would overflow into CTA area
                if (chipX + totalChipW > maxChipsRight) break;

                // Chip background
                draw.roundRect(ctx, chipX, chipY, totalChipW, chipH, chipRadius);
                ctx.fillStyle = theme.panel;
                ctx.fill();
                ctx.strokeStyle = theme.edge;
                ctx.lineWidth = 1;
                ctx.stroke();

                // Label part
                var textY = chipY + chipH / 2;
                var innerX = chipX + chipPadX;

                if (f.label) {
                    ctx.font = '500 ' + fontSize + 'px ' + fonts.primary;
                    ctx.fillStyle = theme.textFaint;
                    ctx.textAlign = 'left';
                    ctx.fillText(f.label + ' ', innerX, textY);
                    innerX += labelW;
                }

                // Value part
                ctx.font = '500 ' + fontSize + 'px ' + fonts.primary;
                ctx.fillStyle = theme.text;
                ctx.textAlign = 'left';
                ctx.fillText(f.value, innerX, textY);
                innerX += valueW + 6;

                // Caret glyph
                ctx.font = '400 10px ' + fonts.primary;
                ctx.fillStyle = theme.textFaint;
                ctx.fillText(caretText, innerX, textY);

                chipX += totalChipW + chipGap;
            }

            // ── Draw CTA button ──
            draw.roundRect(ctx, ctaX, ctaY, ctaW, ctaH, chipRadius);
            ctx.fillStyle = theme.orange;
            ctx.fill();

            ctx.font = '600 ' + ctaFontSize + 'px ' + fonts.primary;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ctaLabel, ctaX + ctaW / 2, ctaY + ctaH / 2);

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
