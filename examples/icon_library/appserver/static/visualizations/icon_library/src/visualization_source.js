/*
 * Icon Library — Splunk Custom Visualization
 *
 * Renders Material Symbols icons on a Canvas with configurable color,
 * size, background shape, shadow, glow, label, and data-driven styling.
 *
 * Expected SPL columns (all optional):
 *   icon   — Material Symbols icon name (e.g. "home", "security")
 *   color  — hex colour override for the icon
 *   label  — text label below the icon
 *   value  — numeric value for threshold-based colouring
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    // ── Config helper ───────────────────────────────────────────

    function getOption(config, ns, key, defaultValue) {
        var v = config[ns + key];
        if (v !== undefined && v !== null) return v;
        v = config[key];
        if (v !== undefined && v !== null) return v;
        return defaultValue;
    }

    // ── Colour utilities ────────────────────────────────────────

    function hexToRgba(hex, alpha) {
        if (!hex || hex === 'transparent') return 'rgba(0,0,0,0)';
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var r = parseInt(hex.substring(0, 2), 16);
        var g = parseInt(hex.substring(2, 4), 16);
        var b = parseInt(hex.substring(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    // ── Material Symbols icon name → ligature text mapping ──────
    // The font uses ligatures: ctx.fillText('home', x, y) renders the home icon.
    // We just pass the icon name string directly.

    // ── Font loading promise cache ──────────────────────────────

    var _fontLoaded = false;

    function ensureFontLoaded() {
        if (_fontLoaded) return;
        if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
            document.fonts.load('400 48px "Material Symbols Outlined"').then(function() {
                _fontLoaded = true;
            });
        }
    }

    // ── Background shape helpers ────────────────────────────────

    function drawCircleBg(ctx, cx, cy, radius) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.closePath();
    }

    function drawRoundedRectBg(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    function drawSquareBg(ctx, x, y, size) {
        ctx.beginPath();
        ctx.rect(x, y, size, size);
        ctx.closePath();
    }

    // ── Main visualization ──────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('icon-library-viz');
            this._lastConfig = null;
            this._setupNoDataObserver();
        },

        _setupNoDataObserver: function() {
            var self = this;
            if (typeof MutationObserver !== 'undefined') {
                var observer = new MutationObserver(function(mutations) {
                    for (var i = 0; i < mutations.length; i++) {
                        for (var j = 0; j < mutations[i].addedNodes.length; j++) {
                            var node = mutations[i].addedNodes[j];
                            if (node.nodeType === 1) {
                                var msg = node.querySelector
                                    ? node.querySelector('.viz-empty-placeholder, .splunk-no-results-message, [data-test="no-results"]')
                                    : null;
                                if (msg) msg.style.display = 'none';
                                if (node.classList &&
                                    (node.classList.contains('viz-empty-placeholder') ||
                                     node.classList.contains('splunk-no-results-message'))) {
                                    node.style.display = 'none';
                                }
                            }
                        }
                    }
                });
                observer.observe(this.el, { childList: true, subtree: true });
            }
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data) {
            return data;
        },

        updateView: function(data, config) {
            this._lastConfig = config;
            ensureFontLoaded();
            this._render(data, config);
        },

        reflow: function() {
            if (this._lastConfig) {
                this._render(null, this._lastConfig);
            }
        },

        _renderDefault: function(config) {
            this._render(null, config || this._lastConfig || {});
        },

        _render: function(data, config) {
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var el = this.el;
            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;

            // Get or create canvas
            var canvas = el.querySelector('canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.display = 'block';
                el.appendChild(canvas);
            }
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            var ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            // ── Read config ──────────────────────────────────────
            var iconName    = getOption(config, ns, 'iconName', 'home');
            var customIcon  = getOption(config, ns, 'customIcon', '');
            var iconColor   = getOption(config, ns, 'iconColor', '#06B6D4');
            var iconSize    = parseInt(getOption(config, ns, 'iconSize', '0'), 10);
            var bgShape     = getOption(config, ns, 'bgShape', 'none');
            var bgColor     = getOption(config, ns, 'bgColor', '#1E293B');
            var bgOpacity   = parseFloat(getOption(config, ns, 'bgOpacity', '1'));
            var bgPadding   = parseInt(getOption(config, ns, 'bgPadding', '16'), 10);
            var bgRadius    = parseInt(getOption(config, ns, 'bgRadius', '12'), 10);
            var showLabel   = getOption(config, ns, 'showLabel', 'no');
            var labelText   = getOption(config, ns, 'labelText', '');
            var labelColor  = getOption(config, ns, 'labelColor', '#94A3B8');
            var labelSize   = parseInt(getOption(config, ns, 'labelSize', '0'), 10);
            var shadowOn    = getOption(config, ns, 'shadow', 'no');
            var shadowColor = getOption(config, ns, 'shadowColor', '#000000');
            var shadowBlur  = parseInt(getOption(config, ns, 'shadowBlur', '8'), 10);
            var shadowX     = parseInt(getOption(config, ns, 'shadowOffsetX', '0'), 10);
            var shadowY     = parseInt(getOption(config, ns, 'shadowOffsetY', '4'), 10);
            var glowOn      = getOption(config, ns, 'glow', 'no');
            var glowColor   = getOption(config, ns, 'glowColor', '#06B6D4');
            var glowSize    = parseInt(getOption(config, ns, 'glowSize', '12'), 10);
            var rotation    = parseInt(getOption(config, ns, 'rotation', '0'), 10);

            // Use custom icon name if provided, otherwise use dropdown selection
            var resolvedIcon = (customIcon && customIcon.trim() !== '') ? customIcon.trim() : iconName;

            // ── Data-driven overrides ────────────────────────────
            if (data && data.rows && data.rows.length > 0 && data.fields) {
                var row = data.rows[0];
                var fields = data.fields;
                for (var fi = 0; fi < fields.length; fi++) {
                    var fname = fields[fi].name;
                    var fval = row[fi];
                    if (fval === null || fval === undefined) continue;
                    if (fname === 'icon') resolvedIcon = String(fval);
                    if (fname === 'color') iconColor = String(fval);
                    if (fname === 'label') { labelText = String(fval); showLabel = 'yes'; }
                    if (fname === 'value') {
                        var numVal = parseFloat(fval);
                        if (!isNaN(numVal)) {
                            if (numVal >= 90) iconColor = '#22C55E';
                            else if (numVal >= 50) iconColor = '#F59E0B';
                            else iconColor = '#EF4444';
                        }
                    }
                }
            }

            // ── Calculate sizes ──────────────────────────────────
            var hasLabel = (showLabel === 'yes' && labelText && labelText.trim() !== '');
            var availH = hasLabel ? h * 0.75 : h;
            var availW = w;

            // Auto-size icon if iconSize is 0
            var computedIconSize;
            if (iconSize > 0) {
                computedIconSize = iconSize;
            } else {
                computedIconSize = Math.max(16, Math.min(availW, availH) * 0.55);
            }

            // Auto-size label
            var computedLabelSize;
            if (labelSize > 0) {
                computedLabelSize = labelSize;
            } else {
                computedLabelSize = Math.max(8, Math.min(20, Math.min(w, h) * 0.09));
            }

            // Center positions
            var cx = w / 2;
            var cy = hasLabel ? availH * 0.5 : h / 2;

            // ── Clear ────────────────────────────────────────────
            ctx.clearRect(0, 0, w, h);

            // ── Draw background shape ────────────────────────────
            if (bgShape !== 'none') {
                ctx.save();
                if (rotation !== 0) {
                    ctx.translate(cx, cy);
                    ctx.rotate(rotation * Math.PI / 180);
                    ctx.translate(-cx, -cy);
                }

                var bgSizeDim = computedIconSize + bgPadding * 2;
                ctx.globalAlpha = bgOpacity;

                if (shadowOn === 'yes') {
                    ctx.shadowColor = hexToRgba(shadowColor, 0.5);
                    ctx.shadowBlur = shadowBlur;
                    ctx.shadowOffsetX = shadowX;
                    ctx.shadowOffsetY = shadowY;
                }

                ctx.fillStyle = bgColor;

                if (bgShape === 'circle') {
                    drawCircleBg(ctx, cx, cy, bgSizeDim / 2);
                    ctx.fill();
                } else if (bgShape === 'rounded_rect') {
                    drawRoundedRectBg(ctx, cx - bgSizeDim / 2, cy - bgSizeDim / 2, bgSizeDim, bgSizeDim, bgRadius);
                    ctx.fill();
                } else if (bgShape === 'square') {
                    drawSquareBg(ctx, cx - bgSizeDim / 2, cy - bgSizeDim / 2, bgSizeDim);
                    ctx.fill();
                }

                ctx.restore();
            }

            // ── Draw icon ────────────────────────────────────────
            ctx.save();

            if (rotation !== 0 && bgShape === 'none') {
                ctx.translate(cx, cy);
                ctx.rotate(rotation * Math.PI / 180);
                ctx.translate(-cx, -cy);
            }

            if (glowOn === 'yes') {
                ctx.shadowColor = glowColor;
                ctx.shadowBlur = glowSize;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            } else if (shadowOn === 'yes' && bgShape === 'none') {
                ctx.shadowColor = hexToRgba(shadowColor, 0.5);
                ctx.shadowBlur = shadowBlur;
                ctx.shadowOffsetX = shadowX;
                ctx.shadowOffsetY = shadowY;
            }

            ctx.fillStyle = iconColor;
            ctx.font = '400 ' + Math.round(computedIconSize) + 'px "Material Symbols Outlined"';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Material Symbols uses ligatures: the icon name IS the text
            ctx.fillText(resolvedIcon, cx, cy);

            ctx.restore();

            // ── Draw label ───────────────────────────────────────
            if (hasLabel) {
                ctx.save();
                ctx.fillStyle = labelColor;
                ctx.font = '400 ' + Math.round(computedLabelSize) + 'px "Inter", "Helvetica Neue", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';

                var labelY = cy + computedIconSize / 2 + 8;
                ctx.fillText(labelText, cx, labelY);
                ctx.restore();
            }
        }
    });
});
