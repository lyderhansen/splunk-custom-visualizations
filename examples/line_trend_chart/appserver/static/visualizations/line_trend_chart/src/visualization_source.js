/*
 * Line Trend Chart — Splunk Custom Visualization
 *
 * Renders a line/area chart with colored background sections,
 * multiple series, smooth/straight lines, and hover crosshair tooltip.
 *
 * Expected SPL columns: <x_col>, <series1>, <series2>, ..., [zone_col]
 * First column (configurable) = x-axis labels/times.
 * Remaining numeric columns = line series.
 * Optional zone column = background highlight zones.
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    // ── Color Palettes ──────────────────────────────────────────

    var PALETTES = {
        warm: [
            { r: 255, g: 160, b: 50 },
            { r: 239, g: 68, b: 68 },
            { r: 251, g: 191, b: 36 },
            { r: 245, g: 101, b: 35 },
            { r: 220, g: 80, b: 40 },
            { r: 234, g: 140, b: 72 },
            { r: 200, g: 60, b: 60 },
            { r: 180, g: 120, b: 50 }
        ],
        cool: [
            { r: 59, g: 130, b: 246 },
            { r: 99, g: 102, b: 241 },
            { r: 14, g: 165, b: 233 },
            { r: 139, g: 92, b: 246 },
            { r: 6, g: 182, b: 212 },
            { r: 79, g: 70, b: 229 },
            { r: 56, g: 189, b: 248 },
            { r: 168, g: 85, b: 247 }
        ],
        green: [
            { r: 34, g: 197, b: 94 },
            { r: 16, g: 185, b: 129 },
            { r: 132, g: 204, b: 22 },
            { r: 5, g: 150, b: 105 },
            { r: 74, g: 222, b: 128 },
            { r: 20, g: 184, b: 166 },
            { r: 163, g: 230, b: 53 },
            { r: 4, g: 120, b: 87 }
        ],
        neon: [
            { r: 0, g: 255, b: 136 },
            { r: 255, g: 0, b: 128 },
            { r: 0, g: 200, b: 255 },
            { r: 255, g: 255, b: 0 },
            { r: 190, g: 0, b: 255 },
            { r: 255, g: 100, b: 0 },
            { r: 0, g: 255, b: 255 },
            { r: 255, g: 0, b: 255 }
        ],
        pastel: [
            { r: 147, g: 197, b: 253 },
            { r: 252, g: 165, b: 165 },
            { r: 167, g: 243, b: 208 },
            { r: 253, g: 230, b: 138 },
            { r: 196, g: 181, b: 253 },
            { r: 254, g: 202, b: 202 },
            { r: 165, g: 243, b: 252 },
            { r: 251, g: 207, b: 232 }
        ],
        earth: [
            { r: 168, g: 124, b: 89 },
            { r: 130, g: 155, b: 105 },
            { r: 190, g: 160, b: 120 },
            { r: 100, g: 130, b: 90 },
            { r: 210, g: 180, b: 140 },
            { r: 85, g: 110, b: 80 },
            { r: 160, g: 110, b: 75 },
            { r: 120, g: 140, b: 100 }
        ]
    };

    // ── Color Utilities ─────────────────────────────────────────

    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        };
    }

    function rgbaStr(c, a) {
        return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
    }

    // Parse color overrides — supports both formats:
    //   newline-separated: "name:#hex\nname2:#hex"
    //   comma-separated:   "name:#hex, name2:#hex"
    function parseColorOverrides(str) {
        var map = {};
        if (!str) return map;
        // Split by newlines first, then by commas within each line
        var lines = str.split('\n');
        for (var l = 0; l < lines.length; l++) {
            var parts = lines[l].split(',');
            for (var i = 0; i < parts.length; i++) {
                var kv = parts[i].split(':');
                if (kv.length >= 2) {
                    var key = kv[0].trim();
                    var val = kv.slice(1).join(':').trim();
                    if (key && val) map[key] = val;
                }
            }
        }
        return map;
    }

    function getSeriesColor(seriesName, seriesIdx, theme, overrides) {
        if (overrides[seriesName]) {
            var hex = overrides[seriesName];
            if (hex.indexOf('rgb') === 0) return hexToRgb('#888');
            return hexToRgb(hex);
        }
        var pal = PALETTES[theme] || PALETTES.warm;
        return pal[seriesIdx % pal.length];
    }

    function parseRgbaColor(str) {
        if (!str) return null;
        str = str.trim();
        if (str.indexOf('rgba') === 0) return str;
        if (str.indexOf('rgb') === 0) return str;
        if (str.indexOf('#') === 0) {
            var c = hexToRgb(str);
            return rgbaStr(c, 0.3);
        }
        return str;
    }

    // ── X-Axis Formatting ─────────────────────────────────────

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    // strftime-style format: %Y %m %d %H %M %S %b %a %p %I and more
    var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    function strftimeFormat(d, fmt) {
        var hour12 = d.getHours() % 12;
        if (hour12 === 0) hour12 = 12;
        return fmt
            .replace(/%Y/g, '' + d.getFullYear())
            .replace(/%y/g, pad2(d.getFullYear() % 100))
            .replace(/%m/g, pad2(d.getMonth() + 1))
            .replace(/%d/g, pad2(d.getDate()))
            .replace(/%e/g, '' + d.getDate())
            .replace(/%H/g, pad2(d.getHours()))
            .replace(/%I/g, pad2(hour12))
            .replace(/%M/g, pad2(d.getMinutes()))
            .replace(/%S/g, pad2(d.getSeconds()))
            .replace(/%p/g, d.getHours() < 12 ? 'AM' : 'PM')
            .replace(/%b/g, MONTH_SHORT[d.getMonth()])
            .replace(/%a/g, DAY_SHORT[d.getDay()])
            .replace(/%Z/g, 'UTC')
            .replace(/%%/g, '%');
    }

    function isStrftimeFmt(fmt) {
        return fmt && fmt.indexOf('%') !== -1;
    }

    function formatXLabel(raw, fmt) {
        if (!raw) return '';
        if (fmt === 'raw') return raw;

        // Try to parse as date
        var d = new Date(raw);
        var isDate = !isNaN(d.getTime()) && raw.length > 8;

        if (!isDate) return raw;

        // Custom strftime pattern (contains %)
        if (isStrftimeFmt(fmt)) return strftimeFormat(d, fmt);

        // Preset keywords
        if (fmt === 'time') return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        if (fmt === 'date') return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
        if (fmt === 'datetime') return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        if (fmt === 'short') return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

        // Auto: check if it looks like an ISO timestamp
        if (fmt === 'auto' || !fmt) {
            if (raw.indexOf('T') !== -1 || raw.match(/^\d{4}-\d{2}-\d{2}/)) {
                return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
            }
        }
        return raw;
    }

    function formatXLabels(rawLabels, fmt) {
        if (fmt === 'raw') return rawLabels;

        var formatted = [];
        for (var i = 0; i < rawLabels.length; i++) {
            formatted.push(formatXLabel(rawLabels[i], fmt));
        }

        // Auto: if all formatted labels have same date, strip the date and show time only
        if ((fmt === 'auto' || fmt === 'datetime') && formatted.length > 1) {
            var allSameDate = true;
            var firstDate = formatted[0].substring(0, 5);
            for (var i = 1; i < formatted.length; i++) {
                if (formatted[i].substring(0, 5) !== firstDate) { allSameDate = false; break; }
            }
            if (allSameDate) {
                for (var i = 0; i < formatted.length; i++) {
                    var spaceIdx = formatted[i].indexOf(' ');
                    if (spaceIdx !== -1) formatted[i] = formatted[i].substring(spaceIdx + 1);
                }
            }
        }
        return formatted;
    }

    // ── Monotone Cubic Spline ───────────────────────────────────

    function computeMonotoneControlPoints(pts) {
        var n = pts.length;
        if (n < 2) return [];

        var dx = [];
        var dy = [];
        var m = [];
        var cps = [];

        for (var i = 0; i < n - 1; i++) {
            dx.push(pts[i + 1].x - pts[i].x);
            dy.push(pts[i + 1].y - pts[i].y);
            m.push(dx[i] === 0 ? 0 : dy[i] / dx[i]);
        }

        var tangents = [m[0]];
        for (var i = 1; i < n - 1; i++) {
            if (m[i - 1] * m[i] <= 0) {
                tangents.push(0);
            } else {
                tangents.push((m[i - 1] + m[i]) / 2);
            }
        }
        tangents.push(m[n - 2]);

        for (var i = 0; i < n - 1; i++) {
            if (m[i] === 0) {
                tangents[i] = 0;
                tangents[i + 1] = 0;
            } else {
                var a = tangents[i] / m[i];
                var b = tangents[i + 1] / m[i];
                var s = a * a + b * b;
                if (s > 9) {
                    var t = 3 / Math.sqrt(s);
                    tangents[i] = t * a * m[i];
                    tangents[i + 1] = t * b * m[i];
                }
            }
        }

        for (var i = 0; i < n - 1; i++) {
            var d = dx[i] / 3;
            cps.push({
                cp1x: pts[i].x + d,
                cp1y: pts[i].y + tangents[i] * d,
                cp2x: pts[i + 1].x - d,
                cp2y: pts[i + 1].y - tangents[i + 1] * d
            });
        }
        return cps;
    }

    // ── Number Formatting ──────────────────────────────────────

    function formatNumber(val) {
        if (val === 0) return '0';
        var abs = Math.abs(val);
        var str;
        if (abs >= 1000000) {
            str = (val / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        } else if (abs >= 10000) {
            str = (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        } else {
            // Add thousands separator
            str = Math.round(val).toString();
            var parts = str.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            str = parts.join('.');
        }
        return str;
    }

    // Smart grid step calculation — pick nice round intervals
    function computeNiceSteps(yMin, yMax) {
        var range = yMax - yMin;
        if (range <= 0) return { steps: 4, stepSize: 25 };
        var rough = range / 5;
        var mag = Math.pow(10, Math.floor(Math.log10(rough)));
        var residual = rough / mag;
        var nice;
        if (residual <= 1) nice = 1;
        else if (residual <= 2) nice = 2;
        else if (residual <= 5) nice = 5;
        else nice = 10;
        var stepSize = nice * mag;
        var steps = Math.max(2, Math.round(range / stepSize));
        return { steps: steps, stepSize: stepSize };
    }

    // Measure the widest Y-axis label
    function measureYLabelWidth(ctx, yMin, yMax, yUnit, steps) {
        ctx.font = '11px sans-serif';
        var maxW = 0;
        for (var i = 0; i <= steps; i++) {
            var yVal = yMin + (yMax - yMin) * (i / steps);
            var label = formatNumber(yVal);
            if (yUnit) label = label + ' ' + yUnit;
            var w = ctx.measureText(label).width;
            if (w > maxW) maxW = w;
        }
        return Math.ceil(maxW) + 12;
    }

    // ── Drawing Helpers ─────────────────────────────────────────

    function drawGrid(ctx, plotArea, yMin, yMax, yUnit, gridSteps, textColor, gridColor) {
        var pa = plotArea;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.font = '11px sans-serif';
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';

        for (var i = 0; i <= gridSteps; i++) {
            var ratio = i / gridSteps;
            var yVal = yMin + (yMax - yMin) * ratio;
            var yPx = pa.y + pa.h - ratio * pa.h;

            ctx.beginPath();
            ctx.setLineDash([3, 3]);
            ctx.moveTo(pa.x, yPx);
            ctx.lineTo(pa.x + pa.w, yPx);
            ctx.stroke();
            ctx.setLineDash([]);

            var label = formatNumber(yVal);
            if (yUnit) label = label + ' ' + yUnit;
            ctx.fillText(label, pa.x - 8, yPx);
        }
    }

    function drawXLabels(ctx, plotArea, xLabels, xPositions, textColor) {
        var pa = plotArea;
        ctx.font = '11px sans-serif';
        ctx.fillStyle = textColor;

        // Determine if labels need rotation
        var totalLabelW = 0;
        for (var i = 0; i < xLabels.length; i++) {
            totalLabelW += ctx.measureText(xLabels[i]).width + 12;
        }
        var needsRotation = totalLabelW > pa.w * 1.2 && xLabels.length > 4;

        if (needsRotation) {
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            var lastLabelEnd = -Infinity;
            for (var i = 0; i < xLabels.length; i++) {
                var lbl = xLabels[i];
                var lx = xPositions[i];
                var ly = pa.y + pa.h + 8;
                // Space check based on rotated height
                if (lx > lastLabelEnd + 14) {
                    ctx.save();
                    ctx.translate(lx, ly);
                    ctx.rotate(-Math.PI / 4);
                    ctx.fillText(lbl, 0, 0);
                    ctx.restore();
                    lastLabelEnd = lx;
                }
            }
        } else {
            ctx.textBaseline = 'top';
            ctx.textAlign = 'center';
            var lastLabelEnd = -Infinity;
            for (var i = 0; i < xLabels.length; i++) {
                var lbl = xLabels[i];
                var lw = ctx.measureText(lbl).width;
                var lx = xPositions[i];
                if (lx - lw / 2 > lastLabelEnd + 6) {
                    ctx.fillText(lbl, lx, pa.y + pa.h + 8);
                    lastLabelEnd = lx + lw / 2;
                }
            }
        }
    }

    function drawZones(ctx, plotArea, zones, xPositions, zoneColor, zoneColorMap, textColor) {
        if (!zones || zones.length === 0) return;

        var pa = plotArea;
        var currentZone = null;
        var startIdx = -1;

        function flushZone(endIdx) {
            if (!currentZone || startIdx < 0) return;
            var x1 = xPositions[startIdx];
            var x2 = xPositions[endIdx];
            var halfStep = 0;
            if (startIdx > 0) halfStep = (xPositions[startIdx] - xPositions[startIdx - 1]) / 2;
            else if (xPositions.length > 1) halfStep = (xPositions[1] - xPositions[0]) / 2;
            var xLeft = Math.max(pa.x, x1 - halfStep);

            var halfStepR = 0;
            if (endIdx < xPositions.length - 1) halfStepR = (xPositions[endIdx + 1] - xPositions[endIdx]) / 2;
            else halfStepR = halfStep;
            var xRight = Math.min(pa.x + pa.w, x2 + halfStepR);

            var color = zoneColorMap[currentZone] || zoneColor;
            ctx.fillStyle = color;
            ctx.fillRect(xLeft, pa.y, xRight - xLeft, pa.h);

            ctx.font = 'bold 11px sans-serif';
            var ztxt = currentZone;
            var ztw = ctx.measureText(ztxt).width;
            var zcx = (xLeft + xRight) / 2;
            var zcy = pa.y - 6;
            // Background pill for zone label
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath();
            var zpr = 3;
            var zpx = zcx - ztw / 2 - 6;
            var zpy = zcy - 12;
            var zpw = ztw + 12;
            var zph = 16;
            ctx.moveTo(zpx + zpr, zpy);
            ctx.lineTo(zpx + zpw - zpr, zpy);
            ctx.arcTo(zpx + zpw, zpy, zpx + zpw, zpy + zpr, zpr);
            ctx.lineTo(zpx + zpw, zpy + zph - zpr);
            ctx.arcTo(zpx + zpw, zpy + zph, zpx + zpw - zpr, zpy + zph, zpr);
            ctx.lineTo(zpx + zpr, zpy + zph);
            ctx.arcTo(zpx, zpy + zph, zpx, zpy + zph - zpr, zpr);
            ctx.lineTo(zpx, zpy + zpr);
            ctx.arcTo(zpx, zpy, zpx + zpr, zpy, zpr);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(ztxt, zcx, zcy + 2);
        }

        for (var i = 0; i < zones.length; i++) {
            var z = zones[i];
            if (z && z !== currentZone) {
                if (currentZone) flushZone(i - 1);
                currentZone = z;
                startIdx = i;
            } else if (!z && currentZone) {
                flushZone(i - 1);
                currentZone = null;
                startIdx = -1;
            }
        }
        if (currentZone) flushZone(zones.length - 1);
    }

    // Resolve per-segment color based on zones and trend direction
    // trendOpts: { mode: 'off'|'on', risingColor: str, fallingColor: str }
    // values: raw data values array for this series
    function resolveSegColor(i, defaultColor, zones, zoneLineColor, values, trendOpts) {
        // Trend color takes priority when enabled
        if (trendOpts && trendOpts.mode === 'on' && values && i < values.length - 1) {
            var diff = values[i + 1] - values[i];
            if (diff > 0) return trendOpts.risingColor || defaultColor;
            if (diff < 0) return trendOpts.fallingColor || defaultColor;
            // flat = default color
        }
        // Zone color
        if (zoneLineColor && zones) {
            if ((zones[i] && zones[i] !== '') || (zones[i + 1] && zones[i + 1] !== '')) {
                return zoneLineColor;
            }
        }
        return defaultColor;
    }

    // Resolve per-point color (uses previous segment direction for trend)
    function resolvePointColor(i, defaultColor, zones, zoneLineColor, values, trendOpts) {
        if (trendOpts && trendOpts.mode === 'on' && values) {
            var refIdx = i > 0 ? i - 1 : 0;
            var nextIdx = i > 0 ? i : (i < values.length - 1 ? i : 0);
            var diff = values[nextIdx + (i > 0 ? 0 : 1)] - values[refIdx];
            if (i === 0 && values.length > 1) diff = values[1] - values[0];
            if (diff > 0) return trendOpts.risingColor || defaultColor;
            if (diff < 0) return trendOpts.fallingColor || defaultColor;
        }
        if (zoneLineColor && zones && zones[i] && zones[i] !== '') {
            return zoneLineColor;
        }
        return defaultColor;
    }

    function getDashPattern(style, lineWidth) {
        if (style === 'dashed') return [lineWidth * 4, lineWidth * 3];
        if (style === 'dotted') return [lineWidth, lineWidth * 2];
        return [];
    }

    // Check if we need per-segment rendering (zone colors or trend colors active)
    function needsSegmentRendering(zones, zoneLineColor, trendOpts) {
        if (trendOpts && trendOpts.mode === 'on') return true;
        if (zoneLineColor && zones && zones.length > 0) return true;
        return false;
    }

    function drawLineSeries(ctx, pts, color, lineWidth, smooth, zones, zoneLineColor, dashStyle, values, trendOpts) {
        if (pts.length < 2) return;
        var dash = getDashPattern(dashStyle, lineWidth);
        var perSeg = needsSegmentRendering(zones, zoneLineColor, trendOpts);

        if (!perSeg) {
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            if (smooth && pts.length >= 3) {
                var cps = computeMonotoneControlPoints(pts);
                for (var i = 0; i < cps.length; i++) {
                    ctx.bezierCurveTo(cps[i].cp1x, cps[i].cp1y, cps[i].cp2x, cps[i].cp2y, pts[i + 1].x, pts[i + 1].y);
                }
            } else {
                for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            return;
        }

        // Per-segment rendering
        var cps = (smooth && pts.length >= 3) ? computeMonotoneControlPoints(pts) : null;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.setLineDash(dash);

        for (var i = 0; i < pts.length - 1; i++) {
            var segCol = resolveSegColor(i, color, zones, zoneLineColor, values, trendOpts);
            ctx.strokeStyle = segCol;
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            if (cps) {
                ctx.bezierCurveTo(cps[i].cp1x, cps[i].cp1y, cps[i].cp2x, cps[i].cp2y, pts[i + 1].x, pts[i + 1].y);
            } else {
                ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    function drawAreaFill(ctx, pts, plotBottom, color, smooth, zones, zoneLineColor, defaultAlpha, values, trendOpts) {
        if (pts.length < 2) return;
        var perSeg = needsSegmentRendering(zones, zoneLineColor, trendOpts);

        if (!perSeg) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            if (smooth && pts.length >= 3) {
                var cps = computeMonotoneControlPoints(pts);
                for (var i = 0; i < cps.length; i++) {
                    ctx.bezierCurveTo(cps[i].cp1x, cps[i].cp1y, cps[i].cp2x, cps[i].cp2y, pts[i + 1].x, pts[i + 1].y);
                }
            } else {
                for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.lineTo(pts[pts.length - 1].x, plotBottom);
            ctx.lineTo(pts[0].x, plotBottom);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            return;
        }

        // Per-segment area fill
        var cps = (smooth && pts.length >= 3) ? computeMonotoneControlPoints(pts) : null;
        var alpha = defaultAlpha || 0.15;

        for (var i = 0; i < pts.length - 1; i++) {
            var segColorStr = resolveSegColor(i, '', zones, zoneLineColor, values, trendOpts);
            var fillColor;
            if (segColorStr && segColorStr !== '') {
                var segRgb = hexToRgb(segColorStr);
                fillColor = rgbaStr(segRgb, alpha);
            } else {
                fillColor = color;
            }

            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            if (cps) {
                ctx.bezierCurveTo(cps[i].cp1x, cps[i].cp1y, cps[i].cp2x, cps[i].cp2y, pts[i + 1].x, pts[i + 1].y);
            } else {
                ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
            }
            ctx.lineTo(pts[i + 1].x, plotBottom);
            ctx.lineTo(pts[i].x, plotBottom);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
        }
    }

    function drawPointShape(ctx, x, y, radius, shape) {
        ctx.beginPath();
        if (shape === 'square') {
            ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
        } else if (shape === 'diamond') {
            ctx.moveTo(x, y - radius);
            ctx.lineTo(x + radius, y);
            ctx.lineTo(x, y + radius);
            ctx.lineTo(x - radius, y);
            ctx.closePath();
        } else if (shape === 'triangle') {
            ctx.moveTo(x, y - radius);
            ctx.lineTo(x + radius * 0.87, y + radius * 0.5);
            ctx.lineTo(x - radius * 0.87, y + radius * 0.5);
            ctx.closePath();
        } else {
            ctx.arc(x, y, radius, 0, Math.PI * 2);
        }
    }

    function drawPoints(ctx, pts, color, radius, zones, zoneLineColor, shape, fillColor, values, trendOpts) {
        var pFill = fillColor || '#fff';
        for (var i = 0; i < pts.length; i++) {
            var ptColor = resolvePointColor(i, color, zones, zoneLineColor, values, trendOpts);
            drawPointShape(ctx, pts[i].x, pts[i].y, radius, shape);
            ctx.fillStyle = pFill;
            ctx.fill();
            ctx.strokeStyle = ptColor;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    function drawLegend(ctx, seriesNames, seriesColors, hiddenSeries, position, plotArea, totalW, totalH) {
        var fontSize = 12;
        var swatchSize = 10;
        var padding = 8;
        var itemPad = 18;
        ctx.font = fontSize + 'px sans-serif';

        var items = [];
        var totalItemW = 0;
        var maxItemW = 0;
        for (var i = 0; i < seriesNames.length; i++) {
            var tw = ctx.measureText(seriesNames[i]).width;
            var itemW = swatchSize + 6 + tw;
            items.push({ name: seriesNames[i], color: seriesColors[i], w: itemW, tw: tw });
            totalItemW += itemW + (i < seriesNames.length - 1 ? itemPad : 0);
            if (itemW > maxItemW) maxItemW = itemW;
        }

        var hitRects = [];
        var isHidden;

        if (position === 'top' || position === 'bottom') {
            var ly = position === 'top' ? plotArea.y - 28 : plotArea.y + plotArea.h + 30;
            var lx = plotArea.x + (plotArea.w - totalItemW) / 2;

            for (var i = 0; i < items.length; i++) {
                isHidden = hiddenSeries[items[i].name];
                var alpha = isHidden ? 0.3 : 1.0;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = rgbaStr(items[i].color, 1);
                ctx.beginPath();
                ctx.arc(lx + swatchSize / 2, ly + fontSize / 2, swatchSize / 2, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = isHidden ? 'rgba(150,150,150,0.5)' : 'rgba(220,220,220,0.9)';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                ctx.fillText(items[i].name, lx + swatchSize + 6, ly + fontSize / 2);

                if (isHidden) {
                    var textW = items[i].tw;
                    ctx.strokeStyle = 'rgba(150,150,150,0.5)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(lx + swatchSize + 6, ly + fontSize / 2);
                    ctx.lineTo(lx + swatchSize + 6 + textW, ly + fontSize / 2);
                    ctx.stroke();
                }

                ctx.globalAlpha = 1.0;
                hitRects.push({
                    x: lx - 2, y: ly - 2,
                    w: items[i].w + 4, h: fontSize + 4,
                    name: items[i].name
                });
                lx += items[i].w + itemPad;
            }
        } else {
            var colX = position === 'left' ? 10 : totalW - maxItemW - 20;
            var startY = plotArea.y + 10;

            for (var i = 0; i < items.length; i++) {
                var iy = startY + i * (fontSize + 10);
                isHidden = hiddenSeries[items[i].name];
                var alpha = isHidden ? 0.3 : 1.0;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = rgbaStr(items[i].color, 1);
                ctx.beginPath();
                ctx.arc(colX + swatchSize / 2, iy + fontSize / 2, swatchSize / 2, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = isHidden ? 'rgba(150,150,150,0.5)' : 'rgba(220,220,220,0.9)';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                ctx.fillText(items[i].name, colX + swatchSize + 6, iy + fontSize / 2);
                ctx.globalAlpha = 1.0;

                hitRects.push({
                    x: colX - 2, y: iy - 2,
                    w: items[i].w + 4, h: fontSize + 4,
                    name: items[i].name
                });
            }
        }

        return hitRects;
    }

    function drawTooltip(ctx, mx, plotArea, xLabels, xPositions, seriesData, seriesNames, seriesColors, hiddenSeries, yMin, yMax, yUnit, isDark) {
        var pa = plotArea;
        if (mx < pa.x || mx > pa.x + pa.w) return null;

        // Theme colors
        var pillBg = isDark ? 'rgba(50,55,80,0.92)' : 'rgba(55,65,100,0.9)';
        var pillText = '#fff';
        var tipBg = isDark ? 'rgba(30,33,45,0.95)' : 'rgba(255,255,255,0.96)';
        var tipBorder = isDark ? 'rgba(80,90,120,0.5)' : 'rgba(180,185,200,0.6)';
        var tipShadow = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)';
        var tipHeaderCol = isDark ? 'rgba(220,225,240,0.9)' : '#333';
        var tipNameCol = isDark ? 'rgba(180,185,200,0.85)' : '#555';
        var tipValCol = isDark ? 'rgba(240,242,255,0.95)' : '#222';
        var crosshairCol = isDark ? 'rgba(180,180,180,0.35)' : 'rgba(100,100,100,0.3)';

        var closestIdx = 0;
        var closestDist = Infinity;
        for (var i = 0; i < xPositions.length; i++) {
            var d = Math.abs(xPositions[i] - mx);
            if (d < closestDist) {
                closestDist = d;
                closestIdx = i;
            }
        }

        var snapX = xPositions[closestIdx];

        // Vertical crosshair line
        ctx.strokeStyle = crosshairCol;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(snapX, pa.y);
        ctx.lineTo(snapX, pa.y + pa.h);
        ctx.stroke();
        ctx.setLineDash([]);

        // Highlighted x-label
        var xlabel = xLabels[closestIdx] || '';
        ctx.font = 'bold 11px sans-serif';
        var xlw = ctx.measureText(xlabel).width;
        var xlPad = 6;
        var xlX = snapX;
        var xlY = pa.y + pa.h + 6;

        ctx.fillStyle = pillBg;
        ctx.beginPath();
        var rx = xlX - xlw / 2 - xlPad;
        var ry = xlY;
        var rw = xlw + xlPad * 2;
        var rh = 18;
        var rr = 3;
        ctx.moveTo(rx + rr, ry);
        ctx.lineTo(rx + rw - rr, ry);
        ctx.arcTo(rx + rw, ry, rx + rw, ry + rr, rr);
        ctx.lineTo(rx + rw, ry + rh - rr);
        ctx.arcTo(rx + rw, ry + rh, rx + rw - rr, ry + rh, rr);
        ctx.lineTo(rx + rr, ry + rh);
        ctx.arcTo(rx, ry + rh, rx, ry + rh - rr, rr);
        ctx.lineTo(rx, ry + rr);
        ctx.arcTo(rx, ry, rx + rr, ry, rr);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = pillText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(xlabel, xlX, xlY + 2);

        // Tooltip box
        var visibleSeries = [];
        for (var s = 0; s < seriesNames.length; s++) {
            if (!hiddenSeries[seriesNames[s]]) {
                var val = seriesData[s][closestIdx];
                if (val !== null && val !== undefined && !isNaN(val)) {
                    visibleSeries.push({ name: seriesNames[s], val: val, color: seriesColors[s] });
                }
            }
        }

        if (visibleSeries.length === 0) return closestIdx;

        // Y-axis crosshair for first visible series
        var firstVal = visibleSeries[0].val;
        var yRatio = (firstVal - yMin) / (yMax - yMin);
        var crosshairY = pa.y + pa.h - yRatio * pa.h;

        ctx.strokeStyle = crosshairCol;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, crosshairY);
        ctx.lineTo(pa.x + pa.w, crosshairY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Y-axis value label
        var yLabel = formatNumber(firstVal);
        if (yUnit) yLabel = yLabel + ' ' + yUnit;
        ctx.font = 'bold 11px monospace';
        var ylw = ctx.measureText(yLabel).width;
        ctx.fillStyle = pillBg;
        var ylX = pa.x - ylw - 14;
        var ylY = crosshairY - 9;
        ctx.fillRect(ylX, ylY, ylw + 10, 18);
        ctx.fillStyle = pillText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(yLabel, ylX + 5, crosshairY);

        // Tooltip box near cursor
        ctx.font = '12px sans-serif';
        var tipPad = 10;
        var lineH = 20;
        var tipH = 8 + lineH + visibleSeries.length * lineH + 4;
        var maxNameW = 0;
        var maxValW = 0;
        for (var i = 0; i < visibleSeries.length; i++) {
            var nw = ctx.measureText(visibleSeries[i].name).width;
            var vw = ctx.measureText(formatNumber(visibleSeries[i].val)).width;
            if (nw > maxNameW) maxNameW = nw;
            if (vw > maxValW) maxValW = vw;
        }
        var tipW = tipPad * 2 + 14 + maxNameW + 16 + maxValW;
        var headerW = ctx.measureText(xlabel).width + tipPad * 2;
        if (headerW > tipW) tipW = headerW;

        var tipX = snapX + 16;
        var tipY = pa.y + pa.h * 0.3;
        if (tipX + tipW > pa.x + pa.w) tipX = snapX - tipW - 16;

        // Background
        ctx.fillStyle = tipBg;
        ctx.shadowColor = tipShadow;
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        var tr = 4;
        ctx.moveTo(tipX + tr, tipY);
        ctx.lineTo(tipX + tipW - tr, tipY);
        ctx.arcTo(tipX + tipW, tipY, tipX + tipW, tipY + tr, tr);
        ctx.lineTo(tipX + tipW, tipY + tipH - tr);
        ctx.arcTo(tipX + tipW, tipY + tipH, tipX + tipW - tr, tipY + tipH, tr);
        ctx.lineTo(tipX + tr, tipY + tipH);
        ctx.arcTo(tipX, tipY + tipH, tipX, tipY + tipH - tr, tr);
        ctx.lineTo(tipX, tipY + tr);
        ctx.arcTo(tipX, tipY, tipX + tr, tipY, tr);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = tipBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Header
        ctx.fillStyle = tipHeaderCol;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(xlabel, tipX + tipPad, tipY + 8);

        // Series rows
        var rowY = tipY + 8 + lineH;
        ctx.font = '12px sans-serif';
        for (var i = 0; i < visibleSeries.length; i++) {
            var sv = visibleSeries[i];
            ctx.fillStyle = rgbaStr(sv.color, 1);
            ctx.beginPath();
            ctx.arc(tipX + tipPad + 5, rowY + 7, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = tipNameCol;
            ctx.textAlign = 'left';
            ctx.fillText(sv.name, tipX + tipPad + 16, rowY);

            ctx.fillStyle = tipValCol;
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(formatNumber(sv.val), tipX + tipW - tipPad, rowY);
            ctx.font = '12px sans-serif';

            rowY += lineH;
        }

        return closestIdx;
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('line-trend-chart-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
            this._hiddenSeries = {};
            this._legendHitRects = [];
            this._hoverX = -1;
            this._plotArea = null;
            this._xPositions = [];
            this._xLabels = [];
            this._seriesData = [];
            this._seriesNames = [];
            this._seriesColors = [];
            this._yMin = 0;
            this._yMax = 100;
            this._yUnit = '';
            this._showTooltip = true;

            // Zoom state
            this._zoomStart = 0;
            this._zoomEnd = -1; // -1 = show all
            this._dragStartX = -1;
            this._isDragging = false;
            this._dragCurrentX = -1;
            this._totalDataLen = 0;

            var self = this;

            this.canvas.addEventListener('mousemove', function(e) {
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;

                // Drag-to-zoom
                if (self._isDragging) {
                    self._dragCurrentX = mx;
                    self._drawFrame();
                    return;
                }

                // Check legend hits
                var overLegend = false;
                for (var i = 0; i < self._legendHitRects.length; i++) {
                    var hr = self._legendHitRects[i];
                    if (mx >= hr.x && mx <= hr.x + hr.w && my >= hr.y && my <= hr.y + hr.h) {
                        overLegend = true;
                        break;
                    }
                }

                var zr = self._zoomResetRect;
                var overZoomReset = zr && mx >= zr.x && mx <= zr.x + zr.w && my >= zr.y && my <= zr.y + zr.h;

                var pa = self._plotArea;
                var inPlot = pa && mx >= pa.x && mx <= pa.x + pa.w && my >= pa.y && my <= pa.y + pa.h;
                self.canvas.style.cursor = (overLegend || overZoomReset) ? 'pointer' : (inPlot ? 'crosshair' : 'default');

                if (self._showTooltip) {
                    self._hoverX = mx;
                    self._drawFrame();
                }
            });

            this.canvas.addEventListener('mouseleave', function() {
                self._hoverX = -1;
                self._isDragging = false;
                self.canvas.style.cursor = 'default';
                self._drawFrame();
            });

            this.canvas.addEventListener('mousedown', function(e) {
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                var pa = self._plotArea;
                if (!pa) return;

                // Only start drag inside plot area
                if (mx >= pa.x && mx <= pa.x + pa.w && my >= pa.y && my <= pa.y + pa.h) {
                    // Check not on legend
                    var onLegend = false;
                    for (var i = 0; i < self._legendHitRects.length; i++) {
                        var hr = self._legendHitRects[i];
                        if (mx >= hr.x && mx <= hr.x + hr.w && my >= hr.y && my <= hr.y + hr.h) {
                            onLegend = true; break;
                        }
                    }
                    if (!onLegend) {
                        self._isDragging = true;
                        self._dragStartX = mx;
                        self._dragCurrentX = mx;
                        e.preventDefault();
                    }
                }
            });

            this.canvas.addEventListener('mouseup', function(e) {
                if (!self._isDragging) return;
                self._isDragging = false;
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var pa = self._plotArea;
                var xPos = self._xPositions;
                if (!pa || !xPos || xPos.length < 2) return;

                var x1 = Math.min(self._dragStartX, mx);
                var x2 = Math.max(self._dragStartX, mx);

                // Minimum drag distance to trigger zoom
                if (x2 - x1 < 10) { self._drawFrame(); return; }

                // Find data indices for the selection
                var startIdx = 0;
                var endIdx = xPos.length - 1;
                for (var i = 0; i < xPos.length; i++) {
                    if (xPos[i] >= x1) { startIdx = i; break; }
                }
                for (var i = xPos.length - 1; i >= 0; i--) {
                    if (xPos[i] <= x2) { endIdx = i; break; }
                }
                if (endIdx <= startIdx) { self._drawFrame(); return; }

                // Apply zoom relative to current zoom
                self._zoomStart = self._zoomStart + startIdx;
                self._zoomEnd = self._zoomStart + (endIdx - startIdx);
                self._drawFrame();
            });

            this.canvas.addEventListener('dblclick', function() {
                self._zoomStart = 0;
                self._zoomEnd = -1;
                self._drawFrame();
            });

            this.canvas.addEventListener('wheel', function(e) {
                var pa = self._plotArea;
                if (!pa) return;
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                if (mx < pa.x || mx > pa.x + pa.w || my < pa.y || my > pa.y + pa.h) return;

                e.preventDefault();
                var totalLen = self._totalDataLen;
                if (totalLen < 3) return;

                var curStart = self._zoomStart;
                var curEnd = self._zoomEnd < 0 ? totalLen - 1 : self._zoomEnd;
                var visLen = curEnd - curStart + 1;

                // Mouse position ratio in current view
                var ratio = (mx - pa.x) / pa.w;

                var zoomStep = Math.max(1, Math.round(visLen * 0.15));
                if (e.deltaY < 0) {
                    // Zoom in
                    if (visLen <= 3) return;
                    var shrinkLeft = Math.round(zoomStep * ratio);
                    var shrinkRight = zoomStep - shrinkLeft;
                    curStart = Math.min(curStart + shrinkLeft, curEnd - 2);
                    curEnd = Math.max(curEnd - shrinkRight, curStart + 2);
                } else {
                    // Zoom out
                    curStart = Math.max(0, curStart - Math.round(zoomStep * ratio));
                    curEnd = Math.min(totalLen - 1, curEnd + Math.round(zoomStep * (1 - ratio)));
                }
                self._zoomStart = curStart;
                self._zoomEnd = curEnd;
                self._drawFrame();
            }, { passive: false });

            this.canvas.addEventListener('click', function(e) {
                if (self._isDragging) return;
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;

                // Zoom reset button
                var zr = self._zoomResetRect;
                if (zr && mx >= zr.x && mx <= zr.x + zr.w && my >= zr.y && my <= zr.y + zr.h) {
                    self._zoomStart = 0;
                    self._zoomEnd = -1;
                    self._drawFrame();
                    return;
                }

                for (var i = 0; i < self._legendHitRects.length; i++) {
                    var hr = self._legendHitRects[i];
                    if (mx >= hr.x && mx <= hr.x + hr.w && my >= hr.y && my <= hr.y + hr.h) {
                        if (self._hiddenSeries[hr.name]) {
                            delete self._hiddenSeries[hr.name];
                        } else {
                            self._hiddenSeries[hr.name] = true;
                        }
                        self._drawFrame();
                        break;
                    }
                }
            });
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data, config) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data \u2014 Line Trend Chart'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            var result = {
                colIdx: colIdx,
                fields: fields,
                rows: data.rows
            };

            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;

            // Read config
            this._title = config[ns + 'title'] || '';
            this._xField = config[ns + 'xField'] || '_time';
            this._xFormat = config[ns + 'xFormat'] || 'auto';
            this._zoneField = config[ns + 'zoneField'] || '';
            this._lineStyle = config[ns + 'lineStyle'] || 'smooth';
            this._showArea = (config[ns + 'showArea'] || 'false') === 'true';
            this._showPoints = (config[ns + 'showPoints'] || 'true') === 'true';
            this._showTooltip = (config[ns + 'showTooltip'] || 'true') === 'true';
            this._showLegend = (config[ns + 'showLegend'] || 'true') === 'true';
            this._legendPosition = config[ns + 'legendPosition'] || 'top';
            this._yUnit = config[ns + 'yUnit'] || '';
            this._maxY = parseInt(config[ns + 'maxY'] || '0', 10);
            this._minY = parseInt(config[ns + 'minY'] || '0', 10);
            this._areaOpacity = parseFloat(config[ns + 'areaOpacity'] || '0.15');
            this._lineWidth = parseInt(config[ns + 'lineWidth'] || '2', 10);
            this._lineDash = config[ns + 'lineDash'] || 'solid';
            this._pointSize = parseInt(config[ns + 'pointSize'] || '4', 10);
            this._pointShape = config[ns + 'pointShape'] || 'circle';
            this._pointFill = config[ns + 'pointFill'] || '';
            this._colorTheme = config[ns + 'colorTheme'] || 'warm';
            this._colorOverrides = parseColorOverrides(config[ns + 'colorOverrides'] || '');
            this._trendColorMode = config[ns + 'trendColorMode'] || 'off';
            var rcVal = (config[ns + 'risingColor'] || '').trim();
            var fcVal = (config[ns + 'fallingColor'] || '').trim();
            this._risingColor = (rcVal && rcVal !== '0') ? rcVal : '';
            this._fallingColor = (fcVal && fcVal !== '0') ? fcVal : '';
            this._zoneLineColor = config[ns + 'zoneLineColor'] || '';
            this._zoneColor = parseRgbaColor(config[ns + 'zoneColor'] || 'rgba(255,180,180,0.3)') || 'rgba(255,180,180,0.3)';
            this._zoneColorOverrides = {};

            var zcoStr = config[ns + 'zoneColorOverrides'] || '';
            if (zcoStr) {
                var zcoParts = zcoStr.split(',');
                for (var i = 0; i < zcoParts.length; i++) {
                    var kv = zcoParts[i].split(':');
                    if (kv.length >= 2) {
                        var zk = kv[0].trim();
                        var zv = kv.slice(1).join(':').trim();
                        if (zk && zv) this._zoneColorOverrides[zk] = parseRgbaColor(zv) || this._zoneColor;
                    }
                }
            }

            // Parse series fields
            var seriesFieldsStr = config[ns + 'seriesFields'] || '';
            var requestedFields = [];
            if (seriesFieldsStr) {
                var parts = seriesFieldsStr.split(',');
                for (var i = 0; i < parts.length; i++) {
                    var f = parts[i].trim();
                    if (f) requestedFields.push(f);
                }
            }

            // Extract data
            var colIdx = data.colIdx;
            var rows = data.rows;
            var fields = data.fields;
            var xIdx = colIdx[this._xField];
            var zoneIdx = this._zoneField ? colIdx[this._zoneField] : undefined;

            // Determine series columns
            var seriesCols = [];
            if (requestedFields.length > 0) {
                for (var i = 0; i < requestedFields.length; i++) {
                    if (colIdx[requestedFields[i]] !== undefined) {
                        seriesCols.push({ name: requestedFields[i], idx: colIdx[requestedFields[i]] });
                    }
                }
            } else {
                for (var i = 0; i < fields.length; i++) {
                    var fn = fields[i].name;
                    if (fn === this._xField) continue;
                    if (this._zoneField && fn === this._zoneField) continue;
                    var isNumeric = false;
                    for (var r = 0; r < Math.min(rows.length, 5); r++) {
                        if (!isNaN(parseFloat(rows[r][i]))) { isNumeric = true; break; }
                    }
                    if (isNumeric) seriesCols.push({ name: fn, idx: i });
                }
            }

            // Build arrays
            var xLabels = [];
            var zones = [];
            var seriesData = [];
            var seriesNames = [];
            for (var s = 0; s < seriesCols.length; s++) {
                seriesData.push([]);
                seriesNames.push(seriesCols[s].name);
            }

            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];
                xLabels.push(xIdx !== undefined ? (row[xIdx] || '') : '' + r);
                zones.push(zoneIdx !== undefined ? (row[zoneIdx] || '') : '');
                for (var s = 0; s < seriesCols.length; s++) {
                    var v = parseFloat(row[seriesCols[s].idx]);
                    seriesData[s].push(isNaN(v) ? 0 : v);
                }
            }

            // Store FULL unsliced data — zoom slicing happens in _drawFrame
            this._totalDataLen = xLabels.length;
            this._fullXLabels = xLabels;
            this._fullZones = zones;
            this._fullSeriesData = seriesData;
            this._seriesNames = seriesNames;

            // Series colors
            var seriesColors = [];
            for (var s = 0; s < seriesNames.length; s++) {
                seriesColors.push(getSeriesColor(seriesNames[s], s, this._colorTheme, this._colorOverrides));
            }
            this._seriesColors = seriesColors;

            // Size canvas
            var el = this.el;
            var rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this._dpr = dpr;
            this._w = rect.width;
            this._h = rect.height;

            this._drawFrame();
        },

        _drawFrame: function() {
            var canvas = this.canvas;
            var ctx = canvas.getContext('2d');
            if (!ctx) return;

            var dpr = this._dpr || 1;
            var w = this._w;
            var h = this._h;
            if (!w || !h) return;

            // Apply zoom slice on full data
            var fullX = this._fullXLabels || [];
            var fullZ = this._fullZones || [];
            var fullS = this._fullSeriesData || [];
            var zEnd = this._zoomEnd < 0 ? fullX.length - 1 : Math.min(this._zoomEnd, fullX.length - 1);
            var zStart = Math.min(this._zoomStart, zEnd);
            if (zStart > 0 || zEnd < fullX.length - 1) {
                this._xLabels = formatXLabels(fullX.slice(zStart, zEnd + 1), this._xFormat);
                this._zones = fullZ.slice(zStart, zEnd + 1);
                this._seriesData = [];
                for (var si = 0; si < fullS.length; si++) {
                    this._seriesData.push(fullS[si].slice(zStart, zEnd + 1));
                }
            } else {
                this._xLabels = formatXLabels(fullX, this._xFormat);
                this._zones = fullZ;
                this._seriesData = fullS;
            }

            // Recompute Y range for visible (zoomed) data
            var yMin = this._minY || 0;
            var yMax = this._maxY;
            if (yMax <= 0) {
                yMax = 0;
                for (var si = 0; si < this._seriesData.length; si++) {
                    if (this._hiddenSeries[this._seriesNames[si]]) continue;
                    for (var di = 0; di < this._seriesData[si].length; di++) {
                        if (this._seriesData[si][di] > yMax) yMax = this._seriesData[si][di];
                    }
                }
                var niceY = computeNiceSteps(yMin, yMax * 1.1);
                yMax = Math.ceil(yMax * 1.1 / niceY.stepSize) * niceY.stepSize;
                if (yMax === 0) yMax = 100;
            }
            this._yMin = yMin;
            this._yMax = yMax;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            // Theme-aware colors
            var isDark = true;
            try { isDark = SplunkVisualizationUtils.getCurrentTheme() !== 'light'; } catch (e) {}
            var textColor = isDark ? 'rgba(220,220,220,0.8)' : 'rgba(60,60,60,0.8)';
            var gridColor = isDark ? 'rgba(180,180,180,0.15)' : 'rgba(0,0,0,0.1)';

            // Smart grid steps
            var gridInfo = computeNiceSteps(yMin, yMax);
            var gridSteps = gridInfo.steps;

            // Layout — dynamic Y-axis label width
            var titleH = this._title ? 28 : 0;
            var legendH = 0;
            var legendW = 0;
            var legendPos = this._legendPosition;

            if (this._showLegend) {
                if (legendPos === 'top' || legendPos === 'bottom') legendH = 30;
                else legendW = 120;
            }

            var yLabelW = measureYLabelWidth(ctx, yMin, yMax, this._yUnit, gridSteps);
            var xLabelH = 30;
            var zoneHeaderH = this._zoneField ? 24 : 0;
            var topPad = titleH + (legendPos === 'top' ? legendH : 0) + zoneHeaderH + 10;
            var bottomPad = xLabelH + (legendPos === 'bottom' ? legendH : 0) + 10;
            var leftPad = yLabelW + (legendPos === 'left' ? legendW : 0) + 10;
            var rightPad = 20 + (legendPos === 'right' ? legendW : 0);

            var pa = {
                x: leftPad,
                y: topPad,
                w: w - leftPad - rightPad,
                h: h - topPad - bottomPad
            };
            if (pa.w <= 0 || pa.h <= 0) return;
            this._plotArea = pa;

            // X positions
            var n = this._xLabels.length;
            var xPositions = [];
            for (var i = 0; i < n; i++) {
                xPositions.push(pa.x + (n > 1 ? (i / (n - 1)) * pa.w : pa.w / 2));
            }
            this._xPositions = xPositions;

            // Draw title
            if (this._title) {
                ctx.font = 'bold 16px sans-serif';
                ctx.fillStyle = textColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(this._title, w / 2, 8);
            }

            // Draw zones
            drawZones(ctx, pa, this._zones, xPositions, this._zoneColor, this._zoneColorOverrides, textColor);

            // Draw grid
            drawGrid(ctx, pa, this._yMin, this._yMax, this._yUnit, gridSteps, textColor, gridColor);

            // Draw x labels
            drawXLabels(ctx, pa, this._xLabels, xPositions, textColor);

            // Plot border
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(pa.x, pa.y, pa.w, pa.h);

            // Draw series
            var smooth = this._lineStyle === 'smooth';
            for (var s = 0; s < this._seriesNames.length; s++) {
                if (this._hiddenSeries[this._seriesNames[s]]) continue;

                var pts = [];
                for (var i = 0; i < n; i++) {
                    var yRatio = (this._seriesData[s][i] - this._yMin) / (this._yMax - this._yMin);
                    pts.push({
                        x: xPositions[i],
                        y: pa.y + pa.h - yRatio * pa.h
                    });
                }

                var color = this._seriesColors[s];
                var colorStr = rgbaStr(color, 1);
                var zlc = this._zoneLineColor || '';
                var sValues = this._seriesData[s];
                var tOpts = { mode: this._trendColorMode, risingColor: this._risingColor, fallingColor: this._fallingColor };

                if (this._showArea) {
                    var areaAlpha = this._areaOpacity;
                    drawAreaFill(ctx, pts, pa.y + pa.h, rgbaStr(color, areaAlpha), smooth, this._zones, zlc, areaAlpha, sValues, tOpts);
                }

                drawLineSeries(ctx, pts, colorStr, this._lineWidth, smooth, this._zones, zlc, this._lineDash, sValues, tOpts);

                if (this._showPoints) {
                    drawPoints(ctx, pts, colorStr, this._pointSize, this._zones, zlc, this._pointShape, this._pointFill, sValues, tOpts);
                }
            }

            // Draw legend
            if (this._showLegend && this._seriesNames.length > 0) {
                this._legendHitRects = drawLegend(
                    ctx, this._seriesNames, this._seriesColors,
                    this._hiddenSeries, legendPos, pa, w, h
                );
            } else {
                this._legendHitRects = [];
            }

            // Draw drag selection overlay
            if (this._isDragging && this._dragStartX >= 0) {
                var dx1 = Math.max(pa.x, Math.min(this._dragStartX, this._dragCurrentX));
                var dx2 = Math.min(pa.x + pa.w, Math.max(this._dragStartX, this._dragCurrentX));
                ctx.fillStyle = 'rgba(88,166,255,0.15)';
                ctx.fillRect(dx1, pa.y, dx2 - dx1, pa.h);
                ctx.strokeStyle = 'rgba(88,166,255,0.6)';
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.strokeRect(dx1, pa.y, dx2 - dx1, pa.h);
            }

            // Draw tooltip
            if (this._showTooltip && this._hoverX >= 0 && !this._isDragging) {
                drawTooltip(
                    ctx, this._hoverX, pa,
                    this._xLabels, xPositions,
                    this._seriesData, this._seriesNames, this._seriesColors,
                    this._hiddenSeries, this._yMin, this._yMax, this._yUnit, isDark
                );
            }

            // Zoom reset button
            var isZoomed = this._zoomStart > 0 || (this._zoomEnd >= 0 && this._zoomEnd < this._totalDataLen - 1);
            this._zoomResetRect = null;
            if (isZoomed) {
                var zoomLabel = '\u2716  Reset Zoom';
                ctx.font = 'bold 10px sans-serif';
                var zlw = ctx.measureText(zoomLabel).width;
                var zbx = pa.x + pa.w - zlw - 18;
                var zby = pa.y + 6;
                var zbw = zlw + 14;
                var zbh = 20;
                // Button background
                ctx.fillStyle = 'rgba(88,166,255,0.2)';
                ctx.beginPath();
                ctx.moveTo(zbx + 3, zby);
                ctx.lineTo(zbx + zbw - 3, zby);
                ctx.arcTo(zbx + zbw, zby, zbx + zbw, zby + 3, 3);
                ctx.lineTo(zbx + zbw, zby + zbh - 3);
                ctx.arcTo(zbx + zbw, zby + zbh, zbx + zbw - 3, zby + zbh, 3);
                ctx.lineTo(zbx + 3, zby + zbh);
                ctx.arcTo(zbx, zby + zbh, zbx, zby + zbh - 3, 3);
                ctx.lineTo(zbx, zby + 3);
                ctx.arcTo(zbx, zby, zbx + 3, zby, 3);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = 'rgba(88,166,255,0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();
                // Label
                ctx.fillStyle = 'rgba(88,166,255,0.9)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(zoomLabel, zbx + zbw / 2, zby + zbh / 2);
                this._zoomResetRect = { x: zbx, y: zby, w: zbw, h: zbh };
            }
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
