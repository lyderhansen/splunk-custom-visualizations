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

            var startField = getOption(config, ns, 'startLapField', 'start_lap');
            var endField = getOption(config, ns, 'endLapField', 'end_lap');
            var compoundField = getOption(config, ns, 'compoundField', 'compound');
            var driverField = getOption(config, ns, 'driverField', 'driver');
            var totalField = getOption(config, ns, 'totalLapsField', 'total_laps');
            var currentField = getOption(config, ns, 'currentLapField', 'current_lap');
            var showCompound = parseBool(getOption(config, ns, 'showCompound', 'true'), true);
            var showPitStops = parseBool(getOption(config, ns, 'showPitStops', 'true'), true);
            var showCurrentLap = parseBool(getOption(config, ns, 'showCurrentLap', 'true'), true);

            var colIdx = data.colIdx;
            var rows = data.rows;

            // Read total_laps and current_lap from first row
            var totalLaps = colIdx[totalField] !== undefined ? parseInt(rows[0][colIdx[totalField]], 10) : 60;
            var currentLap = colIdx[currentField] !== undefined ? parseInt(rows[0][colIdx[currentField]], 10) : -1;

            // Parse stints
            var stints = [];
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                var startLap = colIdx[startField] !== undefined ? parseInt(row[colIdx[startField]], 10) : 0;
                var endLap = colIdx[endField] !== undefined ? parseInt(row[colIdx[endField]], 10) : 0;
                var compound = colIdx[compoundField] !== undefined ? String(row[colIdx[compoundField]]) : '';
                var driver = colIdx[driverField] !== undefined ? String(row[colIdx[driverField]]) : '';
                stints.push({ start: startLap, end: endLap, compound: compound, driver: driver });
            }

            var pad = Math.max(12, w * 0.03);
            var labelH = 18;
            var barH = Math.max(24, Math.min(40, h * 0.4));
            var axisH = 18;
            var barY = (h - barH) / 2;
            var barLeft = pad;
            var barRight = w - pad;
            var barW = barRight - barLeft;

            // "RACE PROGRESS" label
            ctx.font = '11px ' + theme.FONTS.ui;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText('RACE PROGRESS', pad, barY - 6);

            // Track background
            ctx.fillStyle = t.edge;
            ctx.fillRect(barLeft, barY, barW, barH);

            this._hitRegions = [];

            // Draw stints
            for (var j = 0; j < stints.length; j++) {
                var st = stints[j];
                var x1 = barLeft + (st.start / totalLaps) * barW;
                var x2 = barLeft + (st.end / totalLaps) * barW;
                var blockW = x2 - x1 - 1;
                if (blockW < 1) blockW = 1;

                var compColor = theme.compoundColor(t, st.compound);

                // Hover brighten
                var alpha = (this._hoverIdx === j) ? 1.0 : 0.85;
                ctx.fillStyle = theme.withAlpha(compColor, alpha);
                ctx.fillRect(x1, barY, blockW, barH);

                // Hover border
                if (this._hoverIdx === j) {
                    ctx.strokeStyle = t.text;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x1 + 1, barY + 1, blockW - 2, barH - 2);
                }

                // Compound label inside block
                if (showCompound && blockW > 40) {
                    var compText = st.compound.toUpperCase();
                    var compFontSize = Math.max(8, Math.min(11, barH * 0.3));
                    ctx.font = 'bold ' + compFontSize + 'px ' + theme.FONTS.ui;
                    var compLower = st.compound.toLowerCase();
                    var textColor = (compLower === 'medium' || compLower === 'hard') ? '#0A0A0A' : '#FFFFFF';
                    ctx.fillStyle = textColor;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(compText, x1 + blockW / 2, barY + barH / 2);
                }

                // Pit stop line between stints
                if (showPitStops && j < stints.length - 1) {
                    ctx.strokeStyle = t.text;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(x2, barY - 4);
                    ctx.lineTo(x2, barY + barH + 4);
                    ctx.stroke();
                }

                var stintLaps = st.end - st.start;
                this._hitRegions.push({
                    x: x1, y: barY, w: blockW, h: barH,
                    tip: '<b>Stint ' + (j + 1) + '</b>: Laps ' + st.start + '–' + st.end +
                         ' | ' + st.compound.charAt(0).toUpperCase() + st.compound.slice(1) +
                         ' | ' + stintLaps + ' laps' +
                         (st.driver ? ' | ' + st.driver : '')
                });
            }

            // Current lap marker
            if (showCurrentLap && currentLap > 0 && currentLap <= totalLaps) {
                var lapX = barLeft + (currentLap / totalLaps) * barW;

                // Vertical line
                ctx.strokeStyle = t.guardsRed;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(lapX, barY - 8);
                ctx.lineTo(lapX, barY + barH + 8);
                ctx.stroke();

                // Triangle at top
                var triSize = 6;
                ctx.fillStyle = t.guardsRed;
                ctx.beginPath();
                ctx.moveTo(lapX - triSize, barY - 8);
                ctx.lineTo(lapX + triSize, barY - 8);
                ctx.lineTo(lapX, barY - 2);
                ctx.closePath();
                ctx.fill();

                // Lap label below
                ctx.font = '10px ' + theme.FONTS.mono;
                ctx.fillStyle = t.guardsRed;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText('LAP ' + currentLap, lapX, barY + barH + 10);
            }

            // Lap axis
            var tickInterval = totalLaps <= 30 ? 5 : 10;
            ctx.font = '10px ' + theme.FONTS.mono;
            ctx.fillStyle = t.textFaint;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            var axisY = barY + barH + 4;

            for (var lap = 0; lap <= totalLaps; lap += tickInterval) {
                var tickX = barLeft + (lap / totalLaps) * barW;

                // Tick mark
                ctx.strokeStyle = t.textFaint;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(tickX, barY + barH);
                ctx.lineTo(tickX, barY + barH + 3);
                ctx.stroke();

                // Avoid overlap with current lap label
                if (showCurrentLap && currentLap > 0 && Math.abs(lap - currentLap) < tickInterval * 0.6) continue;
                ctx.fillText(String(lap), tickX, axisY);
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
                if (tx + 240 > this.el.offsetWidth) tx = mx - 240;
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
