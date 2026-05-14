/*
 * Porsche Taycan — Sensor Temperature Table
 * Glass panel table with severity dots, trend deltas, hover, and click drilldown.
 * ES5 only — no const/let/arrow/template literals.
 *
 * SPL: | inputlookup porsche_sensors.csv
 * Fields: sensor, temperature, status, trend
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    var T = require('shared/theme');

    function findColIdx(fields, name) {
        if (!fields || !name) return -1;
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].name === name) return i;
        }
        return -1;
    }

    function parseNumSafe(v) {
        var n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    }

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('porsche-cursor-sensor-table');
            this.el.style.overflow = 'hidden';
            this.el.style.position = 'relative';
            this._lastGoodData = null;
            this._lastConfig = null;
            this._viewSetup = false;
            this._mouseY = 0;
            this._hoverRow = -1;
            this._selectedRow = -1;
            this._rowHit = [];
            this._ro = null;
            this.setupView();
        },

        setupView: function() {
            if (this._viewSetup) return;
            this._viewSetup = true;

            var canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            this.el.appendChild(canvas);
            this.canvas = canvas;

            var self = this;

            canvas.addEventListener('mousemove', function(e) {
                var rect = canvas.getBoundingClientRect();
                self._mouseY = e.clientY - rect.top;
                var idx = self._hitTestRow(self._mouseY);
                if (idx !== self._hoverRow) {
                    self._hoverRow = idx;
                    canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
                    if (typeof self.invalidateUpdateView === 'function') {
                        self.invalidateUpdateView();
                    }
                }
            });

            canvas.addEventListener('click', function(e) {
                var rect = canvas.getBoundingClientRect();
                var y = e.clientY - rect.top;
                var idx = self._hitTestRow(y);
                if (idx < 0) return;
                self._selectedRow = idx;
                var row = self._rowForDrilldown(idx);
                if (row && row.sensor !== undefined && row.sensor !== null) {
                    self.drilldown({
                        action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
                        data: { 'sensor.value': String(row.sensor) }
                    }, e);
                }
                if (typeof self.invalidateUpdateView === 'function') {
                    self.invalidateUpdateView();
                }
            });

            canvas.addEventListener('mouseleave', function() {
                self._mouseY = -1;
                if (self._hoverRow !== -1) {
                    self._hoverRow = -1;
                    canvas.style.cursor = 'default';
                    if (typeof self.invalidateUpdateView === 'function') {
                        self.invalidateUpdateView();
                    }
                }
            });

            T.loadFonts(function() {
                if (typeof self.invalidateUpdateView === 'function') {
                    self.invalidateUpdateView();
                }
            });

            if (typeof ResizeObserver !== 'undefined') {
                this._ro = new ResizeObserver(function() {
                    self.reflow();
                });
                this._ro.observe(this.el);
            }
        },

        _hitTestRow: function(canvasY) {
            for (var i = 0; i < this._rowHit.length; i++) {
                var r = this._rowHit[i];
                if (canvasY >= r.y && canvasY < r.y + r.h) return r.index;
            }
            return -1;
        },

        _rowForDrilldown: function(rowIndex) {
            var data = this._lastGoodData;
            if (!data || !data.rows) return null;
            var ns = T.getNS(this);
            if (!this._lastConfig) return null;
            var sf = T.getOption(this._lastConfig, ns, 'sensorField', 'sensor');
            var tf = T.getOption(this._lastConfig, ns, 'tempField', 'temperature');
            var stf = T.getOption(this._lastConfig, ns, 'statusField', 'status');
            var trf = T.getOption(this._lastConfig, ns, 'trendField', 'trend');
            var is = findColIdx(data.fields, sf);
            var it = findColIdx(data.fields, tf);
            var ist = findColIdx(data.fields, stf);
            var itr = findColIdx(data.fields, trf);
            var row = data.rows[rowIndex];
            if (!row) return null;
            return {
                sensor: is >= 0 ? row[is] : '',
                temperature: it >= 0 ? row[it] : '',
                status: ist >= 0 ? row[ist] : '',
                trend: itr >= 0 ? row[itr] : ''
            };
        },

        destroy: function() {
            if (this._ro) {
                try {
                    this._ro.disconnect();
                } catch (e) {}
                this._ro = null;
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 50
            };
        },

        formatData: function(data) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data — Sensor Temperatures'
                );
            }

            var fields = data.fields;
            var rows = data.rows;
            var colIdx = {};
            for (var fi = 0; fi < fields.length; fi++) {
                colIdx[fields[fi].name] = fi;
            }

            var items = [];
            for (var ri = 0; ri < rows.length; ri++) {
                var row = rows[ri];
                var gs = colIdx.sensor !== undefined ? row[colIdx.sensor] : '';
                var gt = colIdx.temperature !== undefined ? row[colIdx.temperature] : '';
                var gst = colIdx.status !== undefined ? row[colIdx.status] : '';
                var gtr = colIdx.trend !== undefined ? row[colIdx.trend] : '';
                items.push({
                    sensor: gs !== null && gs !== undefined ? String(gs) : '',
                    temperature: parseNumSafe(gt),
                    status: gst !== null && gst !== undefined ? String(gst) : '',
                    trend: parseNumSafe(gtr)
                });
            }

            var result = { fields: fields, rows: rows, colIdx: colIdx, items: items };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!this.canvas) return;

            this._lastConfig = config || this._lastConfig;

            if (!data) {
                if (this._lastGoodData) {
                    data = this._lastGoodData;
                } else {
                    return;
                }
            }

            var w = this.el.offsetWidth;
            var h = this.el.offsetHeight;
            if (w <= 0 || h <= 0) return;

            var dpr = window.devicePixelRatio || 1;
            var canvas = this.canvas;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            var ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            var ns = T.getNS(this);
            var cfg = config || this._lastConfig || {};
            var t = T.getTheme('dark');

            var sensorField = T.getOption(cfg, ns, 'sensorField', 'sensor');
            var tempField = T.getOption(cfg, ns, 'tempField', 'temperature');
            var statusField = T.getOption(cfg, ns, 'statusField', 'status');
            var trendField = T.getOption(cfg, ns, 'trendField', 'trend');
            var titleText = T.getOption(cfg, ns, 'title', 'Sensor Temperatures');

            var headerFontSetting = parseInt(T.getOption(cfg, ns, 'headerFontSize', '0'), 10);
            var bodyFontSetting = parseInt(T.getOption(cfg, ns, 'bodyFontSize', '0'), 10);
            if (isNaN(headerFontSetting)) headerFontSetting = 0;
            if (isNaN(bodyFontSetting)) bodyFontSetting = 0;

            var accentIntensity = parseFloat(T.getOption(cfg, ns, 'accentIntensity', '0.7'));
            if (isNaN(accentIntensity)) accentIntensity = 0.7;
            if (accentIntensity < 0) accentIntensity = 0;
            if (accentIntensity > 1) accentIntensity = 1;

            var iSensor = findColIdx(data.fields, sensorField);
            var iTemp = findColIdx(data.fields, tempField);
            var iStatus = findColIdx(data.fields, statusField);
            var iTrend = findColIdx(data.fields, trendField);

            var items = [];
            for (var rx = 0; rx < data.rows.length; rx++) {
                var nrow = data.rows[rx];
                items.push({
                    sensor: iSensor >= 0 && nrow[iSensor] !== undefined && nrow[iSensor] !== null
                        ? String(nrow[iSensor]) : '',
                    temperature: iTemp >= 0 ? parseNumSafe(nrow[iTemp]) : 0,
                    status: iStatus >= 0 && nrow[iStatus] !== undefined && nrow[iStatus] !== null
                        ? String(nrow[iStatus]) : '',
                    trend: iTrend >= 0 ? parseNumSafe(nrow[iTrend]) : 0
                });
            }

            var numRows = items.length;
            if (numRows === 0) {
                T.resetShadow(ctx);
                return;
            }

            var pad = Math.max(8, Math.min(w, h) * 0.04);
            var panelR = Math.max(10, Math.min(w, h) * 0.024);

            ctx.fillStyle = t.bg;
            ctx.fillRect(0, 0, w, h);

            T.drawGlassPanel(ctx, t, pad, pad, w - 2 * pad, h - 2 * pad, panelR);
            T.resetShadow(ctx);

            var innerX = pad + 12;
            var innerY = pad + 12;
            var innerW = w - 2 * pad - 24;
            var innerH = h - 2 * pad - 24;

            var titleSize = headerFontSetting > 0 ? headerFontSetting
                : Math.max(12, Math.min(20, Math.min(w, h) * 0.028));
            ctx.font = '500 ' + titleSize + 'px ' + T.FONTS.ui;
            ctx.fillStyle = T.withAlpha(t.text, 0.88);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(titleText, innerX, innerY);

            var titleH = titleSize + 10;
            var headerH = headerFontSetting > 0 ? headerFontSetting + 18
                : Math.max(26, Math.min(36, innerH * 0.08));
            var bodyTop = innerY + titleH + 4;
            var row0 = bodyTop + headerH;
            var contentBottom = innerY + innerH - 8;
            var rowAreaH = contentBottom - row0;
            if (rowAreaH < 20) rowAreaH = 20;
            var rowH = rowAreaH / numRows;
            if (rowH < 18) rowH = 18;

            var bodyFont = bodyFontSetting > 0 ? bodyFontSetting
                : Math.max(10, Math.min(16, rowH * 0.42));

            var colSensorW = innerW * 0.40;
            var colTempW = innerW * 0.22;
            var colStatW = innerW * 0.18;

            var xSensor = innerX;
            var xTemp = xSensor + colSensorW;
            var xStat = xTemp + colTempW;

            ctx.font = '600 ' + (headerFontSetting > 0 ? Math.max(9, headerFontSetting - 1) : Math.max(9, bodyFont * 0.78)) + 'px ' + T.FONTS.ui;
            ctx.fillStyle = t.textFaint;
            ctx.textBaseline = 'middle';

            ctx.textAlign = 'left';
            ctx.fillText('SENSOR', xSensor, bodyTop + headerH / 2);

            ctx.textAlign = 'right';
            ctx.fillText('TEMP', xSensor + colSensorW + colTempW, bodyTop + headerH / 2);

            ctx.textAlign = 'center';
            ctx.fillText('STATUS', xStat + colStatW / 2, bodyTop + headerH / 2);

            ctx.textAlign = 'right';
            ctx.fillText('TREND', innerX + innerW, bodyTop + headerH / 2);

            this._rowHit = [];

            var dotR = 6;

            for (var ridx = 0; ridx < numRows; ridx++) {
                var ry = row0 + ridx * rowH;
                this._rowHit.push({ y: ry, h: rowH, index: ridx });

                var stripeBg = (ridx % 2 === 0) ? t.panel : T.withAlpha(t.panelHi, 0.3);
                ctx.fillStyle = stripeBg;
                ctx.fillRect(innerX, ry, innerW, rowH);

                if (ridx === this._hoverRow) {
                    ctx.fillStyle = T.withAlpha(t.text, 0.06);
                    ctx.fillRect(innerX, ry, innerW, rowH);
                }

                if (ridx === this._selectedRow) {
                    var accent = T.withAlpha(t.accent, accentIntensity);
                    ctx.fillStyle = accent;
                    ctx.fillRect(innerX, ry, 3, rowH);
                }

                var item = items[ridx];
                var midY = ry + rowH / 2;

                ctx.font = bodyFont + 'px ' + T.FONTS.ui;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                var sTxt = item.sensor || '—';
                ctx.fillText(sTxt, xSensor + 4, midY);

                ctx.font = bodyFont + 'px ' + T.FONTS.mono;
                ctx.fillStyle = t.text;
                ctx.textAlign = 'right';
                var tempStr = T.fmtNum(item.temperature, { decimals: 1 }) + '\u00B0C';
                ctx.fillText(tempStr, xTemp + colTempW - 4, midY);

                var statStr = (item.status || '').toLowerCase();
                var dotCol = T.severityColor(t, statStr);
                var cxDot = xStat + colStatW / 2;
                ctx.save();
                ctx.shadowBlur = 0;
                T.resetShadow(ctx);
                if (statStr.indexOf('warn') >= 0 || statStr === 'warning') {
                    ctx.shadowColor = T.withAlpha(dotCol, 0.55);
                    ctx.shadowBlur = 10;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                } else if (statStr.indexOf('crit') >= 0) {
                    ctx.shadowColor = T.withAlpha(dotCol, 0.65);
                    ctx.shadowBlur = 12;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                }
                ctx.beginPath();
                ctx.arc(cxDot, midY, dotR, 0, Math.PI * 2);
                ctx.fillStyle = dotCol;
                ctx.fill();
                T.resetShadow(ctx);
                ctx.restore();

                var tr = item.trend;
                var trAbs = Math.abs(tr) < 1e-9;
                var trStr;
                if (trAbs) {
                    trStr = '0.0';
                } else if (tr > 0) {
                    trStr = '+' + T.fmtNum(tr, { decimals: 1 });
                } else {
                    trStr = T.fmtNum(tr, { decimals: 1 });
                }

                var trCol;
                if (trAbs) {
                    trCol = t.textFaint;
                } else if (tr > 0) {
                    trCol = t.warn;
                } else {
                    trCol = t.success;
                }

                ctx.font = bodyFont + 'px ' + T.FONTS.mono;
                ctx.fillStyle = trCol;
                ctx.textAlign = 'right';
                ctx.fillText(trStr, innerX + innerW - 4, midY);
            }

            T.resetShadow(ctx);
        },

        reflow: function() {
            if (typeof this.invalidateUpdateView === 'function') {
                this.invalidateUpdateView();
            }
        }
    });
});
