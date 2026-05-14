define([
    'api/SplunkVisualizationBase'
], function(SplunkVisualizationBase) {

    var theme = require('shared/theme');

    function getOption(config, ns, key, defaultValue) {
        var v = config[ns + key];
        if (v !== undefined && v !== null) return v;
        v = config[key];
        if (v !== undefined && v !== null) return v;
        return defaultValue;
    }

    function getNS(viz) {
        try {
            var info = viz.getPropertyNamespaceInfo();
            if (info && info.propertyNamespace) return info.propertyNamespace;
        } catch (e) {}
        return '';
    }

    function parseBool(val, fb) {
        if (val === undefined || val === null) return fb;
        return val === 'true' || val === true;
    }

    function formatTimestamp(raw) {
        if (!raw) return '--:--:--';
        var str = String(raw);
        // Epoch seconds
        var asNum = parseFloat(str);
        if (!isNaN(asNum) && asNum > 1000000000) {
            var d = new Date(asNum * 1000);
            return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
        }
        // ISO or datetime string — extract time portion
        var timeMatch = str.match(/(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) return timeMatch[0];
        // Fallback
        return str.length > 8 ? str.substring(0, 8) : str;
    }

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    var CATEGORY_COLORS = {
        'pit': '#FFB800',
        'flag': '#FA2223',
        'incident': '#FA2223',
        'strategy': '#00D26A',
        'radio': '#707070'
    };

    function categoryColor(t, cat) {
        var key = (cat || '').toLowerCase();
        return CATEGORY_COLORS[key] || t.textFaint;
    }

    return SplunkVisualizationBase.extend({
        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.style.overflow = 'hidden';
            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            this.el.appendChild(canvas);
            this.canvas = canvas;
            this._lastData = null;
            this._lastConfig = null;

            this._tooltip = document.createElement('div');
            this._tooltip.style.cssText = 'position:absolute;display:none;padding:6px 10px;background:rgba(10,10,10,0.95);color:#E8E8E8;font-size:12px;border-radius:0;pointer-events:none;white-space:nowrap;z-index:100;font-family:JetBrains Mono,monospace;border:1px solid #2A2A2A;';
            this.el.style.position = 'relative';
            this.el.appendChild(this._tooltip);
            this._hitRegions = [];
            this._hoverIdx = -1;

            var self = this;
            this.canvas.addEventListener('mousemove', function(e) { self._onMouseMove(e); });
            this.canvas.addEventListener('mouseleave', function() {
                self._tooltip.style.display = 'none';
                self.canvas.style.cursor = 'default';
                if (self._hoverIdx !== -1) {
                    self._hoverIdx = -1;
                    self._render(self._lastData, self._lastConfig);
                }
            });
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError('Awaiting data');
            }
            var colIdx = {};
            for (var i = 0; i < data.fields.length; i++) {
                colIdx[data.fields[i].name] = i;
            }
            var result = { colIdx: colIdx, rows: data.rows };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!data) return;
            this._lastData = data;
            this._lastConfig = config;
            this._render(data, config);
        },

        _render: function(data, config) {
            var el = this.el;
            var w = el.offsetWidth;
            var h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            var ns = getNS(this);
            var t = theme.getTheme(getOption(config, ns, 'theme', 'dark'));

            var tsField = getOption(config, ns, 'timestampField', '_time');
            var msgField = getOption(config, ns, 'messageField', 'message');
            var sevField = getOption(config, ns, 'severityField', 'severity');
            var catField = getOption(config, ns, 'categoryField', 'category');
            var maxEvents = parseInt(getOption(config, ns, 'maxEvents', '50'), 10);
            var showTimestamp = parseBool(getOption(config, ns, 'showTimestamp', 'true'), true);
            var showCategory = parseBool(getOption(config, ns, 'showCategory', 'true'), true);

            var colIdx = data.colIdx;
            var rows = data.rows;

            // Parse events
            var events = [];
            var limit = Math.min(rows.length, maxEvents);
            for (var i = 0; i < limit; i++) {
                var row = rows[i];
                events.push({
                    ts: colIdx[tsField] !== undefined ? String(row[colIdx[tsField]]) : '',
                    msg: colIdx[msgField] !== undefined ? String(row[colIdx[msgField]]) : '',
                    sev: colIdx[sevField] !== undefined ? String(row[colIdx[sevField]]) : 'info',
                    cat: colIdx[catField] !== undefined ? String(row[colIdx[catField]]) : ''
                });
            }

            var pad = Math.max(10, w * 0.03);
            var headerH = 24;
            var rowH = 32;
            var maxVisible = Math.floor((h - headerH) / rowH);
            var visibleCount = Math.min(events.length, maxVisible);

            // Header
            ctx.font = '11px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText('TELEMETRY', pad, headerH - 6);

            // Header underline
            ctx.strokeStyle = t.edge;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pad, headerH - 0.5);
            ctx.lineTo(w - pad, headerH - 0.5);
            ctx.stroke();

            this._hitRegions = [];

            var tsFontSize = 12;
            var msgFontSize = 13;
            var dotSize = 6;

            for (var j = 0; j < visibleCount; j++) {
                var ev = events[j];
                var ry = headerH + j * rowH;
                var textY = ry + rowH / 2;
                var sev = (ev.sev || '').toLowerCase();

                // Hover highlight
                if (this._hoverIdx === j) {
                    ctx.fillStyle = theme.withAlpha(t.text, 0.05);
                    ctx.fillRect(pad, ry, w - pad * 2, rowH);
                }

                // Severity left border
                if (sev === 'critical') {
                    ctx.fillStyle = t.guardsRed;
                    ctx.fillRect(pad, ry + 2, 3, rowH - 4);
                } else if (sev === 'warning') {
                    ctx.fillStyle = t.warn;
                    ctx.fillRect(pad, ry + 2, 3, rowH - 4);
                }

                var xCursor = pad + 10;

                // Timestamp
                if (showTimestamp) {
                    var tsText = formatTimestamp(ev.ts);
                    ctx.font = tsFontSize + 'px ' + theme.FONTS.mono;
                    ctx.fillStyle = t.textFaint;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(tsText, xCursor, textY);
                    xCursor += ctx.measureText('00:00:00').width + 12;
                }

                // Category dot
                if (showCategory && ev.cat) {
                    var dotColor = categoryColor(t, ev.cat);
                    ctx.beginPath();
                    ctx.arc(xCursor + dotSize / 2, textY, dotSize / 2, 0, Math.PI * 2);
                    ctx.fillStyle = dotColor;
                    ctx.fill();
                    xCursor += dotSize + 10;
                }

                // Message
                ctx.font = msgFontSize + 'px ' + theme.FONTS.mono;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                var maxMsgW = w - pad - xCursor - 8;
                var msgText = ev.msg;
                if (ctx.measureText(msgText).width > maxMsgW) {
                    while (msgText.length > 3 && ctx.measureText(msgText + '...').width > maxMsgW) {
                        msgText = msgText.substring(0, msgText.length - 1);
                    }
                    msgText += '...';
                }
                ctx.fillText(msgText, xCursor, textY);

                // Row separator
                ctx.strokeStyle = t.edge;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(pad, ry + rowH - 0.5);
                ctx.lineTo(w - pad, ry + rowH - 0.5);
                ctx.stroke();

                // Tooltip
                var sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
                this._hitRegions.push({
                    x: pad, y: ry, w: w - pad * 2, h: rowH,
                    tip: formatTimestamp(ev.ts) +
                         (ev.cat ? ' [' + ev.cat.toUpperCase() + ']' : '') +
                         ' ' + ev.msg +
                         ' (' + sevLabel + ')'
                });
            }
        },

        _onMouseMove: function(e) {
            var rect = this.canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;
            var hit = this._hitTest(mx, my);
            if (hit !== null) {
                var region = this._hitRegions[hit];
                this._tooltip.innerHTML = region.tip;
                this._tooltip.style.display = 'block';
                var tx = mx + 14;
                var ty = my - 10;
                if (tx + 280 > this.el.offsetWidth) tx = mx - 280;
                if (ty < 0) ty = my + 20;
                this._tooltip.style.left = tx + 'px';
                this._tooltip.style.top = ty + 'px';
                this.canvas.style.cursor = 'pointer';
                if (this._hoverIdx !== hit) {
                    this._hoverIdx = hit;
                    this._render(this._lastData, this._lastConfig);
                }
            } else {
                this._tooltip.style.display = 'none';
                this.canvas.style.cursor = 'default';
                if (this._hoverIdx !== -1) {
                    this._hoverIdx = -1;
                    this._render(this._lastData, this._lastConfig);
                }
            }
        },

        _hitTest: function(mx, my) {
            for (var i = 0; i < this._hitRegions.length; i++) {
                var r = this._hitRegions[i];
                if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i;
            }
            return null;
        },

        reflow: function() {
            if (this._lastConfig) this._render(this._lastData, this._lastConfig);
        },

        destroy: function() {
            if (this._tooltip && this._tooltip.parentNode) {
                this._tooltip.parentNode.removeChild(this._tooltip);
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
