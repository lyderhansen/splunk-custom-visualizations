/*
 * Wordmark — Splunk Custom Visualization
 *
 * Reusable inline brand lockup — orange chevron > + bold "splunk" text
 * + optional separator | and sub-mark text.
 *
 * Config-driven: theme (dark/light), subMark text, alignment.
 * SPL: | makeresults | eval brand="splunk"
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var tokens = require('shared/tokens');


    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('super-co-wordmark-viz');

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
                    'Awaiting data — Wordmark'
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

            var el = this.el;
            var rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            var ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            var w = rect.width;
            var h = rect.height;

            // Read config
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = (config[ns + 'theme'] || 'dark');
            var subMark = (config[ns + 'subMark'] || '');
            var align = (config[ns + 'align'] || 'left');

            // Resolve theme tokens
            var theme = tokens.getTheme(themeName);
            var fonts = tokens.fonts;

            // Clear canvas
            ctx.clearRect(0, 0, w, h);

            // Font sizes
            var chevronSize = 17;
            var brandSize = 17;
            var sepSize = 14;
            var subSize = 13;

            // Measure all parts to compute total width
            // Chevron
            ctx.font = '700 ' + chevronSize + 'px ' + fonts.primary;
            var chevronChar = '›'; // single right-pointing angle quotation mark
            var chevronW = ctx.measureText(chevronChar).width;

            // Gap between chevron and brand text
            var chevronGap = 3;

            // Brand text "splunk"
            ctx.font = '700 ' + brandSize + 'px ' + fonts.primary;
            var brandText = 'splunk';
            var brandW = ctx.measureText(brandText).width;

            // Separator and sub-mark
            var sepW = 0;
            var sepGap = 0;
            var subW = 0;
            var subGap = 0;
            if (subMark) {
                ctx.font = '400 ' + sepSize + 'px ' + fonts.primary;
                sepW = ctx.measureText('|').width;
                sepGap = 8;

                ctx.font = '500 ' + subSize + 'px ' + fonts.primary;
                subW = ctx.measureText(subMark).width;
                subGap = 6;
            }

            // Total width of the lockup
            var totalW = chevronW + chevronGap + brandW;
            if (subMark) {
                totalW += sepGap + sepW + subGap + subW;
            }

            // Compute starting X based on alignment
            var startX;
            var padX = 8;
            if (align === 'center') {
                startX = (w - totalW) / 2;
            } else {
                // left
                startX = padX;
            }

            // Vertical center
            var cy = h / 2;

            // Draw chevron
            var curX = startX;
            ctx.font = '700 ' + chevronSize + 'px ' + fonts.primary;
            ctx.fillStyle = theme.orange;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(chevronChar, curX, cy);
            curX += chevronW + chevronGap;

            // Draw brand text "splunk"
            // Apply letter-spacing -0.02em by drawing character by character
            ctx.font = '700 ' + brandSize + 'px ' + fonts.primary;
            ctx.fillStyle = theme.text;
            var letterSpacing = -0.02 * brandSize;
            for (var i = 0; i < brandText.length; i++) {
                var ch = brandText[i];
                ctx.fillText(ch, curX, cy);
                curX += ctx.measureText(ch).width + letterSpacing;
            }
            // Adjust curX to where the brand text actually ends
            // (remove the trailing letter-spacing offset from the last character)
            curX -= letterSpacing;

            // Draw separator and sub-mark if present
            if (subMark) {
                curX += sepGap;

                // Separator pipe
                ctx.font = '400 ' + sepSize + 'px ' + fonts.primary;
                ctx.fillStyle = theme.textFaint;
                ctx.fillText('|', curX, cy);
                curX += sepW + subGap;

                // Sub-mark text
                ctx.font = '500 ' + subSize + 'px ' + fonts.primary;
                ctx.fillStyle = theme.textDim;
                ctx.fillText(subMark, curX, cy);
            }

            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
