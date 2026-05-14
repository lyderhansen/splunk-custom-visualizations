/*
 * Nike Training Club — Trainer Board
 * Ranked trainer leaderboard with scores and session counts.
 * ES5 only. Canvas 2D. No jQuery.
 */
var SplunkVisualizationBase = require('api/SplunkVisualizationBase');
var theme = require('shared/theme');

module.exports = SplunkVisualizationBase.extend({

    initialize: function() {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.style.overflow = 'hidden';
        this._hitRegions = [];
        this._hoveredIdx = -1;
        this._tooltip = document.createElement('div');
        this._tooltip.style.cssText =
            'position:absolute;display:none;padding:6px 10px;' +
            'background:rgba(0,0,0,0.90);color:#fff;font-size:12px;' +
            'border-radius:3px;pointer-events:none;white-space:nowrap;' +
            'z-index:100;font-family:' + theme.FONTS.ui + ';';
        this.el.style.position = 'relative';
        this.el.appendChild(this._tooltip);
        var self = this;
        this.el.addEventListener('mousemove', function(e) { self._onHover(e); });
        this.el.addEventListener('mouseleave', function() {
            self._tooltip.style.display = 'none';
            self._hoveredIdx = -1;
            if (self._lastData && self._lastConfig) self._render(self._lastData, self._lastConfig);
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
            return data;
        }
        var fields = data.fields;
        var colIdx = {};
        for (var i = 0; i < fields.length; i++) {
            colIdx[fields[i].name] = i;
        }
        var result = { colIdx: colIdx, rows: data.rows };
        this._lastGoodData = result;
        return result;
    },

    updateView: function(data, config) {
        if (!data || !data.colIdx) return;
        this._lastData = data;
        this._lastConfig = config;
        this._hoveredIdx = -1;
        this._render(data, config);
    },

    _render: function(data, config) {
        var ns = theme.getNS(this);
        var t = theme.getTheme(theme.getOption(config, ns, 'theme', 'dark'));
        var gi = theme.parseNum(theme.getOption(config, ns, 'accentIntensity', '50'), 50) / 50;

        var rankField = theme.getOption(config, ns, 'rankField', 'rank');
        var nameField = theme.getOption(config, ns, 'nameField', 'name');
        var scoreField = theme.getOption(config, ns, 'scoreField', 'score');
        var sessionsField = theme.getOption(config, ns, 'sessionsField', 'sessions');
        var trendField = theme.getOption(config, ns, 'trendField', 'trend');
        var decimals = theme.parseNum(theme.getOption(config, ns, 'decimals', '1'), 1);
        var maxScoreVal = theme.parseNum(theme.getOption(config, ns, 'maxValue', '5.0'), 5.0);
        var accentColor = theme.getOption(config, ns, 'accentColor', t.accent);

        var setup = theme.setupCanvas(this.el);
        var ctx = setup.ctx;
        var w = setup.w;
        var h = setup.h;
        this._canvas = setup.canvas;

        ctx.clearRect(0, 0, w, h);

        // Panel chrome
        ctx.fillStyle = t.panel;
        theme.roundRect(ctx, 0, 0, w, h, 2);
        ctx.fill();
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 2, 2, h - 4);

        var rows = data.rows;
        var ci = data.colIdx;
        var pad = Math.max(8, Math.round(w * 0.03));
        var rowCount = Math.min(rows.length, 12);
        var gap = Math.max(2, Math.round(h * 0.008));
        var availH = h - pad * 2;
        var rowH = Math.max(20, Math.floor((availH - (rowCount - 1) * gap) / rowCount));
        var fontSize = Math.max(8, Math.round(rowH * 0.38));
        var rankSize = Math.max(12, Math.round(rowH * 0.55));
        var subSize = Math.max(7, Math.round(rowH * 0.28));

        this._hitRegions = [];

        for (var i = 0; i < rowCount; i++) {
            var row = rows[i];
            var rank = ci[rankField] !== undefined ? parseInt(row[ci[rankField]], 10) : (i + 1);
            var name = ci[nameField] !== undefined ? String(row[ci[nameField]]) : '';
            var score = ci[scoreField] !== undefined ? parseFloat(row[ci[scoreField]]) : 0;
            var sessions = ci[sessionsField] !== undefined ? row[ci[sessionsField]] : '';
            var trendVal = ci[trendField] !== undefined ? parseFloat(row[ci[trendField]]) : NaN;
            if (isNaN(score)) score = 0;

            var ry = pad + i * (rowH + gap);
            var isTop3 = rank <= 3;
            var isHovered = (this._hoveredIdx === i);

            // Row background on hover
            if (isHovered) {
                ctx.fillStyle = t.panelHi;
                ctx.fillRect(pad, ry, w - pad * 2, rowH);
            }

            // Top 3 glow on left edge
            if (isTop3 && gi > 0) {
                ctx.save();
                ctx.shadowBlur = 6 * gi;
                ctx.shadowColor = theme.withAlpha(accentColor, 0.4 * gi);
                ctx.fillStyle = accentColor;
                ctx.fillRect(pad + 4, ry + 2, 2, rowH - 4);
                ctx.restore();
                ctx.shadowBlur = 0;
                ctx.shadowColor = 'transparent';
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            }

            // Rank number
            var rankX = pad + 10;
            ctx.font = '800 ' + rankSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = isTop3 ? accentColor : t.textDim;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(rank), rankX + rankSize * 0.4, ry + rowH / 2);

            // Name
            var nameX = rankX + rankSize + 12;
            ctx.font = (isHovered ? '600 ' : '400 ') + fontSize + 'px ' + theme.FONTS.ui;
            ctx.fillStyle = t.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(name, nameX, ry + rowH * 0.40);

            // Sessions below name
            if (sessions) {
                ctx.font = '400 ' + subSize + 'px ' + theme.FONTS.data;
                ctx.fillStyle = t.textFaint;
                ctx.fillText(sessions + ' sessions', nameX, ry + rowH * 0.72);
            }

            // Score bar on right
            var barW = Math.round(w * 0.18);
            var barH = Math.max(4, rowH * 0.18);
            var barX = w - pad - barW - 50;
            var barY = ry + (rowH - barH) / 2;
            var scorePct = Math.min(score / maxScoreVal, 1);

            ctx.fillStyle = t.name === 'dark' ? '#1A1A1A' : 'rgba(0,0,0,0.04)';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = theme.withAlpha(accentColor, isTop3 ? 0.9 : 0.5);
            ctx.fillRect(barX, barY, barW * scorePct, barH);

            // Score number
            ctx.font = '700 ' + fontSize + 'px ' + theme.FONTS.data;
            ctx.fillStyle = isTop3 ? accentColor : t.text;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(score.toFixed(decimals), w - pad - 6, ry + rowH / 2);

            // Trend arrow
            if (!isNaN(trendVal) && trendVal !== 0) {
                var arrow = trendVal > 0 ? '▲' : '▼';
                var tColor = trendVal > 0 ? accentColor : t.danger;
                ctx.font = '400 ' + subSize + 'px ' + theme.FONTS.data;
                ctx.fillStyle = tColor;
                ctx.textAlign = 'right';
                ctx.fillText(arrow, w - pad - 6 - fontSize * 2.5, ry + rowH / 2);
            }

            this._hitRegions.push({ y: ry, h: rowH, name: name, score: score, sessions: sessions, rank: rank });
        }
    },

    _onHover: function(e) {
        if (!this._canvas) return;
        var rect = this._canvas.getBoundingClientRect();
        var my = e.clientY - rect.top;
        var hit = -1;
        for (var i = 0; i < this._hitRegions.length; i++) {
            var r = this._hitRegions[i];
            if (my >= r.y && my <= r.y + r.h) { hit = i; break; }
        }
        if (hit !== this._hoveredIdx) {
            this._hoveredIdx = hit;
            if (this._lastData && this._lastConfig) this._render(this._lastData, this._lastConfig);
        }
        if (hit >= 0) {
            var hr = this._hitRegions[hit];
            this._tooltip.textContent = '#' + hr.rank + ' ' + hr.name + ' — ' + hr.score + ' rating, ' + hr.sessions + ' sessions';
            this._tooltip.style.display = 'block';
            var elRect = this.el.getBoundingClientRect();
            this._tooltip.style.left = (e.clientX - elRect.left + 12) + 'px';
            this._tooltip.style.top = (e.clientY - elRect.top - 8) + 'px';
        } else {
            this._tooltip.style.display = 'none';
        }
    },

    reflow: function() {
        if (this._lastData && this._lastConfig) {
            this._render(this._lastData, this._lastConfig);
        }
    },

    destroy: function() {
        if (this._tooltip && this._tooltip.parentNode) {
            this._tooltip.parentNode.removeChild(this._tooltip);
        }
        SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
    }
});
