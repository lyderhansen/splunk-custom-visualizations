/*
 * ACME Splunk Wordmark — reusable inline brand lockup.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function (SplunkVisualizationBase) {

    var T = require('../../../../../shared/theme.js');

    return SplunkVisualizationBase.extend({

        initialize: function () {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('acme-wordmark-viz');
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.el.appendChild(this.canvas);
        },

        getInitialDataParams: function () {
            return { outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE, count: 1 };
        },

        formatData: function (data) { return data || {}; },

        updateView: function (data, config) {
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var themeName = config[ns + 'theme'] || 'dark';
            var subMark = config[ns + 'subMark'] || '';
            var size = parseInt(config[ns + 'size'] || '17', 10);
            // Expanded
            var chevronColor = config[ns + 'chevronColor'] || '';
            var textColor = config[ns + 'textColor'] || '';
            var subMarkColor = config[ns + 'subMarkColor'] || '';
            var separatorColor = config[ns + 'separatorColor'] || '';
            var separator = config[ns + 'separator'] || '|';
            var alignH = config[ns + 'alignH'] || 'center';
            var bgColor = config[ns + 'bgColor'] || 'transparent';
            var subMarkSize = parseInt(config[ns + 'subMarkSize'] || '13', 10);

            var t = T.getTheme(themeName);
            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, rect.width, rect.height);
            if (bgColor && bgColor !== 'transparent') { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, rect.width, rect.height); }

            var cy = rect.height / 2;
            ctx.textBaseline = 'middle';

            var wordFont = '700 ' + size + 'px ' + T.FONTS.ui;
            var subFont = '500 ' + subMarkSize + 'px ' + T.FONTS.ui;
            ctx.font = wordFont;
            var wordW = ctx.measureText('splunk').width;
            ctx.font = subFont;
            var subW = subMark ? ctx.measureText(subMark).width : 0;

            var pipeGap = 14, gap = 10, pipeW = subMark ? 6 : 0;
            var totalW = size + gap + wordW + (subMark ? (pipeGap * 2 + pipeW + subW) : 0);
            var x = alignH === 'left' ? 12 : alignH === 'right' ? rect.width - totalW - 12 : (rect.width - totalW) / 2;

            ctx.fillStyle = chevronColor || t.orange;
            ctx.font = '700 ' + size + 'px ' + T.FONTS.ui;
            ctx.fillText('›', x, cy);
            x += size + gap - 2;

            ctx.fillStyle = textColor || t.text;
            ctx.font = wordFont;
            ctx.fillText('splunk', x, cy);
            x += wordW;

            if (subMark) {
                x += pipeGap;
                ctx.fillStyle = separatorColor || t.textFaint;
                ctx.font = subFont;
                ctx.fillText(separator, x, cy);
                x += pipeW + pipeGap - 4;
                ctx.fillStyle = subMarkColor || t.textDim;
                ctx.fillText(subMark, x, cy);
            }
        },

        reflow: function () { this.invalidateUpdateView(); }
    });
});
