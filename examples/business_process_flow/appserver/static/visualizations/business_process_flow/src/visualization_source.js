/*
 * Business Process Flow — Splunk Custom Visualization
 *
 * Renders an interactive business process flow diagram from stats/table
 * or timechart data. Supports configurable node shapes, sparklines,
 * connections, and an editor mode for manual layout adjustments.
 *
 * Expected SPL formats:
 *   Format A (stats): sourcetype, count, step, connects_to
 *   Format B (timechart): _time, series1, series2, ...
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    // ── Color Palettes ────────────────────────────────────────────

    var PALETTES = {
        corporate: ['#3b82f6','#6366f1','#8b5cf6','#0ea5e9','#06b6d4','#14b8a6','#64748b','#475569'],
        security:  ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#8b5cf6','#ec4899','#64748b'],
        nature:    ['#059669','#16a34a','#65a30d','#ca8a04','#d97706','#0d9488','#78716c','#57534e'],
        neon:      ['#00ff88','#00d4ff','#bf5af2','#ff375f','#ffd60a','#ff9f0a','#30d158','#5e5ce6'],
        mono:      ['#f8fafc','#e2e8f0','#94a3b8','#64748b','#475569','#334155','#1e293b','#0f172a']
    };

    // ── Pure Helper Functions ─────────────────────────────────────

    /**
     * Format large numbers: 1234 -> "1.2K", 1234567 -> "1.2M"
     */
    function formatCount(n) {
        if (n === null || n === undefined || isNaN(n)) return '0';
        n = Number(n);
        if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 10000) return (n / 1000).toFixed(0) + 'K';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(Math.round(n));
    }

    /**
     * Evaluate conditional formatting rules against a value.
     * Returns the color of the first matching rule, or null if no match.
     * Rules: [{ op: '<=', val: '10', color: '#22c55e' }, ...]
     * Operators: <, <=, >, >=, =, !=, contains
     */
    function evalConditions(conditions, rawValue) {
        if (!conditions || conditions.length === 0) return null;
        var numVal = parseFloat(rawValue);
        var strVal = String(rawValue !== null && rawValue !== undefined ? rawValue : '').toLowerCase();

        for (var ci = 0; ci < conditions.length; ci++) {
            var rule = conditions[ci];
            if (!rule.op || !rule.color) continue;
            var ruleVal = String(rule.val || '');
            var ruleNum = parseFloat(ruleVal);
            var ruleStr = ruleVal.toLowerCase();
            var match = false;

            if (rule.op === '<' && !isNaN(numVal) && !isNaN(ruleNum)) {
                match = numVal < ruleNum;
            } else if (rule.op === '<=' && !isNaN(numVal) && !isNaN(ruleNum)) {
                match = numVal <= ruleNum;
            } else if (rule.op === '>' && !isNaN(numVal) && !isNaN(ruleNum)) {
                match = numVal > ruleNum;
            } else if (rule.op === '>=' && !isNaN(numVal) && !isNaN(ruleNum)) {
                match = numVal >= ruleNum;
            } else if (rule.op === '=') {
                match = (!isNaN(numVal) && !isNaN(ruleNum)) ? numVal === ruleNum : strVal === ruleStr;
            } else if (rule.op === '!=') {
                match = (!isNaN(numVal) && !isNaN(ruleNum)) ? numVal !== ruleNum : strVal !== ruleStr;
            } else if (rule.op === 'contains') {
                match = strVal.indexOf(ruleStr) !== -1;
            }

            if (match) return rule.color;
        }
        return null;
    }

    /**
     * Convert hex to rgba string.
     */
    function hexToRgba(hex, alpha) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha !== undefined ? alpha : 1) + ')';
    }

    /**
     * Lighten a hex color by a fraction (0–1). Returns hex string.
     */
    function lightenColor(hex, amount) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        r = Math.min(255, Math.round(r + (255 - r) * amount));
        g = Math.min(255, Math.round(g + (255 - g) * amount));
        b = Math.min(255, Math.round(b + (255 - b) * amount));
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    /**
     * Darken a hex color by a fraction (0–1). Returns hex string.
     */
    function darkenColor(hex, amount) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        r = Math.max(0, Math.round(r * (1 - amount)));
        g = Math.max(0, Math.round(g * (1 - amount)));
        b = Math.max(0, Math.round(b * (1 - amount)));
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    /**
     * Check if a hex color is dark (luminance < 0.5).
     */
    function isColorDark(hex) {
        var norm = normalizeToHex(hex);
        var r = parseInt(norm.slice(1, 3), 16);
        var g = parseInt(norm.slice(3, 5), 16);
        var b = parseInt(norm.slice(5, 7), 16);
        var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.5;
    }

    /**
     * Normalize a color value to a 7-char hex string.
     * Handles hex (#abc, #aabbcc), rgb(), rgba(), and named colors via canvas fallback.
     */
    function normalizeToHex(color) {
        if (!color) return '#3b82f6';
        var s = String(color).trim();
        // Already 7-char hex
        if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
        // 4-char shorthand hex
        if (/^#[0-9a-fA-F]{3}$/.test(s)) {
            return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
        }
        // rgb()/rgba() — extract numeric components
        var rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgbMatch) {
            var rr = Math.min(255, parseInt(rgbMatch[1], 10));
            var gg = Math.min(255, parseInt(rgbMatch[2], 10));
            var bb = Math.min(255, parseInt(rgbMatch[3], 10));
            return '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1);
        }
        // Fallback: use a temporary canvas to resolve named/any CSS color
        try {
            var tc = document.createElement('canvas');
            tc.width = 1; tc.height = 1;
            var tctx = tc.getContext('2d');
            tctx.fillStyle = s;
            tctx.fillRect(0, 0, 1, 1);
            var d = tctx.getImageData(0, 0, 1, 1).data;
            return '#' + ((1 << 24) + (d[0] << 16) + (d[1] << 8) + d[2]).toString(16).slice(1);
        } catch (e) {
            return '#3b82f6';
        }
    }

    /**
     * Check if array contains a value (ES5-safe).
     */
    function arrContains(arr, val) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] === val) return true;
        }
        return false;
    }

    /**
     * Return new array with val removed (ES5-safe).
     */
    function arrRemove(arr, val) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] !== val) out.push(arr[i]);
        }
        return out;
    }

    /**
     * Stroke pattern lookup and helper.
     */
    var STROKE_PATTERNS = {
        solid: [],
        dashed: [8, 4],
        dotted: [2, 3],
        'dash-dot': [8, 4, 2, 4],
        'long-dash': [16, 6]
    };
    /**
     * Rounded rectangle path (does not fill or stroke).
     */
    function roundRect(ctx, x, y, w, h, r) {
        if (r > h / 2) r = h / 2;
        if (r > w / 2) r = w / 2;
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

    /**
     * Parse a markdown string into an array of line descriptor objects.
     * Supports: ## heading, - bullet, blank lines, plain text.
     */
    function parseMarkdown(text) {
        if (!text) return [];
        var lines = text.split('\n');
        var result = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('## ') === 0) {
                result.push({ type: 'heading', text: line.substring(3) });
            } else if (line.indexOf('- ') === 0) {
                result.push({ type: 'bullet', text: line.substring(2) });
            } else if (line.trim() === '') {
                result.push({ type: 'blank' });
            } else {
                result.push({ type: 'text', text: line });
            }
        }
        return result;
    }

    /**
     * Split a text line into bold/italic/normal segments.
     * Returns array of { text, bold, italic }.
     */
    function parseInlineMarkdown(text) {
        var segments = [];
        var remaining = text;
        while (remaining.length > 0) {
            var boldIdx = remaining.indexOf('**');
            var italicIdx = remaining.indexOf('*');
            // Determine which marker comes first
            if (boldIdx !== -1 && (italicIdx === boldIdx || boldIdx < italicIdx)) {
                // Bold segment
                if (boldIdx > 0) {
                    segments.push({ text: remaining.substring(0, boldIdx), bold: false, italic: false });
                }
                var endBold = remaining.indexOf('**', boldIdx + 2);
                if (endBold !== -1) {
                    segments.push({ text: remaining.substring(boldIdx + 2, endBold), bold: true, italic: false });
                    remaining = remaining.substring(endBold + 2);
                } else {
                    segments.push({ text: remaining.substring(boldIdx), bold: false, italic: false });
                    remaining = '';
                }
            } else if (italicIdx !== -1) {
                // Italic segment
                if (italicIdx > 0) {
                    segments.push({ text: remaining.substring(0, italicIdx), bold: false, italic: false });
                }
                var endItalic = remaining.indexOf('*', italicIdx + 1);
                if (endItalic !== -1) {
                    segments.push({ text: remaining.substring(italicIdx + 1, endItalic), bold: false, italic: true });
                    remaining = remaining.substring(endItalic + 1);
                } else {
                    segments.push({ text: remaining.substring(italicIdx), bold: false, italic: false });
                    remaining = '';
                }
            } else {
                segments.push({ text: remaining, bold: false, italic: false });
                remaining = '';
            }
        }
        return segments;
    }

    function drawHexagonPath(ctx, x, y, w, h) {
        var cx = x + w / 2, cy = y + h / 2;
        var rx = w / 2, ry = h / 2;
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
            var angle = (Math.PI / 3) * i - Math.PI / 2;
            var px = cx + rx * Math.cos(angle);
            var py = cy + ry * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    function drawTrianglePath(ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
    }

    function drawCylinderPath(ctx, x, y, w, h) {
        var ellH = Math.min(h * 0.15, 20);
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + ellH, w / 2, ellH, 0, Math.PI, 0);
        ctx.lineTo(x + w, y + h - ellH);
        ctx.ellipse(x + w / 2, y + h - ellH, w / 2, ellH, 0, 0, Math.PI);
        ctx.closePath();
    }

    function drawCloudPath(ctx, x, y, w, h) {
        ctx.beginPath();
        // Bottom center start
        ctx.moveTo(x + w * 0.2, y + h * 0.75);
        // Left bump
        ctx.bezierCurveTo(x + w * 0.05, y + h * 0.75, x, y + h * 0.5, x + w * 0.15, y + h * 0.4);
        // Top-left bump
        ctx.bezierCurveTo(x + w * 0.1, y + h * 0.15, x + w * 0.3, y + h * 0.05, x + w * 0.45, y + h * 0.15);
        // Top-right bump
        ctx.bezierCurveTo(x + w * 0.55, y, x + w * 0.75, y + h * 0.05, x + w * 0.82, y + h * 0.25);
        // Right bump
        ctx.bezierCurveTo(x + w, y + h * 0.25, x + w * 1.02, y + h * 0.55, x + w * 0.85, y + h * 0.7);
        // Bottom right
        ctx.bezierCurveTo(x + w * 0.78, y + h * 0.85, x + w * 0.65, y + h * 0.85, x + w * 0.55, y + h * 0.8);
        // Bottom left
        ctx.bezierCurveTo(x + w * 0.4, y + h * 0.9, x + w * 0.25, y + h * 0.85, x + w * 0.2, y + h * 0.75);
        ctx.closePath();
    }

    function drawPillPath(ctx, x, y, w, h) {
        var r = Math.min(h / 2, w / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(x + r, y + h);
        ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
    }
    /**
     * Draw a connection endpoint shape at a point with given angle.
     * Types: none, filledArrow, openArrow, filledBall, ball, filledDiamond, diamond, bar
     */
    function drawEndpoint(ctx, x, y, angle, type, size, color) {
        if (!type || type === 'none') return;
        var s = size || 8;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        if (type === 'filledArrow') {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s, -s * 0.5);
            ctx.lineTo(-s, s * 0.5);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        } else if (type === 'openArrow') {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s, -s * 0.5);
            ctx.lineTo(-s, s * 0.5);
            ctx.closePath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else if (type === 'filledBall') {
            ctx.beginPath();
            ctx.arc(-s * 0.4, 0, s * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        } else if (type === 'ball') {
            ctx.beginPath();
            ctx.arc(-s * 0.4, 0, s * 0.35, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else if (type === 'filledDiamond') {
            var ds = s * 0.45;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-ds, -ds);
            ctx.lineTo(-ds * 2, 0);
            ctx.lineTo(-ds, ds);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        } else if (type === 'diamond') {
            var ds2 = s * 0.45;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-ds2, -ds2);
            ctx.lineTo(-ds2 * 2, 0);
            ctx.lineTo(-ds2, ds2);
            ctx.closePath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else if (type === 'bar') {
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.5);
            ctx.lineTo(0, s * 0.5);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Truncate text with ellipsis.
     */
    function truncateText(text, maxLen) {
        var limit = (maxLen !== undefined && maxLen !== null) ? maxLen : 20;
        if (!text) return '';
        var s = String(text);
        if (s.length <= limit) return s;
        return s.slice(0, limit - 1) + '\u2026';
    }

    /**
     * Draw value text auto-sized to fit within maxWidth.
     * Shrinks font until it fits. Never truncates.
     */
    function drawFitText(ctx, text, cx, cy, maxW, startSize, fontFamily) {
        var size = startSize;
        ctx.font = 'bold ' + size + 'px ' + fontFamily;
        while (ctx.measureText(text).width > maxW && size > 8) {
            size--;
            ctx.font = 'bold ' + size + 'px ' + fontFamily;
        }
        ctx.fillText(text, cx, cy);
        return size;
    }

    // ── Hit Testing ───────────────────────────────────────────────

    function pointInRect(px, py, x, y, w, h) {
        return px >= x && px <= x + w && py >= y && py <= y + h;
    }

    function pointInCircle(px, py, cx, cy, r) {
        var dx = px - cx;
        var dy = py - cy;
        return dx * dx + dy * dy <= r * r;
    }

    function pointInDiamond(px, py, cx, cy, w, h) {
        var hw = w / 2;
        var hh = h / 2;
        var nx = Math.abs(px - cx) / hw;
        var ny = Math.abs(py - cy) / hh;
        return nx + ny <= 1;
    }
    // Returns the minimum distance from point (px,py) to the segment (x1,y1)-(x2,y2)
    function distToLine(px, py, x1, y1, x2, y2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        var lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
        var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
        var projX = x1 + t * dx;
        var projY = y1 + t * dy;
        return Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
    }
    /**
     * Get the actual start/end points for a connection, matching drawConnection logic.
     * Returns { points: [{x,y},...], startPt: {x,y}, endPt: {x,y} }
     */
    function getConnectionPoints(conn, fromNode, toNode) {
        var fromCx = fromNode.x + fromNode.w / 2;
        var fromCy = fromNode.y + fromNode.h / 2;
        var toCx = toNode.x + toNode.w / 2;
        var toCy = toNode.y + toNode.h / 2;

        var srcAnchor = conn.sourceAnchor || 'auto';
        var tgtAnchor = conn.targetAnchor || 'auto';
        var srcOff = parseInt(conn.sourceAnchorOffset, 10) || 0;
        var tgtOff = parseInt(conn.targetAnchorOffset, 10) || 0;
        var startPt, endPt;
        if (srcAnchor !== 'auto') {
            startPt = getAnchorPoint(fromNode, srcAnchor, srcOff);
        } else {
            startPt = getEdgeConnectionPoint(fromNode, toCx, toCy);
        }
        if (tgtAnchor !== 'auto') {
            endPt = getAnchorPoint(toNode, tgtAnchor, tgtOff);
        } else {
            endPt = getEdgeConnectionPoint(toNode, fromCx, fromCy);
        }

        var waypoints = conn.waypoints || [];
        var points = [startPt];
        for (var wpi = 0; wpi < waypoints.length; wpi++) {
            points.push({ x: waypoints[wpi].x, y: waypoints[wpi].y });
        }
        points.push(endPt);

        return { points: points, startPt: startPt, endPt: endPt };
    }

    /**
     * Compute minimum distance from point (px,py) to a connection path.
     * Handles straight polylines and curved connections with waypoints.
     * Also returns the closest segment index for waypoint insertion.
     */
    function distToConnection(px, py, conn, fromNode, toNode) {
        var cp = getConnectionPoints(conn, fromNode, toNode);
        var points = cp.points;
        var minDist = Infinity;
        var closestSeg = -1;

        if (conn.style === 'curved' && points.length === 2) {
            // Simple curve (no waypoints): quadratic bezier — matches drawConnection
            var sx = cp.startPt.x, sy = cp.startPt.y;
            var ex = cp.endPt.x, ey = cp.endPt.y;
            var bmx = (sx + ex) / 2, bmy = (sy + ey) / 2;
            var bdx = ex - sx, bdy = ey - sy;
            var blen = Math.sqrt(bdx * bdx + bdy * bdy);
            var boff = Math.min(40, blen * 0.2);
            var bnx = blen > 0 ? -bdy / blen : 0;
            var bny = blen > 0 ? bdx / blen : 0;
            var bcpx = bmx + bnx * boff, bcpy = bmy + bny * boff;
            var prevX = sx, prevY = sy;
            for (var bi = 1; bi <= 20; bi++) {
                var bt = bi / 20;
                var bpx = (1 - bt) * (1 - bt) * sx + 2 * (1 - bt) * bt * bcpx + bt * bt * ex;
                var bpy = (1 - bt) * (1 - bt) * sy + 2 * (1 - bt) * bt * bcpy + bt * bt * ey;
                var segDist = distToLine(px, py, prevX, prevY, bpx, bpy);
                if (segDist < minDist) {
                    minDist = segDist;
                    closestSeg = 0;
                }
                prevX = bpx;
                prevY = bpy;
            }
        } else if (conn.style === 'curved' && points.length > 2) {
            // Multi-point smooth curve — matches drawConnection quadratic bezier through waypoints
            // Sample the curve to get line segments for distance testing
            var segIdx = 0;
            for (var cpi = 1; cpi < points.length - 1; cpi++) {
                var p0x = (cpi === 1) ? points[0].x : (points[cpi - 1].x + points[cpi].x) / 2;
                var p0y = (cpi === 1) ? points[0].y : (points[cpi - 1].y + points[cpi].y) / 2;
                var cpx2 = points[cpi].x;
                var cpy2 = points[cpi].y;
                var p2x = (cpi < points.length - 2) ? (points[cpi].x + points[cpi + 1].x) / 2 : points[points.length - 1].x;
                var p2y = (cpi < points.length - 2) ? (points[cpi].y + points[cpi + 1].y) / 2 : points[points.length - 1].y;
                var prevCx = p0x, prevCy = p0y;
                for (var si = 1; si <= 10; si++) {
                    var ct = si / 10;
                    var cit = 1 - ct;
                    var cx = cit * cit * p0x + 2 * cit * ct * cpx2 + ct * ct * p2x;
                    var cy = cit * cit * p0y + 2 * cit * ct * cpy2 + ct * ct * p2y;
                    var csd = distToLine(px, py, prevCx, prevCy, cx, cy);
                    if (csd < minDist) {
                        minDist = csd;
                        closestSeg = cpi - 1;
                    }
                    prevCx = cx;
                    prevCy = cy;
                }
            }
            // Also test the first straight segment (start to first midpoint) if needed
            if (points.length === 3) {
                // Already handled above
            }
        } else {
            // Straight polyline — test each segment
            for (var si2 = 0; si2 < points.length - 1; si2++) {
                var sd = distToLine(px, py, points[si2].x, points[si2].y, points[si2 + 1].x, points[si2 + 1].y);
                if (sd < minDist) {
                    minDist = sd;
                    closestSeg = si2;
                }
            }
        }

        return { dist: minDist, segment: closestSeg };
    }

    /**
     * Get the point where a line from inside a node exits the node boundary.
     * node must have: x, y, w, h, shape
     */
    function getEdgeConnectionPoint(node, targetX, targetY) {
        var cx = node.x + node.w / 2;
        var cy = node.y + node.h / 2;
        var shape = node.shape || 'rect';

        if (shape === 'circle') {
            var r = Math.min(node.w, node.h) / 2;
            var dx = targetX - cx;
            var dy = targetY - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist === 0) return { x: cx, y: cy };
            return { x: cx + (dx / dist) * r, y: cy + (dy / dist) * r };
        }

        if (shape === 'diamond') {
            var hw = node.w / 2;
            var hh = node.h / 2;
            var ddx = targetX - cx;
            var ddy = targetY - cy;
            if (ddx === 0 && ddy === 0) return { x: cx, y: cy };
            var adx = Math.abs(ddx);
            var ady = Math.abs(ddy);
            var scale = 1 / (adx / hw + ady / hh);
            return { x: cx + ddx * scale, y: cy + ddy * scale };
        }

        // rect: find intersection with edges
        var hw2 = node.w / 2;
        var hh2 = node.h / 2;
        var dx2 = targetX - cx;
        var dy2 = targetY - cy;
        if (dx2 === 0 && dy2 === 0) return { x: cx, y: cy };

        var absDx = Math.abs(dx2);
        var absDy = Math.abs(dy2);
        var sx, sy;

        if (absDx * hh2 > absDy * hw2) {
            // exits left or right
            sx = dx2 > 0 ? 1 : -1;
            sy = dy2 * (hw2 / absDx);
            return { x: cx + sx * hw2, y: cy + sy };
        } else {
            // exits top or bottom
            sy = dy2 > 0 ? 1 : -1;
            sx = dx2 * (hh2 / absDy);
            return { x: cx + sx, y: cy + sy * hh2 };
        }
    }

    // ── Theme Colors ──────────────────────────────────────────────

    function getThemeColors(isDark) {
        return {
            bg:            isDark ? '#0f172a' : '#ffffff',
            nodeBg:        isDark ? '#1e293b' : '#f1f5f9',
            nodeBorder:    isDark ? '#334155' : '#e2e8f0',
            text:          isDark ? '#f1f5f9' : '#1e293b',
            textMuted:     isDark ? '#94a3b8' : '#64748b',
            lineBg:        isDark ? '#475569' : '#94a3b8',
            toolbarBg:     isDark ? '#1e293b' : '#f8fafc',
            toolbarBorder: isDark ? '#334155' : '#e2e8f0'
        };
    }

    // ── Grid Drawing ──────────────────────────────────────────────

    function drawGrid(ctx, w, h, gridSize, panX, panY, isDark) {
        var dotColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        var gs = gridSize;
        ctx.fillStyle = dotColor;
        var gStartX = Math.floor(-panX / gs) * gs;
        var gStartY = Math.floor(-panY / gs) * gs;
        var gEndX = gStartX + w + gs;
        var gEndY = gStartY + h + gs;
        for (var gx = gStartX; gx < gEndX; gx += gs) {
            for (var gy = gStartY; gy < gEndY; gy += gs) {
                ctx.beginPath();
                ctx.arc(gx, gy, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ── Align & Distribute ────────────────────────────────────────

    function alignNodes(editorState, nodeIds, computedNodes, direction) {
        if (nodeIds.length < 2) return;
        var positions = [];
        for (var i = 0; i < nodeIds.length; i++) {
            var cn = computedNodes[nodeIds[i]];
            if (cn) positions.push({ id: nodeIds[i], x: cn.x, y: cn.y, w: cn.w, h: cn.h });
        }
        if (positions.length < 2) return;

        var target;
        if (direction === 'left') {
            target = positions[0].x;
            for (var a = 1; a < positions.length; a++) { if (positions[a].x < target) target = positions[a].x; }
            for (var b = 0; b < positions.length; b++) {
                if (!editorState.nodes[positions[b].id]) editorState.nodes[positions[b].id] = {};
                editorState.nodes[positions[b].id].x = target;
            }
        } else if (direction === 'center') {
            var sum = 0;
            for (var c = 0; c < positions.length; c++) sum += positions[c].x + positions[c].w / 2;
            var avg = sum / positions.length;
            for (var d = 0; d < positions.length; d++) {
                if (!editorState.nodes[positions[d].id]) editorState.nodes[positions[d].id] = {};
                editorState.nodes[positions[d].id].x = avg - positions[d].w / 2;
            }
        } else if (direction === 'right') {
            target = positions[0].x + positions[0].w;
            for (var e2 = 1; e2 < positions.length; e2++) { var r = positions[e2].x + positions[e2].w; if (r > target) target = r; }
            for (var f = 0; f < positions.length; f++) {
                if (!editorState.nodes[positions[f].id]) editorState.nodes[positions[f].id] = {};
                editorState.nodes[positions[f].id].x = target - positions[f].w;
            }
        } else if (direction === 'top') {
            target = positions[0].y;
            for (var g = 1; g < positions.length; g++) { if (positions[g].y < target) target = positions[g].y; }
            for (var h2 = 0; h2 < positions.length; h2++) {
                if (!editorState.nodes[positions[h2].id]) editorState.nodes[positions[h2].id] = {};
                editorState.nodes[positions[h2].id].y = target;
            }
        } else if (direction === 'middle') {
            var sumY = 0;
            for (var j = 0; j < positions.length; j++) sumY += positions[j].y + positions[j].h / 2;
            var avgY = sumY / positions.length;
            for (var k = 0; k < positions.length; k++) {
                if (!editorState.nodes[positions[k].id]) editorState.nodes[positions[k].id] = {};
                editorState.nodes[positions[k].id].y = avgY - positions[k].h / 2;
            }
        } else if (direction === 'bottom') {
            target = positions[0].y + positions[0].h;
            for (var m = 1; m < positions.length; m++) { var b2 = positions[m].y + positions[m].h; if (b2 > target) target = b2; }
            for (var n2 = 0; n2 < positions.length; n2++) {
                if (!editorState.nodes[positions[n2].id]) editorState.nodes[positions[n2].id] = {};
                editorState.nodes[positions[n2].id].y = target - positions[n2].h;
            }
        }
    }

    function distributeNodes(editorState, nodeIds, computedNodes, axis) {
        if (nodeIds.length < 3) return;
        var positions = [];
        for (var i = 0; i < nodeIds.length; i++) {
            var cn = computedNodes[nodeIds[i]];
            if (cn) positions.push({ id: nodeIds[i], x: cn.x, y: cn.y, w: cn.w, h: cn.h });
        }
        if (positions.length < 3) return;

        if (axis === 'horizontal') {
            positions.sort(function(a, b) { return a.x - b.x; });
            var first = positions[0].x;
            var last = positions[positions.length - 1].x;
            var spacing = (last - first) / (positions.length - 1);
            for (var j = 1; j < positions.length - 1; j++) {
                if (!editorState.nodes[positions[j].id]) editorState.nodes[positions[j].id] = {};
                editorState.nodes[positions[j].id].x = first + spacing * j;
            }
        } else {
            positions.sort(function(a, b) { return a.y - b.y; });
            var firstY = positions[0].y;
            var lastY = positions[positions.length - 1].y;
            var spacingY = (lastY - firstY) / (positions.length - 1);
            for (var k = 1; k < positions.length - 1; k++) {
                if (!editorState.nodes[positions[k].id]) editorState.nodes[positions[k].id] = {};
                editorState.nodes[positions[k].id].y = firstY + spacingY * k;
            }
        }
    }

    // ── Node Positioning ──────────────────────────────────────────

    function computeNodePositions(nodes, editorState, w, h, toolbarH) {
        var defaultW = 180;
        var defaultH = 120;
        var padX = 60;
        var padY = 40;
        var drawH = h - toolbarH;
        var result = [];
        var nodeEditorMap = (editorState && editorState.nodes) ? editorState.nodes : {};

        // Separate nodes with saved positions from those needing auto-layout
        var autoNodes = [];
        for (var i = 0; i < nodes.length; i++) {
            var nd = nodes[i];
            var edState = nodeEditorMap[nd.id];
            var nw = (edState && edState.w) ? edState.w : defaultW;
            var nh = (edState && edState.h) ? edState.h : defaultH;
            var shape = (edState && edState.shape) ? edState.shape : 'rect';
            var colorOverride = (edState && edState.color) ? edState.color : null;
            var hideValue = (edState && edState.hideValue) ? true : false;
            var labelOverride = (edState && edState.label) ? edState.label : null;
            // Per-node overrides
            var perNode = {
                sparklineType: edState ? edState.sparklineType : undefined,
                fontSize: edState ? edState.fontSize : undefined,
                chartHeight: edState ? edState.chartHeight : undefined,
                opacity: edState ? edState.opacity : undefined,
                borderWidth: edState ? edState.borderWidth : undefined,
                strokePattern: edState ? edState.strokePattern : undefined,
                borderRadius: edState ? edState.borderRadius : undefined,
                bgColor: edState ? edState.bgColor : undefined,
                borderColor: edState ? edState.borderColor : undefined,
                strokeDash: edState ? edState.strokeDash : undefined,
                strokeGap: edState ? edState.strokeGap : undefined
            };

            var baseObj = {
                id: nd.id,
                label: labelOverride || nd.label,
                value: nd.value,
                subtitle: nd.subtitle || '',
                w: nw,
                h: nh,
                shape: shape,
                color: colorOverride || nd.color || '#3b82f6',
                series: nd.series || [],
                connectsTo: nd.connectsTo || [],
                step: nd.step,
                rowIndex: nd.rowIndex,
                hideValue: hideValue,
                sparklineType: perNode.sparklineType,
                fontSize: perNode.fontSize,
                chartHeight: perNode.chartHeight,
                opacity: perNode.opacity,
                borderWidth: perNode.borderWidth,
                strokePattern: perNode.strokePattern,
                borderRadius: perNode.borderRadius,
                bgColor: perNode.bgColor,
                borderColor: perNode.borderColor,
                strokeDash: perNode.strokeDash,
                strokeGap: perNode.strokeGap,
                prefix: edState ? edState.prefix : undefined,
                suffix: edState ? edState.suffix : undefined,
                sparkPosition: edState ? edState.sparkPosition : undefined,
                conditions: edState ? edState.conditions : undefined,
                rawValue: edState ? edState.rawValue : undefined,
                textAlign: edState ? edState.textAlign : undefined,
                verticalAlign: edState ? edState.verticalAlign : undefined,
                labelColor: edState ? edState.labelColor : undefined,
                valueColor: edState ? edState.valueColor : undefined,
                padding: edState ? edState.padding : undefined,
                customPadding: edState ? edState.customPadding : undefined,
                customFontSize: edState ? edState.customFontSize : undefined,
                customChartHeight: edState ? edState.customChartHeight : undefined,
                markdownContent: edState ? edState.markdownContent : undefined,
                trendDisplay: edState ? edState.trendDisplay : undefined,
                trendUpColor: edState ? edState.trendUpColor : undefined,
                trendDownColor: edState ? edState.trendDownColor : undefined,
                trendCompareBack: edState ? edState.trendCompareBack : undefined,
                sparkHover: edState ? edState.sparkHover : undefined,
                conditionTarget: edState ? edState.conditionTarget : undefined,
                // Effects
                shadowEnabled: edState ? edState.shadowEnabled : undefined,
                shadowBlur: edState ? edState.shadowBlur : undefined,
                shadowOffsetX: edState ? edState.shadowOffsetX : undefined,
                shadowOffsetY: edState ? edState.shadowOffsetY : undefined,
                shadowColor: edState ? edState.shadowColor : undefined,
                glowEnabled: edState ? edState.glowEnabled : undefined,
                glowBlur: edState ? edState.glowBlur : undefined,
                glowColor: edState ? edState.glowColor : undefined,
                innerShadow: edState ? edState.innerShadow : undefined,
                gradientFill: edState ? edState.gradientFill : undefined,
                gradientDirection: edState ? edState.gradientDirection : undefined,
                gradientStart: edState ? edState.gradientStart : undefined,
                gradientEnd: edState ? edState.gradientEnd : undefined,
                zOrder: edState ? edState.zOrder : undefined,
                frostedGlass: edState ? edState.frostedGlass : undefined
            };

            if (edState && edState.x !== undefined && edState.y !== undefined) {
                baseObj.x = edState.x;
                baseObj.y = edState.y;
                result.push(baseObj);
            } else {
                autoNodes.push(baseObj);
            }
        }

        if (autoNodes.length === 0) return result;

        // Group auto nodes by step
        var stepGroups = {};
        var noStepNodes = [];
        var stepValues = [];

        for (var j = 0; j < autoNodes.length; j++) {
            var an = autoNodes[j];
            if (an.step !== null && an.step !== undefined && an.step !== '') {
                var sv = Number(an.step);
                if (!isNaN(sv)) {
                    if (!stepGroups[sv]) {
                        stepGroups[sv] = [];
                        stepValues.push(sv);
                    }
                    stepGroups[sv].push(an);
                } else {
                    noStepNodes.push(an);
                }
            } else {
                noStepNodes.push(an);
            }
        }

        stepValues.sort(function(a, b) { return a - b; });

        if (stepValues.length > 0) {
            // Distribute step groups horizontally
            var numCols = stepValues.length;
            var colWidth = (w - padX * 2) / numCols;

            for (var si = 0; si < stepValues.length; si++) {
                var group = stepGroups[stepValues[si]];
                var colCenterX = padX + si * colWidth + colWidth / 2;
                var totalGroupH = group.length * (defaultH + padY) - padY;
                var startY = toolbarH + (drawH - totalGroupH) / 2;
                if (startY < toolbarH + padY) startY = toolbarH + padY;

                for (var gi = 0; gi < group.length; gi++) {
                    var gn = group[gi];
                    gn.x = colCenterX - gn.w / 2;
                    gn.y = startY + gi * (defaultH + padY);
                    result.push(gn);
                }
            }
        }

        // Nodes without step: grid at bottom or fill area
        if (noStepNodes.length > 0) {
            var cols;
            if (stepValues.length > 0) {
                // Place below the step-based nodes
                cols = Math.max(1, Math.floor((w - padX * 2) / (defaultW + padX)));
            } else {
                // No steps at all — grid the whole area
                cols = Math.max(1, Math.floor((w - padX * 2) / (defaultW + padX)));
            }
            var startX = padX;
            var gridStartY;
            if (stepValues.length > 0) {
                // Find max Y from positioned nodes
                var maxY = 0;
                for (var ri = 0; ri < result.length; ri++) {
                    var bot = result[ri].y + result[ri].h;
                    if (bot > maxY) maxY = bot;
                }
                gridStartY = maxY + padY * 2;
            } else {
                gridStartY = toolbarH + padY;
            }

            for (var ni = 0; ni < noStepNodes.length; ni++) {
                var nn = noStepNodes[ni];
                var col = ni % cols;
                var row = Math.floor(ni / cols);
                nn.x = startX + col * (defaultW + padX);
                nn.y = gridStartY + row * (defaultH + padY);
                result.push(nn);
            }
        }

        return result;
    }

    // ── Connection Building ───────────────────────────────────────

    function buildConnections(nodes, editorState) {
        var connections = [];
        var nodeMap = {};
        var manualSet = {};

        for (var i = 0; i < nodes.length; i++) {
            nodeMap[nodes[i].id] = nodes[i];
        }

        // Manual connections from editorState
        var manualConns = (editorState && editorState.connections) ? editorState.connections : [];
        for (var mi = 0; mi < manualConns.length; mi++) {
            var mc = manualConns[mi];
            if (nodeMap[mc.from] && nodeMap[mc.to]) {
                var key = mc.from + '|' + mc.to;
                manualSet[key] = true;
                connections.push({
                    from: mc.from,
                    to: mc.to,
                    style: mc.style || 'straight',
                    color: mc.color || '',
                    width: mc.width || 2,
                    dash: mc.dash || false,
                    strokePattern: mc.strokePattern,
                    strokeDash: mc.strokeDash,
                    strokeGap: mc.strokeGap,
                    arrow: mc.arrow || 'forward',
                    label: mc.label || '',
                    manual: true,
                    startEndpoint: mc.startEndpoint,
                    endEndpoint: mc.endEndpoint,
                    sourceAnchor: mc.sourceAnchor || 'auto',
                    targetAnchor: mc.targetAnchor || 'auto',
                    sourceAnchorOffset: mc.sourceAnchorOffset || 0,
                    targetAnchorOffset: mc.targetAnchorOffset || 0,
                    endpointSize: mc.endpointSize,
                    waypoints: mc.waypoints || [],
                    labelPosition: mc.labelPosition !== undefined ? parseFloat(mc.labelPosition) : 0.5,
                    labelFontSize: mc.labelFontSize,
                    labelColor: mc.labelColor,
                    labelBgColor: mc.labelBgColor,
                    labelBorderColor: mc.labelBorderColor,
                    labelBorderStyle: mc.labelBorderStyle,
                    labelBorderWidth: mc.labelBorderWidth,
                    labelBorderRadius: mc.labelBorderRadius,
                    startFlipped: mc.startFlipped || false,
                    endFlipped: mc.endFlipped || false,
                    animationType: mc.animationType,
                    animationTrigger: mc.animationTrigger,
                    animationSpeed: mc.animationSpeed,
                    _animActive: mc._animActive,
                    _editorIdx: mi
                });
            }
        }

        // Track which nodes have explicit connects_to
        var hasExplicitConnects = {};

        // Explicit connects_to from data
        for (var ei = 0; ei < nodes.length; ei++) {
            var nd = nodes[ei];
            if (nd.connectsTo && nd.connectsTo.length > 0) {
                hasExplicitConnects[nd.id] = true;
                for (var ci = 0; ci < nd.connectsTo.length; ci++) {
                    var targetId = nd.connectsTo[ci];
                    if (targetId && nodeMap[targetId]) {
                        var eKey = nd.id + '|' + targetId;
                        if (!manualSet[eKey]) {
                            connections.push({
                                from: nd.id,
                                to: targetId,
                                style: 'straight',
                                color: '',
                                width: 2,
                                dash: false,
                                arrow: 'forward',
                                label: '',
                                manual: false
                            });
                            manualSet[eKey] = true;
                        }
                    }
                }
            }
        }

        // Auto-connect from step: connect step N to step N+1
        var stepGroups = {};
        var stepValues = [];
        for (var si = 0; si < nodes.length; si++) {
            var sn = nodes[si];
            if (sn.step !== null && sn.step !== undefined && sn.step !== '') {
                var sv = Number(sn.step);
                if (!isNaN(sv)) {
                    if (!stepGroups[sv]) {
                        stepGroups[sv] = [];
                        stepValues.push(sv);
                    }
                    stepGroups[sv].push(sn);
                }
            }
        }

        stepValues.sort(function(a, b) { return a - b; });

        for (var sti = 0; sti < stepValues.length - 1; sti++) {
            var currGroup = stepGroups[stepValues[sti]];
            var nextGroup = stepGroups[stepValues[sti + 1]];

            for (var cgi = 0; cgi < currGroup.length; cgi++) {
                var fromNode = currGroup[cgi];
                // Skip nodes that have explicit connects_to
                if (hasExplicitConnects[fromNode.id]) continue;

                for (var ngi = 0; ngi < nextGroup.length; ngi++) {
                    var toNode = nextGroup[ngi];
                    var aKey = fromNode.id + '|' + toNode.id;
                    if (!manualSet[aKey]) {
                        connections.push({
                            from: fromNode.id,
                            to: toNode.id,
                            style: 'straight',
                            color: '',
                            width: 2,
                            dash: false,
                            arrow: 'forward',
                            label: '',
                            manual: false
                        });
                        manualSet[aKey] = true;
                    }
                }
            }
        }

        return connections;
    }

    // ── Sparkline Drawing ─────────────────────────────────────────

    function drawSparkline(ctx, series, x, y, w, h, type, color) {
        if (!series || series.length === 0) return;

        // Filter out nulls and build clean data
        var clean = [];
        for (var i = 0; i < series.length; i++) {
            if (series[i] !== null && series[i] !== undefined && !isNaN(series[i])) {
                clean.push(Number(series[i]));
            }
        }
        if (clean.length === 0) return;

        var minVal = clean[0];
        var maxVal = clean[0];
        for (var m = 1; m < clean.length; m++) {
            if (clean[m] < minVal) minVal = clean[m];
            if (clean[m] > maxVal) maxVal = clean[m];
        }
        var range = maxVal - minVal;
        if (range === 0) range = 1;

        var padding = 2;
        var drawW = w - padding * 2;
        var drawH = h - padding * 2;
        var drawX = x + padding;
        var drawY = y + padding;

        if (type === 'bar') {
            var barWidth = drawW / clean.length;
            ctx.fillStyle = hexToRgba(color, 0.5);
            for (var bi = 0; bi < clean.length; bi++) {
                var barH = ((clean[bi] - minVal) / range) * drawH;
                if (barH < 1) barH = 1;
                ctx.fillRect(
                    drawX + bi * barWidth,
                    drawY + drawH - barH,
                    Math.max(barWidth - 1, 1),
                    barH
                );
            }
            return;
        }

        if (type === 'dot') {
            ctx.fillStyle = hexToRgba(color, 0.8);
            for (var di = 0; di < clean.length; di++) {
                var dotX = drawX + (clean.length > 1 ? (di / (clean.length - 1)) * drawW : drawW / 2);
                var dotY = drawY + drawH - ((clean[di] - minVal) / range) * drawH;
                ctx.beginPath();
                ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            return;
        }

        if (type === 'step') {
            ctx.strokeStyle = hexToRgba(color, 0.8);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            var prevStepY;
            for (var si = 0; si < clean.length; si++) {
                var stepX = drawX + (clean.length > 1 ? (si / (clean.length - 1)) * drawW : drawW / 2);
                var stepY = drawY + drawH - ((clean[si] - minVal) / range) * drawH;
                if (si === 0) {
                    ctx.moveTo(stepX, stepY);
                } else {
                    ctx.lineTo(stepX, prevStepY);
                    ctx.lineTo(stepX, stepY);
                }
                prevStepY = stepY;
            }
            ctx.stroke();
            ctx.lineWidth = 1;
            return;
        }

        // line or area
        var points = [];
        for (var pi = 0; pi < clean.length; pi++) {
            var px = drawX + (clean.length > 1 ? (pi / (clean.length - 1)) * drawW : drawW / 2);
            var py = drawY + drawH - ((clean[pi] - minVal) / range) * drawH;
            points.push({ x: px, y: py });
        }

        if (type === 'area') {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (var ai = 1; ai < points.length; ai++) {
                ctx.lineTo(points[ai].x, points[ai].y);
            }
            ctx.lineTo(points[points.length - 1].x, drawY + drawH);
            ctx.lineTo(points[0].x, drawY + drawH);
            ctx.closePath();
            var grad = ctx.createLinearGradient(0, drawY, 0, drawY + drawH);
            grad.addColorStop(0, hexToRgba(color, 0.3));
            grad.addColorStop(1, hexToRgba(color, 0.02));
            ctx.fillStyle = grad;
            ctx.fill();
        }

        // Draw the line on top
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (var li = 1; li < points.length; li++) {
            ctx.lineTo(points[li].x, points[li].y);
        }
        ctx.strokeStyle = hexToRgba(color, 0.8);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.lineWidth = 1;
    }

    // ── Node Drawing ──────────────────────────────────────────────

    function drawNode(ctx, node, theme, accentLine, sparklineType, nodeRadius, isSelected, isHovered, globalEffects) {
        var x = node.x;
        var y = node.y;
        var w = node.w;
        var h = node.h;
        var shape = node.shape || 'rect';
        var globalRadius = parseInt(nodeRadius, 10) || 8;
        var radius = node.borderRadius !== undefined && node.borderRadius !== 'default' && node.borderRadius !== ''
            ? parseInt(node.borderRadius, 10) : globalRadius;

        // Per-node overrides from editorState
        var nodeSparkType = node.sparklineType || sparklineType;
        var nodeFontSize = node.fontSize || 'default';
        var nodeChartH = node.chartHeight || 'default';
        var nodeOpacity = node.opacity || 'default';
        var nodeBorderW = node.borderWidth || 'default';

        // Per-node text/value properties
        var ge = globalEffects || {};
        var showRaw = node.rawValue !== undefined ? (node.rawValue === true || node.rawValue === 'on' || node.rawValue === 'full') : ge.rawValue;
        var tAlign = node.textAlign || 'center';
        var vAlign = node.verticalAlign || 'center';
        var padMap = { compact: 2, normal: 10, spacious: 28 };
        var pad = node.customPadding ? parseInt(node.customPadding, 10) : (padMap[node.padding] || padMap.normal);

        // Responsive base sizes — scale with node dimensions
        var baseScale = Math.min(w / 180, h / 120); // 180x120 is default node size
        var clampedScale = Math.max(0.5, Math.min(2.5, baseScale));

        // Compute font size (responsive to node size)
        var valueFontSize = Math.round(22 * clampedScale);
        var labelFontSize = Math.round(11 * clampedScale);
        if (nodeFontSize === 'small') { valueFontSize = Math.round(14 * clampedScale); labelFontSize = Math.round(9 * clampedScale); }
        else if (nodeFontSize === 'medium') { valueFontSize = Math.round(18 * clampedScale); labelFontSize = Math.round(10 * clampedScale); }
        else if (nodeFontSize === 'large') { valueFontSize = Math.round(28 * clampedScale); labelFontSize = Math.round(12 * clampedScale); }
        else if (nodeFontSize === 'xlarge') { valueFontSize = Math.round(36 * clampedScale); labelFontSize = Math.round(14 * clampedScale); }
        // Custom font size override
        if (node.customFontSize) { valueFontSize = parseInt(node.customFontSize, 10); labelFontSize = Math.round(valueFontSize * 0.7); }
        // Clamp to reasonable bounds
        valueFontSize = Math.max(10, Math.min(60, valueFontSize));
        labelFontSize = Math.max(8, Math.min(24, labelFontSize));

        // Compute chart height (responsive — proportion of node height)
        var sparkH;
        if (node.customChartHeight) {
            sparkH = parseInt(node.customChartHeight, 10);
        } else {
            sparkH = Math.round(h * 0.25);
            if (nodeChartH === 'small') sparkH = Math.round(h * 0.15);
            else if (nodeChartH === 'medium') sparkH = Math.round(h * 0.35);
            else if (nodeChartH === 'large') sparkH = Math.round(h * 0.50);
        }
        sparkH = Math.max(12, Math.min(h * 0.6, sparkH));

        // Compute opacity — per-node, then global default, then 1
        var nodeAlpha = 1;
        if (nodeOpacity !== 'default') {
            nodeAlpha = parseFloat(nodeOpacity) || 1;
        } else if (ge.defaultOpacity !== undefined && ge.defaultOpacity !== '') {
            var rawOpacity = parseFloat(ge.defaultOpacity) || 1;
            nodeAlpha = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity;
        }

        // Compute border — per-node, then global default, then 1
        var globalBorderW = ge.defaultBorderWidth !== undefined && ge.defaultBorderWidth !== '' ? ge.defaultBorderWidth : '1';
        var effectiveBorderW = nodeBorderW !== 'default' ? nodeBorderW : globalBorderW;
        var borderWidth = parseInt(effectiveBorderW, 10);
        if (isNaN(borderWidth) || borderWidth < 0) borderWidth = 1;
        if (isSelected) borderWidth = Math.max(borderWidth, 2.5);

        // Apply opacity
        if (nodeAlpha < 1) ctx.globalAlpha = nodeAlpha;

        // Helper: create shape path for clipping
        function shapePath() {
            if (shape === 'circle') {
                var cr = Math.min(w, h) / 2;
                ctx.beginPath();
                ctx.arc(x + w / 2, y + h / 2, cr, 0, Math.PI * 2);
            } else if (shape === 'diamond') {
                ctx.beginPath();
                ctx.moveTo(x + w / 2, y);
                ctx.lineTo(x + w, y + h / 2);
                ctx.lineTo(x + w / 2, y + h);
                ctx.lineTo(x, y + h / 2);
                ctx.closePath();
            } else if (shape === 'hexagon') {
                drawHexagonPath(ctx, x, y, w, h);
            } else if (shape === 'triangle') {
                drawTrianglePath(ctx, x, y, w, h);
            } else if (shape === 'cylinder') {
                drawCylinderPath(ctx, x, y, w, h);
            } else if (shape === 'cloud') {
                drawCloudPath(ctx, x, y, w, h);
            } else if (shape === 'pill') {
                drawPillPath(ctx, x, y, w, h);
            } else {
                roundRect(ctx, x, y, w, h, radius);
            }
        }

        // Conditional formatting — single color from first matching rule, applied per conditionTarget
        var condColor = evalConditions(node.conditions, node.value);
        var condTarget = node.conditionTarget || 'background';
        // condResults provides per-target conditional colors for backward compat
        var condResults = {
            background: (condColor && (condTarget === 'background' || condTarget === 'all')) ? condColor : null,
            border:     (condColor && (condTarget === 'border'     || condTarget === 'all')) ? condColor : null,
            value:      (condColor && (condTarget === 'value'      || condTarget === 'value+trend' || condTarget === 'all')) ? condColor : null,
            label:      (condColor && condTarget === 'all') ? condColor : null,
            sparkline:  (condColor && (condTarget === 'sparkline'  || condTarget === 'all')) ? condColor : null,
            trend:      (condColor && (condTarget === 'trend'      || condTarget === 'value+trend' || condTarget === 'all')) ? condColor : null
        };
        // When condTarget is not background/all, don't tint the background
        if (condTarget === 'none' || condTarget === 'border' || condTarget === 'value' || condTarget === 'trend' || condTarget === 'value+trend' || condTarget === 'sparkline') {
            condColor = null;
        }

        // Apply shadow (per-node or global) before fill
        var shadowOn = node.shadowEnabled !== undefined ? (node.shadowEnabled === true || node.shadowEnabled === 'on') : ge.shadowEnabled;
        if (isHovered && !shadowOn) {
            // Default hover shadow when no explicit shadow configured
            ctx.shadowColor = hexToRgba(node.color, 0.3);
            ctx.shadowBlur = 12;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 4;
        } else if (shadowOn) {
            ctx.shadowBlur = node.shadowBlur !== undefined ? parseInt(node.shadowBlur, 10) : (ge.shadowBlur || 8);
            ctx.shadowOffsetX = node.shadowOffsetX !== undefined ? parseInt(node.shadowOffsetX, 10) : (ge.shadowOffsetX || 2);
            ctx.shadowOffsetY = node.shadowOffsetY !== undefined ? parseInt(node.shadowOffsetY, 10) : (ge.shadowOffsetY || 2);
            ctx.shadowColor = node.shadowColor || ge.shadowColor || '#000000';
        }

        // Frosted glass: reduce opacity for translucent look
        var frostedOn = node.frostedGlass === 'on' || (node.frostedGlass === undefined && ge.frostedGlass === 'on');
        if (frostedOn) {
            ctx.globalAlpha = (nodeAlpha < 1 ? nodeAlpha : 1) * 0.7;
        }

        // Draw shape fill — conditional color tints the background subtly; per-node/global bgColor override
        var nodeBgColor = node.bgColor || ge.defaultBgColor || '';
        var baseFillColor = condColor ? hexToRgba(condColor, 0.15) : (nodeBgColor || theme.nodeBg);
        shapePath();

        // Gradient fill: linear gradient top-to-bottom instead of flat color
        var gradientOn = node.gradientFill === 'on' || (node.gradientFill === undefined && ge.gradientFill === 'on');
        if (gradientOn) {
            var hexFill = normalizeToHex(baseFillColor);
            var gDir = node.gradientDirection || 'top-down';
            var gStart = node.gradientStart || lightenColor(hexFill, 0.15);
            var gEnd = node.gradientEnd || darkenColor(hexFill, 0.15);
            var grad;
            if (gDir === 'left-right') {
                grad = ctx.createLinearGradient(x, y, x + w, y);
            } else if (gDir === 'diagonal') {
                grad = ctx.createLinearGradient(x, y, x + w, y + h);
            } else if (gDir === 'radial') {
                var gcx = x + w / 2, gcy = y + h / 2;
                var gr = Math.max(w, h) / 2;
                grad = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, gr);
            } else {
                // top-down (default)
                grad = ctx.createLinearGradient(x, y, x, y + h);
            }
            grad.addColorStop(0, gStart);
            grad.addColorStop(1, gEnd);
            ctx.fillStyle = grad;
        } else {
            ctx.fillStyle = baseFillColor;
        }
        ctx.fill();

        // Reset shadow after fill
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = 'transparent';

        // Restore alpha if frosted glass was applied
        if (frostedOn) {
            ctx.globalAlpha = nodeAlpha < 1 ? nodeAlpha : 1;
        }

        // Draw border — conditional color replaces border color; per-node/global borderColor override
        var nodeBorderColor = node.borderColor || ge.defaultBorderColor || '';
        if (borderWidth > 0) {
            shapePath();
            var borderColor = nodeBorderColor || theme.nodeBorder;
            var nodeStrokePattern = node.strokePattern || ge.defaultStrokePattern || 'solid';
            var dashPattern;
            var customDash = parseInt(node.strokeDash, 10);
            var customGap = parseInt(node.strokeGap, 10);
            var basePattern = STROKE_PATTERNS[nodeStrokePattern] || [];
            if ((customDash > 0 || customGap > 0) && basePattern.length > 0) {
                // Scale the base pattern: replace dash segments with customDash, gap segments with customGap
                dashPattern = [];
                for (var dpi = 0; dpi < basePattern.length; dpi++) {
                    if (dpi % 2 === 0) {
                        // Dash segment (even indices: 0, 2, 4...)
                        dashPattern.push(customDash > 0 ? customDash : basePattern[dpi]);
                    } else {
                        // Gap segment (odd indices: 1, 3, 5...)
                        dashPattern.push(customGap > 0 ? customGap : basePattern[dpi]);
                    }
                }
            } else if (customDash > 0 || customGap > 0) {
                // No base pattern (solid) but custom values set — create simple dash
                dashPattern = [customDash > 0 ? customDash : 8, customGap > 0 ? customGap : 4];
            } else {
                dashPattern = basePattern;
            }
            // condBorderColor: explicit border target overrides background-based fallback
            var condBorderColor = condResults.border || null;
            var actualBorderWidth = (condColor || condBorderColor) ? Math.max(borderWidth, 2) : borderWidth;
            if (dashPattern.length > 0 && actualBorderWidth < 1.5) {
                actualBorderWidth = 1.5;
            }
            var isDarkTheme = theme.bg === '#0f172a';
            if (dashPattern.length > 0 && !node.borderColor && !ge.defaultBorderColor) {
                borderColor = isDarkTheme ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
            }
            ctx.strokeStyle = isSelected ? node.color : (condBorderColor || condColor || borderColor);
            ctx.lineWidth = actualBorderWidth;
            ctx.setLineDash(dashPattern);
            ctx.stroke();
            ctx.setLineDash([]); // reset
        }

        // Glow effect — re-stroke with shadow to create outer glow
        var glowOn = node.glowEnabled !== undefined ? (node.glowEnabled === true || node.glowEnabled === 'on') : ge.glowEnabled;
        if (glowOn) {
            ctx.save();
            shapePath();
            ctx.shadowBlur = node.glowBlur !== undefined ? parseInt(node.glowBlur, 10) : (ge.glowBlur || 12);
            ctx.shadowColor = node.glowColor || ge.glowColor || '#3b82f6';
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.strokeStyle = node.glowColor || ge.glowColor || '#3b82f6';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.stroke();
            ctx.restore();
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.shadowColor = 'transparent';
        }

        // Inner shadow (inset) — clip to shape, then cast shadow from edges
        var innerShadowOn = node.innerShadow === 'on' || (node.innerShadow === undefined && ge.innerShadow === 'on');
        if (innerShadowOn) {
            ctx.save();
            shapePath();
            ctx.clip();

            var isDarkBg = isColorDark(normalizeToHex(baseFillColor));
            var innerShadowColor = isDarkBg ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)';

            ctx.shadowBlur = 12;
            ctx.shadowColor = innerShadowColor;
            ctx.fillStyle = 'transparent';

            // Top edge
            ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 4;
            ctx.fillRect(x - 20, y - 24, w + 40, 20);

            // Left edge
            ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 0;
            ctx.fillRect(x - 24, y - 20, 20, h + 40);

            // Bottom edge (subtle)
            ctx.shadowOffsetX = 0; ctx.shadowOffsetY = -3;
            ctx.fillRect(x - 20, y + h + 4, w + 40, 20);

            // Right edge (subtle)
            ctx.shadowOffsetX = -3; ctx.shadowOffsetY = 0;
            ctx.fillRect(x + w + 4, y - 20, 20, h + 40);

            ctx.restore();
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }

        // Accent line at top (rect only)
        if (accentLine === 'true' && shape === 'rect') {
            ctx.save();
            roundRect(ctx, x, y, w, Math.min(3, h), radius);
            ctx.clip();
            ctx.fillStyle = node.color;
            ctx.fillRect(x, y, w, 3);
            ctx.restore();
        }

        // ── Textbox shape: render markdown content and early-return ──
        if (shape === 'textbox') {
            var mdContent = node.markdownContent || '## Title\n\nText here';
            var mdLines = parseMarkdown(mdContent);
            var mdPad = 10;
            var mdY = y + mdPad;
            var mdX = x + mdPad;
            var baseFontSize = 12;

            ctx.save();
            // Clip to rounded rect bounds
            roundRect(ctx, x, y, w, h, radius);
            ctx.clip();

            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';

            for (var mdI = 0; mdI < mdLines.length; mdI++) {
                var mdLine = mdLines[mdI];
                if (mdY > y + h) break; // clip overflow

                if (mdLine.type === 'heading') {
                    ctx.font = 'bold ' + Math.round(baseFontSize * 1.4) + 'px sans-serif';
                    ctx.fillStyle = theme.text;
                    ctx.fillText(mdLine.text, mdX, mdY);
                    mdY += Math.round(baseFontSize * 1.4) + 6;
                } else if (mdLine.type === 'bullet') {
                    ctx.font = baseFontSize + 'px sans-serif';
                    ctx.fillStyle = theme.textMuted;
                    ctx.fillText('\u2022  ' + mdLine.text, mdX + 4, mdY);
                    mdY += baseFontSize + 4;
                } else if (mdLine.type === 'blank') {
                    mdY += baseFontSize * 0.5;
                } else {
                    // Render with inline bold/italic segments
                    var segments = parseInlineMarkdown(mdLine.text);
                    var segX = mdX;
                    for (var si2 = 0; si2 < segments.length; si2++) {
                        var seg = segments[si2];
                        var fontStr = baseFontSize + 'px sans-serif';
                        if (seg.bold && seg.italic) {
                            fontStr = 'bold italic ' + baseFontSize + 'px sans-serif';
                        } else if (seg.bold) {
                            fontStr = 'bold ' + baseFontSize + 'px sans-serif';
                        } else if (seg.italic) {
                            fontStr = 'italic ' + baseFontSize + 'px sans-serif';
                        }
                        ctx.font = fontStr;
                        ctx.fillStyle = theme.textMuted;
                        ctx.fillText(seg.text, segX, mdY);
                        segX += ctx.measureText(seg.text).width;
                    }
                    mdY += baseFontSize + 4;
                }
            }

            ctx.restore();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 1;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            return; // Skip rest of drawNode
        }

        // Clip ALL text and sparkline to shape
        ctx.save();
        shapePath();
        ctx.clip();

        // Layout — sparkline position determines content arrangement
        var textPadY = shape === 'rect' && accentLine === 'true' ? 10 : 8;
        var hasSpark = node.series && node.series.length > 1 && nodeSparkType !== 'none';
        var sparkPos = node.sparkPosition || 'default'; // default=below, above, behind, left
        var showValue = !node.hideValue;
        var rawVal = node.value;
        var displayValue;
        if (showRaw && rawVal !== undefined && rawVal !== null) {
            displayValue = Number(rawVal).toLocaleString();
        } else {
            displayValue = formatCount(rawVal);
        }
        var valueText = showValue ? (node.prefix || '') + displayValue + (node.suffix || '') : '';

        // Calculate shape-specific text insets so text stays inside visible area
        var textInsetTop = 0;
        var textInsetBottom = 0;
        var textInsetLeft = 0;
        var textInsetRight = 0;

        if (shape === 'triangle') {
            textInsetTop = h * 0.3;
            textInsetLeft = w * 0.15;
            textInsetRight = w * 0.15;
        } else if (shape === 'cloud') {
            textInsetTop = h * 0.15;
            textInsetBottom = h * 0.1;
            textInsetLeft = w * 0.1;
            textInsetRight = w * 0.1;
        } else if (shape === 'hexagon') {
            textInsetLeft = w * 0.12;
            textInsetRight = w * 0.12;
        } else if (shape === 'diamond') {
            textInsetTop = h * 0.2;
            textInsetBottom = h * 0.2;
            textInsetLeft = w * 0.2;
            textInsetRight = w * 0.2;
        } else if (shape === 'cylinder') {
            textInsetTop = h * 0.15;
            textInsetBottom = h * 0.15;
        } else if (shape === 'pill') {
            // Pill has fully rounded ends — inset by half the height (the radius)
            var pillR = Math.min(h / 2, w / 2);
            textInsetLeft = pillR * 0.6;
            textInsetRight = pillR * 0.6;
        } else if (shape === 'circle') {
            // Circle: inscribed rect has ~29% inset on each side
            textInsetTop = h * 0.15;
            textInsetBottom = h * 0.15;
            textInsetLeft = w * 0.15;
            textInsetRight = w * 0.15;
        }

        // Effective text area after shape insets
        var tx0 = x + textInsetLeft;
        var ty0 = y + textInsetTop;
        var tw0 = w - textInsetLeft - textInsetRight;
        var th0 = h - textInsetTop - textInsetBottom;

        // Compute text X based on alignment (used in default/behind/above branches)
        var textX;
        if (tAlign === 'left') textX = tx0 + pad;
        else if (tAlign === 'right') textX = tx0 + tw0 - pad;
        else textX = tx0 + tw0 / 2;

        // Track where value text was drawn (used for trend indicator)
        var _valDrawnX = textX;
        var _valDrawnY = 0;
        var _valDrawnAlign = tAlign;
        var _valMaxW = tw0 - pad * 2;

        if (sparkPos === 'behind' && hasSpark) {
            // BEHIND: sparkline fills entire node background, text overlaps on top
            drawSparkline(ctx, node.series, x, y, w, h, nodeSparkType, condResults.sparkline || node.color);
            node._sparkBounds = { x: x, y: y, w: w, h: h };
            node._sparkDataRef = node.series;
            // Compute vertical position for label + value block
            var bhTextBlockH = labelFontSize + valueFontSize + 4;
            var bhStartY;
            if (vAlign === 'top') {
                bhStartY = ty0 + pad;
            } else if (vAlign === 'bottom') {
                bhStartY = ty0 + th0 - bhTextBlockH - pad;
            } else {
                bhStartY = ty0 + (th0 - bhTextBlockH) / 2;
            }
            // Label
            ctx.font = labelFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = condResults.label || node.labelColor || theme.textMuted;
            ctx.textAlign = tAlign;
            ctx.textBaseline = 'top';
            ctx.fillText(truncateText(node.label, 18), textX, bhStartY);
            // Value
            if (showValue) {
                _valDrawnY = bhStartY + labelFontSize + 4 + valueFontSize / 2;
                _valDrawnX = textX;
                _valDrawnAlign = tAlign;
                ctx.fillStyle = condResults.value || node.valueColor || theme.text;
                ctx.textAlign = tAlign;
                ctx.textBaseline = 'middle';
                drawFitText(ctx, valueText, textX, _valDrawnY, tw0 - pad * 2, valueFontSize, '"SF Mono", "Fira Code", "Consolas", monospace');
            }
        } else if (sparkPos === 'above' && hasSpark) {
            // ABOVE: sparkline in top portion, text below
            var abSparkH = Math.min(sparkH, Math.round(th0 * 0.5));
            drawSparkline(ctx, node.series, tx0 + pad, ty0 + pad, tw0 - pad * 2, abSparkH - pad, nodeSparkType, condResults.sparkline || node.color);
            node._sparkBounds = { x: tx0 + pad, y: ty0 + pad, w: tw0 - pad * 2, h: abSparkH - pad };
            node._sparkDataRef = node.series;
            // Text area below sparkline
            var abTextAreaY = ty0 + abSparkH;
            var abTextAreaH = th0 - abSparkH;
            var abTextBlockH = labelFontSize + valueFontSize + 4;
            var abStartY;
            if (vAlign === 'top') {
                abStartY = abTextAreaY + pad;
            } else if (vAlign === 'bottom') {
                abStartY = abTextAreaY + abTextAreaH - abTextBlockH - pad;
            } else {
                abStartY = abTextAreaY + (abTextAreaH - abTextBlockH) / 2;
            }
            // Label below spark
            ctx.font = labelFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = condResults.label || node.labelColor || theme.textMuted;
            ctx.textAlign = tAlign;
            ctx.textBaseline = 'top';
            ctx.fillText(truncateText(node.label, 18), textX, abStartY);
            // Value
            if (showValue) {
                _valDrawnY = abStartY + labelFontSize + 4 + valueFontSize / 2;
                _valDrawnX = textX;
                _valDrawnAlign = tAlign;
                ctx.fillStyle = condResults.value || node.valueColor || theme.text;
                ctx.textAlign = tAlign;
                ctx.textBaseline = 'middle';
                drawFitText(ctx, valueText, textX, _valDrawnY, tw0 - pad * 2, valueFontSize, '"SF Mono", "Fira Code", "Consolas", monospace');
            }
        } else if (sparkPos === 'left' && hasSpark) {
            // LEFT: sparkline on left, text on right
            var leftSparkW = Math.round(tw0 * 0.45);
            var leftSparkActualH = th0 - pad * 2;
            var leftSparkAreaX = tx0;
            var leftSparkAreaY = ty0 + pad;
            drawSparkline(ctx, node.series, leftSparkAreaX, leftSparkAreaY, leftSparkW, leftSparkActualH, nodeSparkType, condResults.sparkline || node.color);
            node._sparkBounds = { x: leftSparkAreaX, y: leftSparkAreaY, w: leftSparkW, h: leftSparkActualH };
            node._sparkDataRef = node.series;
            // Label on right (tAlign applies within right panel)
            var rightX = tx0 + leftSparkW + pad;
            var rightW = tw0 - leftSparkW - pad * 2;
            var rightTextX;
            if (tAlign === 'left') rightTextX = rightX + pad;
            else if (tAlign === 'right') rightTextX = rightX + rightW - pad;
            else rightTextX = rightX + rightW / 2;
            // Compute vertical position in the right panel
            var ltTextBlockH = labelFontSize + valueFontSize + 4;
            var ltStartY;
            if (vAlign === 'top') {
                ltStartY = ty0 + pad;
            } else if (vAlign === 'bottom') {
                ltStartY = ty0 + th0 - ltTextBlockH - pad;
            } else {
                ltStartY = ty0 + (th0 - ltTextBlockH) / 2;
            }
            ctx.font = labelFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = condResults.label || node.labelColor || theme.textMuted;
            ctx.textAlign = tAlign;
            ctx.textBaseline = 'top';
            ctx.fillText(truncateText(node.label, 12), rightTextX, ltStartY);
            // Value on right
            if (showValue) {
                _valDrawnY = ltStartY + labelFontSize + 4 + valueFontSize / 2;
                _valDrawnX = rightTextX;
                _valDrawnAlign = tAlign;
                _valMaxW = rightW - pad * 2;
                ctx.fillStyle = condResults.value || node.valueColor || theme.text;
                ctx.textAlign = tAlign;
                ctx.textBaseline = 'middle';
                drawFitText(ctx, valueText, rightTextX, _valDrawnY, rightW - pad * 2, valueFontSize, '"SF Mono", "Fira Code", "Consolas", monospace');
            }
        } else if (sparkPos === 'right' && hasSpark) {
            // RIGHT: text on left 55%, sparkline on right 45% (mirror of left)
            var rightSparkW = Math.round(tw0 * 0.45);
            var rightSparkX = tx0 + tw0 - rightSparkW;
            var rightSparkActualH = th0 - pad * 2;
            var rightSparkAreaY = ty0 + pad;
            drawSparkline(ctx, node.series, rightSparkX, rightSparkAreaY, rightSparkW, rightSparkActualH, nodeSparkType, condResults.sparkline || node.color);
            node._sparkBounds = { x: rightSparkX, y: rightSparkAreaY, w: rightSparkW, h: rightSparkActualH };
            node._sparkDataRef = node.series;
            // Label on left panel
            var leftTextW = tw0 - rightSparkW - pad * 2;
            var leftTextX;
            if (tAlign === 'left') leftTextX = tx0 + pad;
            else if (tAlign === 'right') leftTextX = tx0 + leftTextW - pad;
            else leftTextX = tx0 + leftTextW / 2;
            // Compute vertical position in the left panel
            var rtTextBlockH = labelFontSize + valueFontSize + 4;
            var rtStartY;
            if (vAlign === 'top') {
                rtStartY = ty0 + pad;
            } else if (vAlign === 'bottom') {
                rtStartY = ty0 + th0 - rtTextBlockH - pad;
            } else {
                rtStartY = ty0 + (th0 - rtTextBlockH) / 2;
            }
            ctx.font = labelFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = condResults.label || node.labelColor || theme.textMuted;
            ctx.textAlign = tAlign;
            ctx.textBaseline = 'top';
            ctx.fillText(truncateText(node.label, 12), leftTextX, rtStartY);
            // Value on left
            if (showValue) {
                _valDrawnY = rtStartY + labelFontSize + 4 + valueFontSize / 2;
                _valDrawnX = leftTextX;
                _valDrawnAlign = tAlign;
                _valMaxW = leftTextW - pad * 2;
                ctx.fillStyle = condResults.value || node.valueColor || theme.text;
                ctx.textAlign = tAlign;
                ctx.textBaseline = 'middle';
                drawFitText(ctx, valueText, leftTextX, _valDrawnY, leftTextW - pad * 2, valueFontSize, '"SF Mono", "Fira Code", "Consolas", monospace');
            }
        } else {
            // DEFAULT (below): label top, value middle, sparkline bottom
            // Compute text block height
            var textBlockH = labelFontSize + valueFontSize + 4;
            if (node.subtitle) textBlockH += Math.max(9, labelFontSize - 1) + 4;
            // Compute vertical start based on vAlign
            var startY;
            if (vAlign === 'top') {
                startY = ty0 + pad;
            } else if (vAlign === 'bottom') {
                startY = ty0 + th0 - textBlockH - pad;
            } else {
                // center (default)
                startY = ty0 + (th0 - textBlockH) / 2;
            }
            var dfLabelY = startY;
            var dfValueY = startY + labelFontSize + 4;
            if (shape === 'circle') dfLabelY = y + h * 0.18;
            // Adjust for sparkline at bottom — move text block up
            if (hasSpark) {
                dfValueY = ty0 + th0 * 0.38;
                if (vAlign === 'top') {
                    dfLabelY = ty0 + pad;
                    dfValueY = ty0 + pad + labelFontSize + 4;
                } else if (vAlign === 'bottom') {
                    dfValueY = ty0 + th0 - sparkH - pad * 2 - valueFontSize;
                    dfLabelY = dfValueY - labelFontSize - 4;
                } else {
                    dfLabelY = ty0 + pad;
                    dfValueY = ty0 + th0 * 0.38;
                }
            }
            // Adjust for subtitle
            if (node.subtitle && !hasSpark) {
                if (vAlign === 'top') {
                    dfLabelY = ty0 + pad;
                    dfValueY = ty0 + pad + labelFontSize + 4;
                } else if (vAlign === 'bottom') {
                    var subH = Math.max(9, labelFontSize - 1);
                    dfValueY = ty0 + th0 - subH - valueFontSize * 0.6 - 4 - valueFontSize - pad;
                    dfLabelY = dfValueY - labelFontSize - 4;
                } else {
                    dfLabelY = ty0 + (th0 - textBlockH) / 2;
                    dfValueY = dfLabelY + labelFontSize + 4;
                }
            }
            // Label
            ctx.font = labelFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = condResults.label || node.labelColor || theme.textMuted;
            ctx.textAlign = tAlign;
            ctx.textBaseline = 'top';
            ctx.fillText(truncateText(node.label, 18), textX, dfLabelY);
            // Value
            if (showValue) {
                _valDrawnY = dfValueY + valueFontSize / 2;
                _valDrawnX = textX;
                _valDrawnAlign = tAlign;
                ctx.fillStyle = condResults.value || node.valueColor || theme.text;
                ctx.textAlign = tAlign;
                ctx.textBaseline = 'middle';
                drawFitText(ctx, valueText, textX, _valDrawnY, tw0 - pad * 2, valueFontSize, '"SF Mono", "Fira Code", "Consolas", monospace');
            }
            // Subtitle
            if (node.subtitle) {
                ctx.font = Math.max(9, labelFontSize - 1) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.fillStyle = condResults.label || node.labelColor || theme.textMuted;
                ctx.textAlign = tAlign;
                ctx.textBaseline = 'top';
                ctx.fillText(truncateText(node.subtitle, 22), textX, dfValueY + valueFontSize + 4);
            }
            // Sparkline at bottom
            if (hasSpark) {
                var sparkY = y + h - sparkH - pad;
                var sparkX = x + pad;
                var sparkW = w - pad * 2;
                if (shape === 'circle') {
                    var cr2 = Math.min(w, h) / 2;
                    var sparkYOff = sparkY + sparkH / 2 - (y + h / 2);
                    var sparkHalfW = Math.sqrt(Math.max(0, cr2 * cr2 - sparkYOff * sparkYOff));
                    sparkX = x + w / 2 - sparkHalfW + pad;
                    sparkW = sparkHalfW * 2 - pad * 2;
                } else if (shape === 'diamond') {
                    var relY2 = (sparkY + sparkH / 2 - y) / h;
                    var dHalfW = w / 2 * (relY2 > 0.5 ? 2 * (1 - relY2) : 2 * relY2);
                    sparkX = x + w / 2 - dHalfW + pad;
                    sparkW = dHalfW * 2 - pad * 2;
                }
                if (sparkW > 20) {
                    drawSparkline(ctx, node.series, sparkX, sparkY, sparkW, sparkH, nodeSparkType, condResults.sparkline || node.color);
                    node._sparkBounds = { x: sparkX, y: sparkY, w: sparkW, h: sparkH };
                    node._sparkDataRef = node.series;
                }
            }
        }

        // Clear spark bounds if no sparkline was drawn
        if (!hasSpark || nodeSparkType === 'none') {
            node._sparkBounds = null;
            node._sparkDataRef = null;
        }

        // ── Trend Indicator ──
        var trendDisplay = node.trendDisplay || 'off';
        if (trendDisplay !== 'off' && showValue && node.series && node.series.length >= 2) {
            var compareBack = parseInt(node.trendCompareBack, 10) || 1;
            var sparkData = node.series;
            var lastVal, prevVal, trendVal, trendPct;
            if (sparkData.length >= compareBack + 1) {
                lastVal = sparkData[sparkData.length - 1];
                prevVal = sparkData[sparkData.length - 1 - compareBack];
            } else {
                lastVal = sparkData[sparkData.length - 1];
                prevVal = sparkData[sparkData.length - 2];
            }
            trendVal = lastVal - prevVal;
            trendPct = prevVal !== 0 ? ((lastVal - prevVal) / prevVal) * 100 : 0;

            var trendArrow = trendVal >= 0 ? '\u2191' : '\u2193';
            var trendText;
            if (trendDisplay === 'percent') {
                trendText = trendArrow + Math.abs(trendPct).toFixed(1) + '%';
            } else {
                trendText = trendArrow + formatCount(Math.abs(trendVal));
            }

            // Determine trend color — priority: conditions > custom up/down > auto
            var trendColor;

            // 1. Check if conditions target trend (condResults.trend is pre-computed above)
            if (condResults.trend) {
                trendColor = condResults.trend;
            } else {
                // 2. Use custom up/down colors or auto defaults
                if (trendVal >= 0) {
                    trendColor = node.trendUpColor || '#22c55e';
                } else {
                    trendColor = node.trendDownColor || '#ef4444';
                }
            }

            // Draw trend text — smaller font, positioned after value
            var trendFontSize = Math.round(valueFontSize * 0.6);
            ctx.font = 'bold ' + trendFontSize + 'px sans-serif';
            ctx.fillStyle = trendColor;
            ctx.textBaseline = 'middle';

            // Measure the value text width at its drawn size
            ctx.save();
            ctx.font = 'bold ' + valueFontSize + 'px "SF Mono", "Fira Code", "Consolas", monospace';
            var valTextW = ctx.measureText(valueText).width;
            // Clamp to maxW if it was shrunk by drawFitText
            if (valTextW > _valMaxW) valTextW = _valMaxW;
            ctx.restore();

            // Compute trend X position based on alignment
            var trendX;
            if (_valDrawnAlign === 'center') {
                trendX = _valDrawnX + valTextW / 2 + 4;
            } else if (_valDrawnAlign === 'left') {
                trendX = _valDrawnX + valTextW + 4;
            } else {
                trendX = _valDrawnX + 4;
            }

            ctx.font = 'bold ' + trendFontSize + 'px sans-serif';
            ctx.fillStyle = trendColor;
            ctx.textAlign = 'left';
            ctx.fillText(trendText, trendX, _valDrawnY);
            ctx.textAlign = _valDrawnAlign; // restore

            // ── Visual Trend Comparison Marker on Sparkline ──
            // Overlay the compare segment of the sparkline in trend color
            if (node._sparkBounds && sparkData && sparkData.length >= compareBack + 1) {
                var sb = node._sparkBounds;
                var sdLen = sparkData.length;
                var compareIdx = sdLen - 1 - compareBack;
                if (compareIdx < 0) compareIdx = 0;

                // Match drawSparkline's internal padding exactly
                var sPad = 2;
                var sdX = sb.x + sPad;
                var sdY = sb.y + sPad;
                var sdW = sb.w - sPad * 2;
                var sdH = sb.h - sPad * 2;

                // Calculate min/max for Y mapping (same as drawSparkline)
                var sMin = sparkData[0];
                var sMax = sparkData[0];
                for (var smi = 1; smi < sdLen; smi++) {
                    if (sparkData[smi] < sMin) sMin = sparkData[smi];
                    if (sparkData[smi] > sMax) sMax = sparkData[smi];
                }
                var sRange = sMax - sMin || 1;

                var markerColor = trendColor;
                var activeChartType = node.sparklineType || 'area';

                ctx.save();
                ctx.beginPath();
                ctx.rect(sb.x, sb.y, sb.w, sb.h);
                ctx.clip();

                if (activeChartType === 'bar') {
                    // Match drawSparkline bar positioning exactly
                    var barW = sdW / sdLen;
                    for (var bi = compareIdx; bi < sdLen; bi++) {
                        var bx = sdX + bi * barW;
                        var bh = ((sparkData[bi] - sMin) / sRange) * sdH;
                        if (bh < 1) bh = 1;
                        var by = sdY + sdH - bh;
                        ctx.fillStyle = markerColor;
                        ctx.globalAlpha = 0.5;
                        ctx.fillRect(bx, by, Math.max(barW - 1, 1), bh);
                    }
                    ctx.globalAlpha = 1;
                } else {
                    // For line/area/step/dot: draw the line segment in trend color
                    // Use same coordinate system as drawSparkline (with padding)
                    ctx.beginPath();
                    ctx.strokeStyle = markerColor;
                    ctx.lineWidth = 2;

                    for (var ti = compareIdx; ti < sdLen; ti++) {
                        var tx = sdX + (ti / (sdLen - 1)) * sdW;
                        var ty = sdY + sdH - ((sparkData[ti] - sMin) / sRange) * sdH;
                        if (ti === compareIdx) {
                            ctx.moveTo(tx, ty);
                        } else {
                            if (activeChartType === 'step') {
                                var prevTy = sdY + sdH - ((sparkData[ti - 1] - sMin) / sRange) * sdH;
                                ctx.lineTo(tx, prevTy);
                                ctx.lineTo(tx, ty);
                            } else {
                                ctx.lineTo(tx, ty);
                            }
                        }
                    }
                    ctx.stroke();

                    // Fill area under the trend segment
                    if (activeChartType === 'area') {
                        var lastTx = sdX + ((sdLen - 1) / (sdLen - 1)) * sdW;
                        var firstTx = sdX + (compareIdx / (sdLen - 1)) * sdW;
                        ctx.lineTo(lastTx, sdY + sdH);
                        ctx.lineTo(firstTx, sdY + sdH);
                        ctx.closePath();
                        ctx.fillStyle = markerColor;
                        ctx.globalAlpha = 0.15;
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    }
                }

                ctx.restore();
            }
        }

        ctx.restore(); // end shape clip

        // Reset
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    // ── Connection Drawing ────────────────────────────────────────

    /**
     * Get a specific anchor point on a node (top/bottom/left/right/center).
     */
    function getAnchorPoint(node, anchor, offset) {
        var cx = node.x + node.w / 2;
        var cy = node.y + node.h / 2;
        var shape = node.shape || 'rect';
        var off = parseInt(offset, 10) || 0;

        if (shape === 'circle') {
            var r = Math.min(node.w, node.h) / 2;
            if (anchor === 'top') return { x: cx + off, y: cy - r };
            if (anchor === 'bottom') return { x: cx + off, y: cy + r };
            if (anchor === 'left') return { x: cx - r, y: cy + off };
            if (anchor === 'right') return { x: cx + r, y: cy + off };
        } else if (shape === 'diamond') {
            var hw = node.w / 2;
            var hh = node.h / 2;
            if (anchor === 'top') return { x: cx + off * 0.5, y: cy - hh + Math.abs(off) * hh / hw };
            if (anchor === 'bottom') return { x: cx + off * 0.5, y: cy + hh - Math.abs(off) * hh / hw };
            if (anchor === 'left') return { x: cx - hw + Math.abs(off) * hw / hh, y: cy + off * 0.5 };
            if (anchor === 'right') return { x: cx + hw - Math.abs(off) * hw / hh, y: cy + off * 0.5 };
        } else {
            // rect
            if (anchor === 'top') return { x: cx + off, y: node.y };
            if (anchor === 'bottom') return { x: cx + off, y: node.y + node.h };
            if (anchor === 'left') return { x: node.x, y: cy + off };
            if (anchor === 'right') return { x: node.x + node.w, y: cy + off };
        }
        return { x: cx, y: cy }; // center or auto
    }

    /**
     * Get a point at position t (0-1) along the connection path.
     * Mirrors the exact geometry used by drawConnection for curved and straight paths.
     */
    function interpolateConnectionPath(points, style, t) {
        if (!points || points.length < 2) return { x: 0, y: 0 };

        if (style === 'curved' && points.length === 2) {
            // Quadratic bezier — matches drawConnection simple curve
            var mx2 = (points[0].x + points[1].x) / 2;
            var my2 = (points[0].y + points[1].y) / 2;
            var dx2 = points[1].x - points[0].x;
            var dy2 = points[1].y - points[0].y;
            var len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
            var off2 = Math.min(40, len2 * 0.2);
            var nx2 = len2 > 0 ? -dy2 / len2 : 0;
            var ny2 = len2 > 0 ? dx2 / len2 : 0;
            var cpx2 = mx2 + nx2 * off2;
            var cpy2 = my2 + ny2 * off2;
            var mt = 1 - t;
            return {
                x: mt * mt * points[0].x + 2 * mt * t * cpx2 + t * t * points[1].x,
                y: mt * mt * points[0].y + 2 * mt * t * cpy2 + t * t * points[1].y
            };
        }

        // For straight lines or multi-point: walk segments by total length
        var totalLen = 0;
        var segLens = [];
        for (var i = 1; i < points.length; i++) {
            var sdx = points[i].x - points[i - 1].x;
            var sdy = points[i].y - points[i - 1].y;
            var slen = Math.sqrt(sdx * sdx + sdy * sdy);
            segLens.push(slen);
            totalLen += slen;
        }
        if (totalLen === 0) return { x: points[0].x, y: points[0].y };

        var targetDist = t * totalLen;
        var accum = 0;
        for (var j = 0; j < segLens.length; j++) {
            if (accum + segLens[j] >= targetDist) {
                var segT = segLens[j] > 0 ? (targetDist - accum) / segLens[j] : 0;
                return {
                    x: points[j].x + (points[j + 1].x - points[j].x) * segT,
                    y: points[j].y + (points[j + 1].y - points[j].y) * segT
                };
            }
            accum += segLens[j];
        }
        return { x: points[points.length - 1].x, y: points[points.length - 1].y };
    }

    /**
     * Build the connection path on ctx (beginPath + moveTo/lineTo/quadraticCurveTo).
     * Matches the exact geometry used by drawConnection for all curve types.
     */
    function buildConnectionPath(ctx, conn, points) {
        ctx.beginPath();
        if (conn.style === 'curved' && points.length === 2) {
            // Simple 2-point bezier curve
            var bmx = (points[0].x + points[1].x) / 2;
            var bmy = (points[0].y + points[1].y) / 2;
            var bdx = points[1].x - points[0].x;
            var bdy = points[1].y - points[0].y;
            var blen = Math.sqrt(bdx * bdx + bdy * bdy);
            var boff = Math.min(40, blen * 0.2);
            var bnx = blen > 0 ? -bdy / blen : 0;
            var bny = blen > 0 ? bdx / blen : 0;
            var bcpx = bmx + bnx * boff;
            var bcpy = bmy + bny * boff;
            ctx.moveTo(points[0].x, points[0].y);
            ctx.quadraticCurveTo(bcpx, bcpy, points[1].x, points[1].y);
        } else if (conn.style === 'curved' && points.length > 2) {
            // Multi-point smooth curve through waypoints
            ctx.moveTo(points[0].x, points[0].y);
            for (var bci = 1; bci < points.length - 1; bci++) {
                var bxc = (points[bci].x + points[bci + 1].x) / 2;
                var byc = (points[bci].y + points[bci + 1].y) / 2;
                ctx.quadraticCurveTo(points[bci].x, points[bci].y, bxc, byc);
            }
            ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        } else {
            // Straight polyline
            ctx.moveTo(points[0].x, points[0].y);
            for (var bli = 1; bli < points.length; bli++) {
                ctx.lineTo(points[bli].x, points[bli].y);
            }
        }
    }

    function drawConnection(ctx, fromNode, toNode, conn, theme, isSelected, editMode, isHovered, animOffset) {
        var fromCx = fromNode.x + fromNode.w / 2;
        var fromCy = fromNode.y + fromNode.h / 2;
        var toCx = toNode.x + toNode.w / 2;
        var toCy = toNode.y + toNode.h / 2;

        // Use anchors if specified, otherwise auto (edge intersection)
        var srcAnchor = conn.sourceAnchor || 'auto';
        var tgtAnchor = conn.targetAnchor || 'auto';
        var srcOff = parseInt(conn.sourceAnchorOffset, 10) || 0;
        var tgtOff = parseInt(conn.targetAnchorOffset, 10) || 0;
        var startPt, endPt;
        if (srcAnchor !== 'auto') {
            startPt = getAnchorPoint(fromNode, srcAnchor, srcOff);
        } else {
            startPt = getEdgeConnectionPoint(fromNode, toCx, toCy);
        }
        if (tgtAnchor !== 'auto') {
            endPt = getAnchorPoint(toNode, tgtAnchor, tgtOff);
        } else {
            endPt = getEdgeConnectionPoint(toNode, fromCx, fromCy);
        }

        var lineColor = conn.color || theme.lineBg;
        var lineWidth = conn.width || 2;

        // Endpoint size scales with line width, with optional override
        var epSize = conn.endpointSize ? parseInt(conn.endpointSize, 10) : Math.round(lineWidth * 3 + 2);

        // Migrate old 'arrow' field
        var startEp = conn.startEndpoint;
        var endEp = conn.endEndpoint;
        if (startEp === undefined && endEp === undefined && conn.arrow) {
            if (conn.arrow === 'forward') { startEp = 'none'; endEp = 'filledArrow'; }
            else if (conn.arrow === 'backward') { startEp = 'filledArrow'; endEp = 'none'; }
            else if (conn.arrow === 'both') { startEp = 'filledArrow'; endEp = 'filledArrow'; }
            else { startEp = 'none'; endEp = 'none'; }
        }
        if (startEp === undefined) startEp = 'none';
        if (endEp === undefined) endEp = 'filledArrow';

        // Build point array: start + waypoints + end
        var waypoints = conn.waypoints || [];
        var points = [startPt];
        for (var wpi = 0; wpi < waypoints.length; wpi++) {
            points.push({ x: waypoints[wpi].x, y: waypoints[wpi].y });
        }
        points.push(endPt);

        // Shorten line at endpoints to avoid overlap with endpoint markers
        var p0 = points[0];
        var p1 = points[1];
        var pLast = points[points.length - 1];
        var pPrev = points[points.length - 2];

        // Shorten start
        if (startEp !== 'none' && points.length >= 2) {
            var sdx = p1.x - p0.x;
            var sdy = p1.y - p0.y;
            var slen = Math.sqrt(sdx * sdx + sdy * sdy);
            if (slen > epSize) {
                var sShorten = epSize * 0.6;
                points[0] = { x: p0.x + sdx / slen * sShorten, y: p0.y + sdy / slen * sShorten };
            }
        }
        // Shorten end
        if (endEp !== 'none' && points.length >= 2) {
            var edx = pPrev.x - pLast.x;
            var edy = pPrev.y - pLast.y;
            var elen = Math.sqrt(edx * edx + edy * edy);
            if (elen > epSize) {
                var eShorten = epSize * 0.6;
                points[points.length - 1] = { x: pLast.x + edx / elen * eShorten, y: pLast.y + edy / elen * eShorten };
            }
        }

        // Draw the path
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = isSelected ? lineWidth + 1.5 : lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Glow effect on hover — but skip if hover-triggered animation is active
        // (animation provides its own visual feedback)
        var hasHoverAnim = isHovered && conn.animationType && conn.animationType !== 'none' && conn.animationTrigger === 'hover' && conn._animActive;
        if (isHovered && !hasHoverAnim) {
            ctx.shadowColor = lineColor;
            ctx.shadowBlur = 16;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.lineWidth += 2;
        }
        var connPattern = conn.strokePattern || (conn.dash ? 'dashed' : 'solid');
        var connDashPattern;
        var connCustomDash = parseInt(conn.strokeDash, 10);
        var connCustomGap = parseInt(conn.strokeGap, 10);
        var connBasePattern = STROKE_PATTERNS[connPattern] || [];
        if ((connCustomDash > 0 || connCustomGap > 0) && connBasePattern.length > 0) {
            connDashPattern = [];
            for (var cdpi = 0; cdpi < connBasePattern.length; cdpi++) {
                if (cdpi % 2 === 0) {
                    connDashPattern.push(connCustomDash > 0 ? connCustomDash : connBasePattern[cdpi]);
                } else {
                    connDashPattern.push(connCustomGap > 0 ? connCustomGap : connBasePattern[cdpi]);
                }
            }
        } else if (connCustomDash > 0 || connCustomGap > 0) {
            connDashPattern = [connCustomDash > 0 ? connCustomDash : 8, connCustomGap > 0 ? connCustomGap : 4];
        } else {
            connDashPattern = connBasePattern;
        }
        ctx.setLineDash(connDashPattern);

        var midX, midY, endAngle, startAngle;

        if (conn.style === 'curved' && points.length === 2) {
            // Simple curve (no waypoints): quadratic bezier
            var mx = (startPt.x + endPt.x) / 2;
            var my2 = (startPt.y + endPt.y) / 2;
            var dx2 = endPt.x - startPt.x;
            var dy2 = endPt.y - startPt.y;
            var len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
            var offset2 = Math.min(40, len2 * 0.2);
            var nx2 = len2 > 0 ? -dy2 / len2 : 0;
            var ny2 = len2 > 0 ? dx2 / len2 : 0;
            var cpx = mx + nx2 * offset2;
            var cpy = my2 + ny2 * offset2;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            ctx.quadraticCurveTo(cpx, cpy, points[1].x, points[1].y);
            ctx.stroke();
            midX = 0.25 * points[0].x + 0.5 * cpx + 0.25 * points[1].x;
            midY = 0.25 * points[0].y + 0.5 * cpy + 0.25 * points[1].y;
            endAngle = Math.atan2(endPt.y - cpy, endPt.x - cpx);
            // Start angle: point FROM start TOWARD first segment (along line, away from node)
            startAngle = Math.atan2(cpy - startPt.y, cpx - startPt.x);
        } else if (conn.style === 'curved' && points.length > 2) {
            // Multi-point smooth curve using quadratic bezier through waypoints
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (var cpi = 1; cpi < points.length - 1; cpi++) {
                var xc = (points[cpi].x + points[cpi + 1].x) / 2;
                var yc = (points[cpi].y + points[cpi + 1].y) / 2;
                ctx.quadraticCurveTo(points[cpi].x, points[cpi].y, xc, yc);
            }
            ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
            ctx.stroke();
            var midIdx = Math.floor(points.length / 2);
            midX = points[midIdx].x;
            midY = points[midIdx].y;
            endAngle = Math.atan2(endPt.y - pPrev.y, endPt.x - pPrev.x);
            startAngle = Math.atan2(p1.y - startPt.y, p1.x - startPt.x);
        } else {
            // Straight polyline through all points
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (var lpi = 1; lpi < points.length; lpi++) {
                ctx.lineTo(points[lpi].x, points[lpi].y);
            }
            ctx.stroke();
            var midIdx2 = Math.floor(points.length / 2);
            midX = (points[midIdx2 - 1].x + points[midIdx2].x) / 2;
            midY = (points[midIdx2 - 1].y + points[midIdx2].y) / 2;
            endAngle = Math.atan2(endPt.y - pPrev.y, endPt.x - pPrev.x);
            startAngle = Math.atan2(p1.y - startPt.y, p1.x - startPt.x);
        }

        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        // Reset glow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // DEFER endpoints and waypoints to be drawn AFTER nodes
        // Store them on the conn object for the deferred pass
        var startFlipped = conn.startFlipped ? true : false;
        var endFlipped = conn.endFlipped ? true : false;

        conn._deferredDraw = {
            endEp: endEp, endPtX: endPt.x, endPtY: endPt.y, endAngle: endAngle, endFlipped: endFlipped,
            startEp: startEp, startPtX: startPt.x, startPtY: startPt.y, startAngle: startAngle, startFlipped: startFlipped,
            epSize: epSize, lineColor: lineColor,
            waypoints: waypoints, isSelected: isSelected, editMode: editMode,
            // Original anchor points (before shortening) for anchor handles
            origStartX: startPt.x, origStartY: startPt.y,
            origEndX: endPt.x, origEndY: endPt.y,
            mouseX: conn._mouseX, mouseY: conn._mouseY
        };

        // Label — deferred to overlay pass, position snapped along path
        if (conn.label) {
            var labelT = conn.labelPosition !== undefined ? parseFloat(conn.labelPosition) : 0.5;
            labelT = Math.max(0, Math.min(1, labelT));
            var labelPt = interpolateConnectionPath(points, conn.style, labelT);
            conn._deferredDraw.label = conn.label;
            conn._deferredDraw.labelX = labelPt.x;
            conn._deferredDraw.labelY = labelPt.y;
            conn._deferredDraw.labelPoints = points;
            conn._deferredDraw.labelStyle = conn.style;
            conn._deferredDraw.labelFontSize = conn.labelFontSize;
            conn._deferredDraw.labelColor = conn.labelColor;
            conn._deferredDraw.labelBgColor = conn.labelBgColor;
            conn._deferredDraw.labelBorderColor = conn.labelBorderColor;
            conn._deferredDraw.labelBorderStyle = conn.labelBorderStyle;
            conn._deferredDraw.labelBorderWidth = conn.labelBorderWidth;
            conn._deferredDraw.labelBorderRadius = conn.labelBorderRadius;
        }

        // Animation overlay (marching-ants or pulse)
        var animType = conn.animationType || 'none';
        var animTrigger = conn.animationTrigger || 'always';
        var animSpeed = conn.animationSpeed || 'medium';

        var speedMap = { slow: 0.5, medium: 1.5, fast: 3.0 };
        var pulseFreqMap = { slow: 0.02, medium: 0.04, fast: 0.08 };

        var isAnimActive = false;
        if (animType !== 'none') {
            if (animTrigger === 'always') {
                isAnimActive = true;
            } else if (animTrigger === 'hover' && conn._animActive) {
                isAnimActive = true;
            } else if (animTrigger === 'click' && conn._animActive) {
                isAnimActive = true;
            }
        }

        var animOff = animOffset || 0;
        if (isAnimActive && animType === 'marching-ants') {
            var marchSpeed = speedMap[animSpeed] || 1.5;
            // Animated dashes using a lighter version of the line color
            ctx.strokeStyle = lightenColor(lineColor, 0.5);
            ctx.lineWidth = Math.max(lineWidth + 1, 3);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.globalAlpha = 0.9;
            // Add subtle glow in the line color
            ctx.shadowBlur = 6;
            ctx.shadowColor = lineColor;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            // Use the connection's stroke pattern, or default marching pattern
            var marchDash = connDashPattern.length > 0 ? connDashPattern : [12, 8];
            ctx.setLineDash(marchDash);
            ctx.lineDashOffset = -(animOff * marchSpeed);
            // Re-draw path matching exact curve geometry
            buildConnectionPath(ctx, conn, points);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            ctx.lineDashOffset = 0;
            ctx.setLineDash([]);
        } else if (isAnimActive && animType === 'pulse') {
            var freq = pulseFreqMap[animSpeed] || 0.04;
            var pulsePhase = Math.sin(animOff * freq);
            // Pulse: line grows and shrinks, with a glow effect
            var pulseWidth = lineWidth + 4 * Math.abs(pulsePhase);
            ctx.globalAlpha = 0.3 + 0.7 * Math.abs(pulsePhase);
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = pulseWidth;
            // Add glow
            ctx.shadowBlur = 8 + 12 * Math.abs(pulsePhase);
            ctx.shadowColor = lineColor;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // Re-draw path matching exact curve geometry
            buildConnectionPath(ctx, conn, points);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            ctx.lineWidth = conn.width || 2;
        }
    }

    // ── Toolbar Drawing ───────────────────────────────────────────

    function drawToolbar(ctx, w, theme, toolbarH, buttons, hoverItem, lockMode, saveFlash, saveError, saveMessage, statusMessage) {
        // Background
        ctx.fillStyle = theme.toolbarBg;
        ctx.fillRect(0, 0, w, toolbarH);

        // Bottom border
        ctx.strokeStyle = theme.toolbarBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, toolbarH - 0.5);
        ctx.lineTo(w, toolbarH - 0.5);
        ctx.stroke();

        // Clear the buttons array and populate
        buttons.length = 0;

        var btnH = 26;
        var btnY = (toolbarH - btnH) / 2;
        var btnPad = 8;
        var btnX = 12;

        var btnDefs = [
            { label: 'Copy Layout', icon: '', action: 'save',       w: 90 },
            { label: '+',     icon: '+',     action: 'addNode',        w: 36 },
            { label: 'T',     icon: 'T',     action: 'addText',         w: 36 },
            { label: '\u2192', icon: '', action: 'addConnection',  w: 36 },
            { label: '\u2715', icon: '', action: 'deleteSelected',  w: 36, tint: 'red' },
            { label: '\u229E', icon: '', action: 'fit',            w: 36 },
            { label: '\u21A9', icon: '', action: 'undo',            w: 28 },
            { label: '\u21AA', icon: '', action: 'redo',            w: 28 },
            { label: '{ }',   icon: '', action: 'code',            w: 40 },
            { label: 'Close', icon: '', action: 'close',           w: 50, tint: 'gray' }
        ];

        for (var i = 0; i < btnDefs.length; i++) {
            var def = btnDefs[i];
            var bw = def.w;
            var isHovered = hoverItem && hoverItem.type === 'button' && hoverItem.index === i;

            // Button background
            roundRect(ctx, btnX, btnY, bw, btnH, 4);
            if (isHovered) {
                ctx.fillStyle = theme.nodeBorder;
            } else {
                ctx.fillStyle = theme.nodeBg;
            }
            ctx.fill();
            ctx.strokeStyle = theme.nodeBorder;
            ctx.lineWidth = 1;
            ctx.stroke();

            // Button text
            ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            if (def.tint === 'red') {
                ctx.fillStyle = '#ef4444';
            } else {
                ctx.fillStyle = theme.text;
            }
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(def.label, btnX + bw / 2, toolbarH / 2);

            buttons.push({
                x: btnX,
                y: btnY,
                w: bw,
                h: btnH,
                label: def.label,
                action: def.action
            });

            btnX += bw + btnPad;
        }

        // Right-aligned label
        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (saveFlash) {
            ctx.fillStyle = '#10b981';
            ctx.fillText(saveMessage || 'SAVED!', w - 12, toolbarH / 2);
        } else if (saveError) {
            ctx.fillStyle = '#ef4444';
            ctx.fillText('SAVE FAILED', w - 12, toolbarH / 2);
        } else if (statusMessage) {
            ctx.fillStyle = '#60a5fa';
            ctx.fillText(statusMessage, w - 12, toolbarH / 2);
        } else {
            ctx.fillStyle = theme.textMuted;
            ctx.fillText('EDIT MODE', w - 12, toolbarH / 2);
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    // ── Resize Handles ─────────────────────────────────────────────

    function getResizeHandles(node) {
        var s = 6;
        return [
            { x: node.x - s / 2, y: node.y - s / 2, w: s, h: s, cursor: 'nwse-resize', corner: 'tl' },
            { x: node.x + node.w - s / 2, y: node.y - s / 2, w: s, h: s, cursor: 'nesw-resize', corner: 'tr' },
            { x: node.x - s / 2, y: node.y + node.h - s / 2, w: s, h: s, cursor: 'nesw-resize', corner: 'bl' },
            { x: node.x + node.w - s / 2, y: node.y + node.h - s / 2, w: s, h: s, cursor: 'nwse-resize', corner: 'br' }
        ];
    }

    function drawResizeHandles(ctx, node, theme) {
        var handles = getResizeHandles(node);
        for (var i = 0; i < handles.length; i++) {
            var hd = handles[i];
            ctx.fillStyle = theme.toolbarBg;
            ctx.fillRect(hd.x, hd.y, hd.w, hd.h);
            ctx.strokeStyle = theme.text;
            ctx.lineWidth = 1;
            ctx.strokeRect(hd.x, hd.y, hd.w, hd.h);
        }
    }
    /**
     * Draw deferred connection overlays (endpoints, waypoints, labels).
     * Called AFTER nodes are drawn so they appear on top.
     */
    function drawConnectionOverlays(ctx, connections, theme) {
        for (var oi = 0; oi < connections.length; oi++) {
            connections[oi]._wpDeleteHits = null; // reset each frame
            var dd = connections[oi]._deferredDraw;
            if (!dd) continue;
            // End endpoint — when flipped, shift outward along line so it doesn't overlap node
            if (dd.endEp !== 'none') {
                var endA = dd.endFlipped ? dd.endAngle + Math.PI : dd.endAngle;
                var edx = dd.endPtX;
                var edy = dd.endPtY;
                if (dd.endFlipped) {
                    edx -= Math.cos(dd.endAngle) * dd.epSize * 0.8;
                    edy -= Math.sin(dd.endAngle) * dd.epSize * 0.8;
                }
                drawEndpoint(ctx, edx, edy, endA, dd.endEp, dd.epSize, dd.lineColor);
            }
            // Start endpoint — when flipped, shift outward along line
            if (dd.startEp !== 'none') {
                var startA = dd.startFlipped ? dd.startAngle : dd.startAngle + Math.PI;
                var sdx = dd.startPtX;
                var sdy = dd.startPtY;
                if (dd.startFlipped) {
                    sdx += Math.cos(dd.startAngle) * dd.epSize * 0.8;
                    sdy += Math.sin(dd.startAngle) * dd.epSize * 0.8;
                }
                drawEndpoint(ctx, sdx, sdy, startA, dd.startEp, dd.epSize, dd.lineColor);
            }
            // Waypoint handles — with clickable delete button on hover
            if (dd.editMode && dd.waypoints && dd.waypoints.length > 0) {
                for (var wph = 0; wph < dd.waypoints.length; wph++) {
                    var wpRadius = dd.isSelected ? 7 : 5;
                    var wpHovered = dd.mouseX !== undefined &&
                        pointInCircle(dd.mouseX, dd.mouseY, dd.waypoints[wph].x, dd.waypoints[wph].y, 16);
                    ctx.beginPath();
                    ctx.arc(dd.waypoints[wph].x, dd.waypoints[wph].y, wpRadius, 0, Math.PI * 2);
                    ctx.fillStyle = wpHovered ? '#ef4444' : (dd.isSelected ? '#3b82f6' : 'rgba(59,130,246,0.5)');
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    // Draw small × delete button above hovered waypoint
                    if (wpHovered) {
                        var delX = dd.waypoints[wph].x + 8;
                        var delY = dd.waypoints[wph].y - 12;
                        ctx.beginPath();
                        ctx.arc(delX, delY, 8, 0, Math.PI * 2);
                        ctx.fillStyle = '#ef4444';
                        ctx.fill();
                        ctx.strokeStyle = '#fff';
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                        ctx.fillStyle = '#fff';
                        ctx.font = 'bold 10px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('\u00D7', delX, delY);
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'alphabetic';
                        // Store delete button hit for click handling
                        if (!connections[oi]._wpDeleteHits) connections[oi]._wpDeleteHits = [];
                        connections[oi]._wpDeleteHits.push({ x: delX, y: delY, r: 8, wpIdx: wph });
                    }
                }
                ctx.lineWidth = 1;
            }
            // Anchor handles on selected connection (draggable circles at start/end)
            if (dd.editMode && dd.isSelected) {
                // Start anchor handle
                ctx.beginPath();
                ctx.arc(dd.origStartX, dd.origStartY, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#f59e0b';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
                // End anchor handle
                ctx.beginPath();
                ctx.arc(dd.origEndX, dd.origEndY, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#f59e0b';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.lineWidth = 1;
                // Store hit rects for anchor dragging
                connections[oi]._startAnchorHit = { x: dd.origStartX, y: dd.origStartY };
                connections[oi]._endAnchorHit = { x: dd.origEndX, y: dd.origEndY };
            }

            // Labels (drawn on top of everything)
            if (dd.label) {
                var lblFontSize = dd.labelFontSize ? parseInt(dd.labelFontSize, 10) : 10;
                ctx.font = lblFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                var lblPad = Math.max(6, lblFontSize * 0.5);
                var lblW = ctx.measureText(dd.label).width + lblPad * 2;
                var lblH = lblFontSize + lblPad;
                var lblX = dd.labelX - lblW / 2;
                var lblY = dd.labelY - lblH / 2;
                var lblRadius = dd.labelBorderRadius ? parseInt(dd.labelBorderRadius, 10) : 3;
                roundRect(ctx, lblX, lblY, lblW, lblH, lblRadius);
                // Background
                ctx.fillStyle = dd.labelBgColor || theme.nodeBg;
                ctx.globalAlpha = dd.labelBgColor ? 1 : 0.9;
                ctx.fill();
                ctx.globalAlpha = 1;
                // Border
                var lblBorderStyle = dd.labelBorderStyle || 'solid';
                var lblBorderW = dd.labelBorderWidth ? parseFloat(dd.labelBorderWidth) : 1;
                if (lblBorderStyle !== 'none' && lblBorderW > 0) {
                    ctx.strokeStyle = dd.labelBorderColor || theme.nodeBorder;
                    ctx.lineWidth = lblBorderW;
                    if (lblBorderStyle === 'dashed') {
                        ctx.setLineDash([4, 3]);
                    } else if (lblBorderStyle === 'dotted') {
                        ctx.setLineDash([2, 2]);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                // Text
                ctx.fillStyle = dd.labelColor || theme.textMuted;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(dd.label, dd.labelX, dd.labelY);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.lineWidth = 1;
                // Store hit rect for label dragging
                connections[oi]._labelHitRect = { x: lblX, y: lblY, w: lblW, h: lblH };
            }
        }
    }
    // ── Tooltip Drawing ─────────────────────────────────────────────

    function drawTooltip(ctx, text, x, y, w, h, isDark) {
        var lines = text.split('\n');
        var lineH = 16;
        var padding = 8;
        var maxW = 0;
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        for (var i = 0; i < lines.length; i++) {
            var lw = ctx.measureText(lines[i]).width;
            if (lw > maxW) maxW = lw;
        }
        var tw = maxW + padding * 2;
        var th = lines.length * lineH + padding * 2;
        var tx = Math.min(x + 12, w - tw - 4);
        var ty = Math.min(y + 12, h - th - 4);
        if (tx < 4) tx = 4;
        if (ty < 4) ty = 4;

        // Draw background
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.95)';
        roundRect(ctx, tx, ty, tw, th, 6);
        ctx.fill();
        ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw text
        ctx.fillStyle = isDark ? '#f1f5f9' : '#1e293b';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        for (var j = 0; j < lines.length; j++) {
            ctx.fillText(lines[j], tx + padding, ty + padding + j * lineH);
        }
        ctx.textBaseline = 'alphabetic';
    }

    // ── Hit Test Helper for Nodes ─────────────────────────────────

    function hitTestNode(px, py, node) {
        var shape = node.shape || 'rect';
        if (shape === 'circle') {
            return pointInCircle(px, py, node.x + node.w / 2, node.y + node.h / 2, Math.min(node.w, node.h) / 2);
        }
        if (shape === 'diamond') {
            return pointInDiamond(px, py, node.x + node.w / 2, node.y + node.h / 2, node.w, node.h);
        }
        if (shape === 'hexagon' || shape === 'triangle' || shape === 'cylinder' || shape === 'cloud' || shape === 'pill') {
            return px >= node.x && px <= node.x + node.w && py >= node.y && py <= node.y + node.h;
        }
        return pointInRect(px, py, node.x, node.y, node.w, node.h);
    }

    // ── Panel Section Builder Helpers ────────────────────────────

    /**
     * createPanelSection(title, summaryText, expanded)
     * Returns a collapsible section div with a clickable header.
     * Attaches ._body and ._summary to the returned element.
     */
    function createPanelSection(title, summaryText, expanded) {
        var isExpanded = (expanded !== false);

        var section = document.createElement('div');
        section.style.cssText = 'border-bottom:1px solid #1e293b;';

        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;padding:6px 10px;background:#1e293b;cursor:pointer;user-select:none;-webkit-user-select:none;';

        var arrow = document.createElement('span');
        arrow.style.cssText = 'font-size:9px;color:#64748b;margin-right:5px;transition:transform 0.15s;display:inline-block;';
        arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';

        var titleEl = document.createElement('span');
        titleEl.style.cssText = 'font-size:11px;font-weight:bold;color:#94a3b8;flex:1;';
        titleEl.textContent = title;

        var summaryEl = document.createElement('span');
        summaryEl.style.cssText = 'font-size:9px;color:#64748b;margin-left:4px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        summaryEl.textContent = summaryText || '';
        summaryEl.style.display = isExpanded ? 'none' : 'inline';

        header.appendChild(arrow);
        header.appendChild(titleEl);
        header.appendChild(summaryEl);

        var body = document.createElement('div');
        body.style.cssText = 'padding:8px 10px;display:' + (isExpanded ? 'block' : 'none') + ';';

        header.addEventListener('click', function() {
            isExpanded = !isExpanded;
            arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
            body.style.display = isExpanded ? 'block' : 'none';
            summaryEl.style.display = isExpanded ? 'none' : 'inline';
        });

        section.appendChild(header);
        section.appendChild(body);

        section._body = body;
        section._summary = summaryEl;

        return section;
    }

    /**
     * createToggleRow(label, options, activeValue, onChange)
     * Returns a label + row of pill-style buttons.
     * options: [{value: 'rect', label: 'Rect'}, ...]
     * onChange called with value when a button is clicked.
     */
    function createToggleRow(label, options, activeValue, onChange) {
        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:8px;';

        var labelEl = document.createElement('div');
        labelEl.style.cssText = 'color:#64748b;font-size:9px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em;';
        labelEl.textContent = label;
        row.appendChild(labelEl);

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

        var buttons = [];

        for (var i = 0; i < options.length; i++) {
            (function(opt) {
                var btn = document.createElement('button');
                var isActive = (opt.value === activeValue);
                btn.textContent = opt.label !== undefined ? opt.label : opt.value;
                btn.style.cssText = 'padding:3px 8px;border-radius:4px;font-size:10px;cursor:pointer;border:1px solid ' +
                    (isActive ? '#3b82f6' : '#334155') + ';background:' +
                    (isActive ? 'rgba(59,130,246,0.2)' : 'transparent') +
                    ';color:' + (isActive ? '#93c5fd' : '#94a3b8') + ';transition:all 0.1s;';
                btn._optValue = opt.value;
                btn._active = isActive;
                buttons.push(btn);

                btn.addEventListener('click', function() {
                    for (var j = 0; j < buttons.length; j++) {
                        var b = buttons[j];
                        var a = (b._optValue === opt.value);
                        b._active = a;
                        b.style.borderColor = a ? '#3b82f6' : '#334155';
                        b.style.background = a ? 'rgba(59,130,246,0.2)' : 'transparent';
                        b.style.color = a ? '#93c5fd' : '#94a3b8';
                    }
                    if (onChange) onChange(opt.value);
                });

                btnRow.appendChild(btn);
            })(options[i]);
        }

        row.appendChild(btnRow);
        return row;
    }

    /**
     * createTextRow(label, value, onChange)
     * Returns a label + text input row.
     * onChange called on blur and Enter key.
     * Stops key propagation to prevent canvas handler capture.
     */
    function createTextRow(label, value, onChange, options) {
        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:8px;';

        var labelEl = document.createElement('div');
        labelEl.style.cssText = 'color:#64748b;font-size:9px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em;';
        labelEl.textContent = label;
        row.appendChild(labelEl);

        var opts = options || {};

        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;align-items:stretch;height:28px;';

        var input = document.createElement('input');
        input.type = 'text';
        input.value = (value !== null && value !== undefined) ? String(value) : '';
        input.style.cssText = 'flex:1;min-width:0;box-sizing:border-box;height:28px;background:#0f172a;border:1px solid #334155;border-radius:' +
            (opts.numeric ? '4px 0 0 4px' : '4px') +
            ';color:#cbd5e1;font-size:11px;padding:0 7px;outline:none;';

        input.addEventListener('focus', function() {
            input.style.borderColor = '#3b82f6';
            input.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.25)';
        });
        input.addEventListener('blur', function() {
            input.style.borderColor = '#334155';
            input.style.boxShadow = 'none';
            if (onChange) onChange(input.value);
        });
        input.addEventListener('keydown', function(e) {
            e.stopPropagation();
            if (e.key === 'Enter' || e.keyCode === 13) {
                input.blur();
            }
        });
        input.addEventListener('keyup', function(e) { e.stopPropagation(); });
        input.addEventListener('keypress', function(e) { e.stopPropagation(); });

        wrapper.appendChild(input);

        if (opts.numeric) {
            var btnCol = document.createElement('div');
            btnCol.style.cssText = 'display:flex;flex-direction:column;height:28px;';

            var upBtn = document.createElement('button');
            upBtn.textContent = '\u25B2';
            upBtn.style.cssText = 'height:14px;width:22px;border:1px solid #334155;border-left:none;' +
                'background:#1e293b;color:#64748b;font-size:5px;cursor:pointer;' +
                'border-radius:0 4px 0 0;padding:0;line-height:1;transition:background 0.15s,color 0.15s;';
            upBtn.addEventListener('mouseenter', function() { upBtn.style.background = '#334155'; upBtn.style.color = '#cbd5e1'; });
            upBtn.addEventListener('mouseleave', function() { upBtn.style.background = '#1e293b'; upBtn.style.color = '#64748b'; });
            upBtn.addEventListener('click', function() {
                var cur = parseFloat(input.value) || 0;
                var step = opts.step || 1;
                var max = opts.max !== undefined ? opts.max : Infinity;
                var next = Math.min(cur + step, max);
                input.value = String(next);
                if (onChange) onChange(String(next));
            });
            upBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

            var downBtn = document.createElement('button');
            downBtn.textContent = '\u25BC';
            downBtn.style.cssText = 'height:14px;width:22px;border:1px solid #334155;border-left:none;border-top:none;' +
                'background:#1e293b;color:#64748b;font-size:5px;cursor:pointer;' +
                'border-radius:0 0 4px 0;padding:0;line-height:1;transition:background 0.15s,color 0.15s;';
            downBtn.addEventListener('mouseenter', function() { downBtn.style.background = '#334155'; downBtn.style.color = '#cbd5e1'; });
            downBtn.addEventListener('mouseleave', function() { downBtn.style.background = '#1e293b'; downBtn.style.color = '#64748b'; });
            downBtn.addEventListener('click', function() {
                var cur = parseFloat(input.value) || 0;
                var step = opts.step || 1;
                var min = opts.min !== undefined ? opts.min : -Infinity;
                var next = Math.max(cur - step, min);
                input.value = String(next);
                if (onChange) onChange(String(next));
            });
            downBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

            btnCol.appendChild(upBtn);
            btnCol.appendChild(downBtn);
            wrapper.appendChild(btnCol);
        }

        row.appendChild(wrapper);
        return row;
    }

    /**
     * createColorRow(label, colors, activeColor, onSelect)
     * Returns a label + color swatches + hex input + native color picker row.
     * onSelect called with hex string when swatch clicked, hex input blurred, or picker used.
     */
    function createColorRow(label, colors, activeColor, onSelect) {
        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:8px;';

        var labelEl = document.createElement('div');
        labelEl.style.cssText = 'color:#64748b;font-size:9px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em;';
        labelEl.textContent = label;
        row.appendChild(labelEl);

        var swatchRow = document.createElement('div');
        swatchRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:5px;';

        var swatches = [];

        function updateSwatches(selectedColor) {
            for (var si = 0; si < swatches.length; si++) {
                var sw = swatches[si];
                var isSelected = (sw._color.toLowerCase() === (selectedColor || '').toLowerCase());
                sw.style.outline = isSelected ? '2px solid #f1f5f9' : '2px solid transparent';
                sw.style.outlineOffset = '1px';
            }
        }

        for (var ci = 0; ci < colors.length; ci++) {
            (function(color) {
                var swatch = document.createElement('div');
                swatch.style.cssText = 'width:16px;height:16px;border-radius:3px;cursor:pointer;flex-shrink:0;background:' + color + ';';
                swatch._color = color;
                swatch.addEventListener('click', function() {
                    hexInput.value = color;
                    updateSwatches(color);
                    if (onSelect) onSelect(color);
                });
                swatch.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                swatchRow.appendChild(swatch);
                swatches.push(swatch);
            })(colors[ci]);
        }

        row.appendChild(swatchRow);

        var inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex;gap:5px;align-items:center;';

        var hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.value = activeColor || '';
        hexInput.style.cssText = 'flex:1;background:#0f172a;border:1px solid #334155;border-radius:4px;color:#cbd5e1;font-size:11px;padding:3px 6px;outline:none;min-width:0;';
        hexInput.placeholder = '#rrggbb(aa)';

        hexInput.addEventListener('focus', function() {
            hexInput.style.borderColor = '#3b82f6';
            hexInput.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.25)';
        });
        hexInput.addEventListener('blur', function() {
            hexInput.style.borderColor = '#334155';
            hexInput.style.boxShadow = 'none';
            var val = hexInput.value.trim();
            if (val && val.charAt(0) !== '#') val = '#' + val;
            if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(val)) {
                updateSwatches(val);
                // Native picker only supports 6-digit hex; update it with the base color
                if (val.length === 9) {
                    colorPicker.value = val.substring(0, 7);
                } else {
                    colorPicker.value = val;
                }
                if (onSelect) onSelect(val);
            }
        });
        hexInput.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        hexInput.addEventListener('keydown', function(e) { e.stopPropagation(); });
        hexInput.addEventListener('keyup', function(e) { e.stopPropagation(); });
        hexInput.addEventListener('keypress', function(e) {
            e.stopPropagation();
            if (e.key === 'Enter' || e.keyCode === 13) { hexInput.blur(); }
        });

        var colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.value = (activeColor && /^#[0-9a-fA-F]{6}/.test(activeColor)) ? activeColor.substring(0, 7) : '#3b82f6';
        colorPicker.style.cssText = 'width:24px;height:24px;border:none;background:none;cursor:pointer;padding:0;border-radius:3px;flex-shrink:0;';

        colorPicker.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); });
        colorPicker.addEventListener('click', function(e) { e.stopPropagation(); });
        colorPicker.addEventListener('focus', function(e) { e.stopPropagation(); });
        colorPicker.addEventListener('input', function() {
            var val = colorPicker.value;
            hexInput.value = val;
            updateSwatches(val);
            if (onSelect) onSelect(val);
        });
        colorPicker.addEventListener('change', function() {
            var val = colorPicker.value;
            hexInput.value = val;
            updateSwatches(val);
            if (onSelect) onSelect(val);
        });

        inputRow.appendChild(hexInput);
        inputRow.appendChild(colorPicker);
        row.appendChild(inputRow);

        updateSwatches(activeColor);

        return row;
    }

    // ══════════════════════════════════════════════════════════════
    // ██ Visualization Object
    // ══════════════════════════════════════════════════════════════

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('business-process-flow-viz');

            // Create canvas
            this.el.style.position = 'relative';
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.touchAction = 'none';
            this.canvas.style.userSelect = 'none';
            this.canvas.style.webkitUserSelect = 'none';
            this.el.appendChild(this.canvas);

            // Edit button — DOM element, always visible when not in edit mode
            this._editBtn = document.createElement('button');
            this._editBtn.textContent = '\u270E Edit';
            this._editBtn.style.cssText = 'position:absolute;bottom:8px;right:8px;z-index:5;height:28px;padding:0 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(30,41,59,0.85);color:rgba(255,255,255,0.7);font:bold 11px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;display:flex;align-items:center;gap:4px;transition:opacity 0.2s;opacity:0.6;';
            var selfBtn = this;
            this._editBtn.addEventListener('mouseenter', function() { selfBtn._editBtn.style.opacity = '1'; });
            this._editBtn.addEventListener('mouseleave', function() { selfBtn._editBtn.style.opacity = '0.6'; });
            this._editBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                selfBtn._editMode = true;
                selfBtn.invalidateUpdateView();
            });
            this._editBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            this.el.appendChild(this._editBtn);

            // --- Properties Panel Shell ---
            var selfPanel = this;
            this._panelCollapsed = false;

            // Panel container (dark default — themed in updateView)
            this._panelEl = document.createElement('div');
            this._panelEl.style.cssText = 'position:absolute;right:0;top:36px;bottom:0;width:280px;background:rgba(15,23,42,0.97);border-left:1px solid #334155;display:none;flex-direction:column;z-index:4;';
            // Stop ALL mouse events from reaching the canvas handlers
            this._panelEl.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            this._panelEl.addEventListener('mouseup', function(e) { e.stopPropagation(); });
            this._panelEl.addEventListener('click', function(e) { e.stopPropagation(); });
            this._panelEl.addEventListener('dblclick', function(e) { e.stopPropagation(); });

            // Panel header
            var panelHeader = document.createElement('div');
            panelHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #334155;flex-shrink:0;';

            var panelTitle = document.createElement('span');
            panelTitle.textContent = 'Properties';
            panelTitle.style.cssText = 'color:#fbbf24;font:bold 12px -apple-system,BlinkMacSystemFont,sans-serif;';
            this._panelTitle = panelTitle;
            panelHeader.appendChild(panelTitle);

            var collapseBtn = document.createElement('button');
            collapseBtn.textContent = '\u00bb';
            collapseBtn.style.cssText = 'background:none;border:none;color:#cbd5e1;font-size:16px;cursor:pointer;padding:0 4px;line-height:1;';
            collapseBtn.addEventListener('click', function() {
                selfPanel._panelCollapsed = true;
                selfPanel.invalidateUpdateView();
            });
            this._panelCollapseBtn = collapseBtn;
            panelHeader.appendChild(collapseBtn);
            this._panelHeader = panelHeader;

            this._panelEl.appendChild(panelHeader);

            // Panel body (scrollable content area)
            this._panelBody = document.createElement('div');
            this._panelBody.style.cssText = 'flex:1;overflow-y:auto;padding:0;';
            this._panelEl.appendChild(this._panelBody);

            this.el.appendChild(this._panelEl);

            // Collapsed strip
            this._panelStrip = document.createElement('div');
            this._panelStrip.style.cssText = 'position:absolute;right:0;top:36px;bottom:0;width:24px;background:rgba(15,23,42,0.97);border-left:1px solid #334155;display:none;flex-direction:column;align-items:center;padding-top:8px;cursor:pointer;z-index:4;';

            var stripIcon = document.createElement('span');
            stripIcon.textContent = '\u00ab';
            stripIcon.style.cssText = 'color:#cbd5e1;font-size:14px;line-height:1;';
            this._panelStripIcon = stripIcon;
            this._panelStrip.appendChild(stripIcon);

            var stripLabel = document.createElement('span');
            stripLabel.textContent = 'Properties';
            stripLabel.style.cssText = 'color:#cbd5e1;font:bold 10px -apple-system,BlinkMacSystemFont,sans-serif;writing-mode:vertical-rl;text-orientation:mixed;margin-top:8px;';
            this._panelStripLabel = stripLabel;
            this._panelStrip.appendChild(stripLabel);

            this._panelStrip.addEventListener('click', function() {
                selfPanel._panelCollapsed = false;
                selfPanel.invalidateUpdateView();
            });

            this.el.appendChild(this._panelStrip);

            // State
            this._lastGoodData = null;
            this._editorState = { nodes: {}, connections: [], lock: false };
            this._editorStateLoaded = false;
            this._saveFlash = false;
            this._saveError = false;
            this._saveMessage = '';
            this._showCodeEditor = false;
            this._codeEditorEl = null;
            this._isDragging = false;
            this._dragNodeId = null;
            this._dragStartX = 0;
            this._dragStartY = 0;
            this._dragNodeStartX = 0;
            this._dragNodeStartY = 0;
            this._didDrag = false;
            this._snapBackPos = null; // {x, y} for view-mode snap-back
            this._pendingToolbarAction = null;
            this._isConnecting = false;
            this._connectFromId = null;
            this._connectFromPort = null;
            this._connectMouseX = 0;
            this._connectMouseY = 0;
            this._isResizing = false;
            this._resizeNodeId = null;
            this._resizeHandle = null;
            this._selectedConnection = null;
            this._selectedNodeIds = [];
            this._isRubberBanding = false;
            this._rubberBandStart = null;
            this._rubberBandEnd = null;
            this._dragNodeStarts = {};
            this._editMode = false;
            this._lockMode = false;
            this._undoStack = [];
            this._redoStack = [];
            this._statusMessage = '';
            this._statusTimeout = null;
            this._isDraggingWaypoint = false;
            this._dragWpConnIdx = null;
            this._dragWpIdx = null;
            this._isDraggingAnchor = false;
            this._dragAnchorConnIdx = null;
            this._dragAnchorEnd = null; // 'start' or 'end'
            this._dragAnchorNode = null; // the node object
            this._isDraggingLabel = false;
            this._dragLabelConnIdx = null;
            this._dragLabelStartX = 0;
            this._dragLabelStartY = 0;
            this._dragLabelOrigOffX = 0;
            this._dragLabelOrigOffY = 0;
            this._hitNodes = [];
            this._hitConnections = [];
            this._hoverItem = null;
            this._sparkHoverNode = null;
            this._sparkHoverIdx = -1;
            this._mouseX = 0;
            this._mouseY = 0;
            this._toolbarButtons = [];
            this._computedNodes = [];
            this._computedNodeMap = {};
            this._computedConnections = [];
            this._showNodePopup = false;
            this._nodePopupId = null;
            this._nodePopupHits = [];
            this._nodePopupRect = null;
            this._showConnPopup = false;
            this._connPopupIdx = null;
            this._connPopupHits = [];
            this._connPopupPos = { x: 0, y: 0 };
            this._connPopupRect = null;
            this._resizeStartX = 0;
            this._resizeStartY = 0;
            this._resizeStartNodeX = 0;
            this._resizeStartNodeY = 0;
            this._resizeStartNodeW = 0;
            this._resizeStartNodeH = 0;
            this._editBtnRect = null;
            this._gridEnabled = true;
            this._gridSize = 20;
            this._snapEnabled = false;
            this._panX = 0;
            this._panY = 0;
            this._isPanning = false;
            this._spaceHeld = false;
            this._animationFrame = null;
            this._animationOffset = 0;
            this._lastAnimTime = 0;
            this._hasActiveAnimations = false;

            var self = this;

            // ── localStorage key for caching ──
            this._getStorageKey = function() {
                var path = window.location.pathname.replace(/\/+$/, '');
                var segments = path.split('/');
                var dashName = segments[segments.length - 1] || 'default';
                var appName = '';
                for (var si = 0; si < segments.length; si++) {
                    if (segments[si] === 'app' && si + 1 < segments.length) {
                        appName = segments[si + 1];
                        break;
                    }
                }
                return 'bpf_' + appName + '_' + dashName;
            };

            // ── Write editorState to formatter DOM ──
            // ── Save: localStorage + try formatter textarea ──
            this._saveEditorState = function() {
                // Migrate legacy `dash` boolean to `strokePattern` string
                var es = self._editorState;
                if (es && es.connections) {
                    for (var sci = 0; sci < es.connections.length; sci++) {
                        var sc = es.connections[sci];
                        if (sc.dash !== undefined && !sc.strokePattern) {
                            sc.strokePattern = sc.dash ? 'dashed' : 'solid';
                        }
                        delete sc.dash;
                    }
                }
                var stateJson = JSON.stringify(self._editorState);
                // 1. Save to localStorage
                try { localStorage.setItem(self._getStorageKey(), stateJson); } catch(e) {}
                // 2. Try to update formatter textarea (works if panel is open in edit mode)
                var ns = '';
                try { ns = self.getPropertyNamespaceInfo().propertyNamespace; } catch(e) {}
                var settingName = ns + 'editorState';
                var textAreas = document.querySelectorAll('splunk-text-area, textarea');
                for (var i = 0; i < textAreas.length; i++) {
                    var ta = textAreas[i];
                    if ((ta.getAttribute('name') || '') === settingName) {
                        if (ta.tagName.toLowerCase() === 'splunk-text-area') {
                            ta.setAttribute('value', stateJson);
                            var inner = ta.querySelector('textarea');
                            if (inner) inner.value = stateJson;
                        } else {
                            ta.value = stateJson;
                        }
                        var evt = document.createEvent('Event');
                        evt.initEvent('change', true, true);
                        ta.dispatchEvent(evt);
                        break;
                    }
                }
                // 3. Copy to clipboard (fallback method for broader compatibility)
                try {
                    var copyArea = document.createElement('textarea');
                    copyArea.value = stateJson;
                    copyArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
                    document.body.appendChild(copyArea);
                    copyArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(copyArea);
                } catch(e) { /* ignore */ }
                // 4. Visual feedback — show "SAVED! Paste into Layout Data"
                self._saveFlash = true;
                self._saveMessage = 'Copied to clipboard!';
                self.invalidateUpdateView();
                setTimeout(function() {
                    self._saveFlash = false;
                    self._saveMessage = '';
                    self.invalidateUpdateView();
                }, 3000);
            };

            // ── Undo/Redo system ──
            this._pushUndo = function() {
                self._undoStack.push(JSON.stringify(self._editorState));
                if (self._undoStack.length > 50) self._undoStack.shift();
                self._redoStack = []; // clear redo on new action
            };

            this._undo = function() {
                if (self._undoStack.length === 0) {
                    self._showStatus('Nothing to undo');
                    return;
                }
                self._redoStack.push(JSON.stringify(self._editorState));
                var prev = self._undoStack.pop();
                try {
                    self._editorState = JSON.parse(prev);
                } catch(e) { /* ignore */ }
                self.invalidateUpdateView();
                // Rebuild panel so closures capture the restored _editorState,
                // otherwise changes made after undo write to the stale object.
                self._updatePanel();
                self._showStatus('Undo');
            };

            this._redo = function() {
                if (self._redoStack.length === 0) {
                    self._showStatus('Nothing to redo');
                    return;
                }
                self._undoStack.push(JSON.stringify(self._editorState));
                var next = self._redoStack.pop();
                try {
                    self._editorState = JSON.parse(next);
                } catch(e) { /* ignore */ }
                self.invalidateUpdateView();
                // Rebuild panel so closures capture the restored _editorState.
                self._updatePanel();
                self._showStatus('Redo');
            };

            this._showStatus = function(msg) {
                self._statusMessage = msg;
                self.invalidateUpdateView();
                if (self._statusTimeout) clearTimeout(self._statusTimeout);
                self._statusTimeout = setTimeout(function() {
                    self._statusMessage = '';
                    self.invalidateUpdateView();
                }, 1500);
            };

            // ── Delete selected element ──
            this._deleteSelected = function() {
                // 1. Check waypoint under cursor
                var edcWp = self._editorState.connections || [];
                for (var dwci = 0; dwci < edcWp.length; dwci++) {
                    var dwps = edcWp[dwci].waypoints;
                    if (!dwps) continue;
                    for (var dwpi = 0; dwpi < dwps.length; dwpi++) {
                        if (pointInCircle(self._mouseX - self._panX, self._mouseY - self._panY, dwps[dwpi].x, dwps[dwpi].y, 16)) {
                            self._pushUndo();
                            dwps.splice(dwpi, 1);
                            if (dwps.length === 0) delete edcWp[dwci].waypoints;
                            self.invalidateUpdateView();
                            self._showStatus('Waypoint deleted');
                            return;
                        }
                    }
                }
                // 2. Delete selected connection
                if (self._selectedConnection !== null && self._connPopupIdx !== null) {
                    self._pushUndo();
                    var delConns = self._editorState.connections || [];
                    if (self._connPopupIdx >= 0 && self._connPopupIdx < delConns.length) {
                        delConns.splice(self._connPopupIdx, 1);
                    }
                    self._selectedConnection = null;
                    self._showConnPopup = false;
                    self._connPopupIdx = null;
                    self.invalidateUpdateView();
                    self._showStatus('Connection deleted');
                    return;
                }
                // 3. Delete selected manual node(s)
                if (self._selectedNodeIds.length > 0) {
                    var anyDeleted = false;
                    var anyBlocked = false;
                    for (var sdi = 0; sdi < self._selectedNodeIds.length; sdi++) {
                        var delId = self._selectedNodeIds[sdi];
                        var selN = self._editorState.nodes[delId];
                        if (selN && selN.manual) {
                            if (!anyDeleted) { self._pushUndo(); }
                            delete self._editorState.nodes[delId];
                            var kc = [];
                            var ac = self._editorState.connections || [];
                            for (var kci = 0; kci < ac.length; kci++) {
                                if (ac[kci].from !== delId && ac[kci].to !== delId) {
                                    kc.push(ac[kci]);
                                }
                            }
                            self._editorState.connections = kc;
                            anyDeleted = true;
                        } else {
                            anyBlocked = true;
                        }
                    }
                    self._selectedNodeIds = [];
                    self._showNodePopup = false;
                    self.invalidateUpdateView();
                    if (anyDeleted && anyBlocked) {
                        self._showStatus('Manual nodes deleted; data-driven nodes skipped');
                    } else if (anyDeleted) {
                        self._showStatus('Node(s) deleted');
                    } else {
                        self._showStatus('Cannot delete data-driven node');
                    }
                    return;
                }
                self._showStatus('Nothing selected');
            };

            // ── Execute toolbar action ──
            this._executeToolbarAction = function(action) {
                if (action === 'save') {
                    self._saveEditorState();
                    return;
                } else if (action === 'addNode') {
                    // Create a new manual node at center of visible canvas
                    var newId = 'manual_' + Date.now();
                    var rect = self.canvas.getBoundingClientRect();
                    var cx = (rect.width / 2 - 90) - self._panX;
                    var cy = (rect.height / 2 - 60) - self._panY;
                    self._editorState.nodes[newId] = {
                        x: cx,
                        y: cy,
                        w: 180,
                        h: 120,
                        shape: 'rect',
                        label: 'New Node',
                        manual: true,
                        color: ''
                    };
                    self.invalidateUpdateView();
                } else if (action === 'addText') {
                    // Create a new textbox (markdown) node at center of visible canvas
                    var textNodeId = '_text_' + Date.now();
                    var tRect = self.canvas.getBoundingClientRect();
                    var tCx = (tRect.width / 2 - 100) - self._panX;
                    var tCy = (tRect.height / 2 - 60) - self._panY;
                    if (!self._editorState.nodes[textNodeId]) self._editorState.nodes[textNodeId] = {};
                    self._editorState.nodes[textNodeId].manual = true;
                    self._editorState.nodes[textNodeId].shape = 'textbox';
                    self._editorState.nodes[textNodeId].label = textNodeId;
                    self._editorState.nodes[textNodeId].markdownContent = '## Title\n\nDescription text here';
                    self._editorState.nodes[textNodeId].x = tCx;
                    self._editorState.nodes[textNodeId].y = tCy;
                    self._editorState.nodes[textNodeId].w = 200;
                    self._editorState.nodes[textNodeId].h = 120;
                    self._pushUndo();
                    self.invalidateUpdateView();
                } else if (action === 'addConnection') {
                    // Start connection mode — user picks from/to nodes
                    self._isConnecting = true;
                    self._connectFromId = null;
                    self.canvas.style.cursor = 'crosshair';
                } else if (action === 'delete') {
                    // Delete selected connection using popup index
                    if (self._selectedConnection !== null && self._connPopupIdx !== null) {
                        var eConns = self._editorState.connections || [];
                        if (self._connPopupIdx >= 0 && self._connPopupIdx < eConns.length) {
                            eConns.splice(self._connPopupIdx, 1);
                        }
                        self._selectedConnection = null;
                        self._connPopupIdx = null;
                        self._showConnPopup = false;
                        self.invalidateUpdateView();
                    } else if (self._selectedNodeIds.length > 0) {
                        self._pushUndo();
                        for (var tdi = 0; tdi < self._selectedNodeIds.length; tdi++) {
                            var tdId = self._selectedNodeIds[tdi];
                            var delNode = self._editorState.nodes[tdId];
                            // Only delete manual nodes
                            if (delNode && delNode.manual === true) {
                                delete self._editorState.nodes[tdId];
                                // Remove connections involving this node
                                var filteredConns = [];
                                var conns = self._editorState.connections || [];
                                for (var dci = 0; dci < conns.length; dci++) {
                                    if (conns[dci].from !== tdId && conns[dci].to !== tdId) {
                                        filteredConns.push(conns[dci]);
                                    }
                                }
                                self._editorState.connections = filteredConns;
                            }
                        }
                        self._selectedNodeIds = [];
                        self._showNodePopup = false;
                        self.invalidateUpdateView();
                    }
                } else if (action === 'fit') {
                    // Reset pan offset
                    self._panX = 0;
                    self._panY = 0;
                    // Fit all nodes within canvas
                    var fitNodes = self._computedNodes;
                    if (fitNodes.length === 0) return;
                    var fitRect = self.canvas.getBoundingClientRect();
                    var fitW = fitRect.width;
                    var fitH = fitRect.height;
                    var fitToolbarH = self._editMode ? 36 : 0;
                    var fitPad = 40;
                    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (var fi2 = 0; fi2 < fitNodes.length; fi2++) {
                        var fn = fitNodes[fi2];
                        if (fn.x < minX) minX = fn.x;
                        if (fn.y < minY) minY = fn.y;
                        if (fn.x + fn.w > maxX) maxX = fn.x + fn.w;
                        if (fn.y + fn.h > maxY) maxY = fn.y + fn.h;
                    }
                    var bboxW = maxX - minX;
                    var bboxH = maxY - minY;
                    if (bboxW <= 0) bboxW = 1;
                    if (bboxH <= 0) bboxH = 1;
                    var scaleX = (fitW - fitPad * 2) / bboxW;
                    var scaleY = (fitH - fitToolbarH - fitPad * 2) / bboxH;
                    var fitScale = Math.min(scaleX, scaleY, 1);
                    for (var fi3 = 0; fi3 < fitNodes.length; fi3++) {
                        var fn2 = fitNodes[fi3];
                        var newFx = fitPad + (fn2.x - minX) * fitScale;
                        var newFy = fitPad + fitToolbarH + (fn2.y - minY) * fitScale;
                        if (!self._editorState.nodes[fn2.id]) {
                            self._editorState.nodes[fn2.id] = {};
                        }
                        self._editorState.nodes[fn2.id].x = newFx;
                        self._editorState.nodes[fn2.id].y = newFy;
                    }
                    self.invalidateUpdateView();
                } else if (action === 'undo') {
                    self._undo();
                } else if (action === 'redo') {
                    self._redo();
                } else if (action === 'deleteSelected') {
                    self._deleteSelected();
                } else if (action === 'code') {
                    self._showCodeEditor = !self._showCodeEditor;
                    self._updateCodeEditor();
                } else if (action === 'close') {
                    // Close edit mode
                    self._editMode = false;
                    self._showCodeEditor = false;
                    if (self._codeEditorEl) self._codeEditorEl.style.display = 'none';
                    self._selectedNodeIds = [];
                    self._selectedConnection = null;
                    self._showNodePopup = false;
                    self._showConnPopup = false;
                    self._isConnecting = false;
                    self.invalidateUpdateView();
                }
            };

            // ── Code Editor (DOM-based with syntax highlighting) ──
            this._updateCodeEditor = function() {
                if (self._showCodeEditor) {
                    if (!self._codeEditorEl) {
                        // Create code editor container
                        var wrap = document.createElement('div');
                        wrap.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:40%;background:#0f172a;border-top:2px solid #3b82f6;display:flex;flex-direction:column;z-index:5;font-family:monospace;';

                        // Header
                        var hdr = document.createElement('div');
                        hdr.style.cssText = 'padding:4px 12px;background:#1e293b;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;border-bottom:1px solid #334155;gap:6px;';
                        var hdrLabel = document.createElement('span');
                        hdrLabel.textContent = 'Layout JSON';
                        hdrLabel.style.cssText = 'color:#94a3b8;font-size:11px;font-weight:bold;font-family:sans-serif;';

                        var hdrBtns = document.createElement('div');
                        hdrBtns.style.cssText = 'display:flex;gap:4px;align-items:center;';

                        // Size preset buttons: S / M / L / Max
                        var sizeDefs = [
                            {label: 'S', height: '20%'},
                            {label: 'M', height: '40%'},
                            {label: 'L', height: '60%'},
                            {label: 'Max', height: '85%'}
                        ];
                        for (var szi = 0; szi < sizeDefs.length; szi++) {
                            (function(sd) {
                                var sBtn = document.createElement('button');
                                sBtn.textContent = sd.label;
                                sBtn.style.cssText = 'padding:2px 6px;background:#334155;color:#94a3b8;border:none;border-radius:3px;font-size:9px;cursor:pointer;font-family:sans-serif;';
                                sBtn.addEventListener('click', function() { wrap.style.height = sd.height; });
                                sBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                                hdrBtns.appendChild(sBtn);
                            })(sizeDefs[szi]);
                        }

                        var applyBtn = document.createElement('button');
                        applyBtn.textContent = 'Apply';
                        applyBtn.style.cssText = 'padding:2px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-family:sans-serif;';

                        hdrBtns.appendChild(applyBtn);
                        hdr.appendChild(hdrLabel);
                        hdr.appendChild(hdrBtns);

                        // Editor area with overlay for syntax highlighting
                        var editorWrap = document.createElement('div');
                        editorWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';

                        // Highlighted pre (behind textarea)
                        var pre = document.createElement('pre');
                        pre.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;margin:0;padding:8px 12px;overflow:auto;font-size:12px;line-height:1.5;color:#cbd5e1;white-space:pre-wrap;word-wrap:break-word;pointer-events:none;background:transparent;';

                        // Transparent textarea (on top, captures input)
                        var ta = document.createElement('textarea');
                        ta.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;margin:0;padding:8px 12px;font-size:12px;line-height:1.5;font-family:monospace;color:transparent;caret-color:#e2e8f0;background:transparent;border:none;outline:none;resize:none;white-space:pre-wrap;word-wrap:break-word;overflow:auto;';
                        ta.spellcheck = false;

                        editorWrap.appendChild(pre);
                        editorWrap.appendChild(ta);
                        wrap.appendChild(hdr);
                        wrap.appendChild(editorWrap);
                        self.el.appendChild(wrap);

                        self._codeEditorEl = wrap;
                        self._codePre = pre;
                        self._codeTa = ta;

                        // Sync scroll between textarea and pre
                        ta.addEventListener('scroll', function() {
                            pre.scrollTop = ta.scrollTop;
                            pre.scrollLeft = ta.scrollLeft;
                        });

                        // Live syntax highlighting on input
                        ta.addEventListener('input', function() {
                            self._highlightJson(pre, ta.value);
                        });

                        // Apply button — parse JSON and update editorState
                        applyBtn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            try {
                                var parsed = JSON.parse(ta.value);
                                if (parsed && typeof parsed === 'object') {
                                    self._editorState = parsed;
                                    if (!self._editorState.nodes) self._editorState.nodes = {};
                                    if (!self._editorState.connections) self._editorState.connections = [];
                                    // Do NOT reset _editorStateLoaded — that would
                                    // cause updateView to reload old state from config
                                    self.invalidateUpdateView();
                                    // Rebuild panel so closures capture the new _editorState;
                                    // otherwise changes made after Apply write to the stale object.
                                    self._updatePanel();
                                    hdrLabel.textContent = 'Layout JSON \u2714 Applied';
                                    hdrLabel.style.color = '#10b981';
                                    setTimeout(function() {
                                        hdrLabel.textContent = 'Layout JSON';
                                        hdrLabel.style.color = '#94a3b8';
                                    }, 1500);
                                }
                            } catch(pe) {
                                hdrLabel.textContent = 'Layout JSON \u2716 Invalid JSON';
                                hdrLabel.style.color = '#ef4444';
                                setTimeout(function() {
                                    hdrLabel.textContent = 'Layout JSON';
                                    hdrLabel.style.color = '#94a3b8';
                                }, 2000);
                            }
                        });

                        // Prevent canvas mouse handlers from interfering
                        wrap.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                        wrap.addEventListener('mousemove', function(e) { e.stopPropagation(); });
                        wrap.addEventListener('mouseup', function(e) { e.stopPropagation(); });
                    }
                    // Update content
                    var json = JSON.stringify(self._editorState, null, 2);
                    self._codeTa.value = json;
                    self._highlightJson(self._codePre, json);
                    self._codeEditorEl.style.display = 'flex';
                } else {
                    if (self._codeEditorEl) {
                        self._codeEditorEl.style.display = 'none';
                    }
                }
            };

            // ── JSON Syntax Highlighting ──
            this._highlightJson = function(pre, json) {
                // Escape HTML first
                var escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                // Apply syntax colors — bright colors for dark background
                var highlighted = escaped.replace(
                    /("(?:\\.|[^"\\])*")\s*:/g,
                    '<span style="color:#38bdf8;">$1</span>:'  // keys: bright sky blue
                ).replace(
                    /:\s*("(?:\\.|[^"\\])*")/g,
                    ': <span style="color:#4ade80;">$1</span>'  // string values: bright green
                ).replace(
                    /:\s*(-?\d+\.?\d*)/g,
                    ': <span style="color:#fb923c;">$1</span>'  // numbers: bright orange
                ).replace(
                    /:\s*(true|false)/g,
                    ': <span style="color:#c084fc;">$1</span>'  // booleans: purple
                ).replace(
                    /:\s*(null)/g,
                    ': <span style="color:#94a3b8;">$1</span>'  // null: gray
                );
                pre.innerHTML = highlighted;
            };

            // ── Mouse Down ──
            this._onMouseDown = function(e) {
                // Don't process canvas clicks if a DOM panel element was clicked
                if (e.target !== self.canvas) return;
                var rect = self.canvas.getBoundingClientRect();
                var rawMx = e.clientX - rect.left;
                var rawMy = e.clientY - rect.top;
                var mx = rawMx - self._panX;
                var my = rawMy - self._panY;
                self._mouseX = rawMx;
                self._mouseY = rawMy;
                self._didDrag = false;
                self._pendingToolbarAction = null;

                // Space+drag panning
                if (self._spaceHeld && !self._isDragging && !self._isResizing && !self._isDraggingWaypoint && !self._isDraggingAnchor && !self._isDraggingLabel) {
                    self._isPanning = true;
                    self._panStartX = e.clientX;
                    self._panStartY = e.clientY;
                    self.canvas.style.cursor = 'grabbing';
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                // In modal edit mode, prevent event leaking
                if (self._editMode) {
                    e.preventDefault();
                    e.stopPropagation();
                }

                if (self._editMode) {
                    // Check toolbar buttons (use raw coordinates — toolbar is not panned)
                    for (var bi = 0; bi < self._toolbarButtons.length; bi++) {
                        var btn = self._toolbarButtons[bi];
                        if (pointInRect(rawMx, rawMy, btn.x, btn.y, btn.w, btn.h)) {
                            self._pendingToolbarAction = btn.action;
                            return;
                        }
                    }

                    // Check node popup hits
                    if (self._showNodePopup && self._nodePopupRect) {
                        if (pointInRect(mx, my, self._nodePopupRect.x, self._nodePopupRect.y, self._nodePopupRect.w, self._nodePopupRect.h)) {
                            // Check individual popup hit areas
                            for (var nph = 0; nph < self._nodePopupHits.length; nph++) {
                                var nHit = self._nodePopupHits[nph];
                                if (pointInRect(mx, my, nHit.x, nHit.y, nHit.w, nHit.h)) {
                                    var popNodeId = self._nodePopupId;
                                    if (!self._editorState.nodes[popNodeId]) {
                                        self._editorState.nodes[popNodeId] = {};
                                    }
                                    self._pushUndo();
                                    if (nHit.type === 'shape') {
                                        self._editorState.nodes[popNodeId].shape = nHit.value;
                                        self.invalidateUpdateView();
                                    } else if (nHit.type === 'color') {
                                        self._editorState.nodes[popNodeId].color = nHit.value;
                                        self.invalidateUpdateView();
                                    } else if (nHit.type === 'hideValue') {
                                        if (nHit.value) {
                                            self._editorState.nodes[popNodeId].hideValue = true;
                                        } else {
                                            delete self._editorState.nodes[popNodeId].hideValue;
                                        }
                                        self.invalidateUpdateView();
                                    } else if (nHit.type === 'sparklineType' || nHit.type === 'fontSize' ||
                                               nHit.type === 'chartHeight' || nHit.type === 'opacity' ||
                                               nHit.type === 'borderWidth' || nHit.type === 'sparkPosition') {
                                        if (nHit.value === 'default') {
                                            delete self._editorState.nodes[popNodeId][nHit.type];
                                        } else {
                                            self._editorState.nodes[popNodeId][nHit.type] = nHit.value;
                                        }
                                        self.invalidateUpdateView();
                                    } else if (nHit.type === 'addCondition') {
                                        if (!self._editorState.nodes[popNodeId].conditions) {
                                            self._editorState.nodes[popNodeId].conditions = [];
                                        }
                                        self._editorState.nodes[popNodeId].conditions.push({
                                            op: '>=', val: '0', color: '#22c55e'
                                        });
                                        self.invalidateUpdateView();
                                    } else if (nHit.type === 'deleteCondition') {
                                        var condArr = self._editorState.nodes[popNodeId].conditions;
                                        if (condArr && nHit.value >= 0 && nHit.value < condArr.length) {
                                            condArr.splice(nHit.value, 1);
                                            if (condArr.length === 0) delete self._editorState.nodes[popNodeId].conditions;
                                        }
                                        self.invalidateUpdateView();
                                    } else if (nHit.type === 'editCondition') {
                                        // Open a prompt-style input for editing the condition
                                        var condArr2 = self._editorState.nodes[popNodeId].conditions;
                                        if (condArr2 && condArr2[nHit.value]) {
                                            var cond = condArr2[nHit.value];
                                            // Create inline editor: op | val | color
                                            var condWrap = document.createElement('div');
                                            condWrap.style.cssText = 'position:absolute;z-index:9999;display:flex;gap:4px;align-items:center;';
                                            var condRect = self.canvas.getBoundingClientRect();
                                            condWrap.style.left = (condRect.left + nHit.x) + 'px';
                                            condWrap.style.top = (condRect.top + nHit.y) + 'px';

                                            var opSel = document.createElement('select');
                                            opSel.style.cssText = 'font-size:11px;background:#1e293b;color:#f1f5f9;border:1px solid #3b82f6;border-radius:3px;padding:1px;height:20px;';
                                            var ops = ['<', '<=', '>', '>=', '=', '!=', 'contains'];
                                            for (var opi = 0; opi < ops.length; opi++) {
                                                var opt = document.createElement('option');
                                                opt.value = ops[opi];
                                                opt.textContent = ops[opi];
                                                if (ops[opi] === cond.op) opt.selected = true;
                                                opSel.appendChild(opt);
                                            }

                                            var valInp = document.createElement('input');
                                            valInp.type = 'text';
                                            valInp.value = cond.val || '';
                                            valInp.placeholder = 'value';
                                            valInp.style.cssText = 'width:60px;font-size:11px;background:#1e293b;color:#f1f5f9;border:1px solid #3b82f6;border-radius:3px;padding:0 4px;height:20px;';

                                            var colInp = document.createElement('input');
                                            colInp.type = 'color';
                                            colInp.value = cond.color || '#22c55e';
                                            colInp.style.cssText = 'width:24px;height:20px;border:none;padding:0;cursor:pointer;';

                                            var okBtn = document.createElement('button');
                                            okBtn.textContent = '\u2713';
                                            okBtn.style.cssText = 'font-size:12px;background:#10b981;color:#fff;border:none;border-radius:3px;width:22px;height:20px;cursor:pointer;';

                                            condWrap.appendChild(opSel);
                                            condWrap.appendChild(valInp);
                                            condWrap.appendChild(colInp);
                                            condWrap.appendChild(okBtn);
                                            document.body.appendChild(condWrap);
                                            valInp.focus();

                                            var condNodeId = popNodeId;
                                            var condIdx = nHit.value;
                                            var condDone = false;
                                            function finishCondEdit() {
                                                if (condDone) return;
                                                condDone = true;
                                                var ca = self._editorState.nodes[condNodeId].conditions;
                                                if (ca && ca[condIdx]) {
                                                    ca[condIdx].op = opSel.value;
                                                    ca[condIdx].val = valInp.value;
                                                    ca[condIdx].color = colInp.value;
                                                }
                                                if (condWrap.parentNode) condWrap.parentNode.removeChild(condWrap);
                                                self.invalidateUpdateView();
                                            }
                                            okBtn.addEventListener('click', function(ce) {
                                                ce.stopPropagation();
                                                finishCondEdit();
                                            });
                                            valInp.addEventListener('keydown', function(cke) {
                                                if (cke.key === 'Enter') finishCondEdit();
                                            });
                                            // Stop events from reaching canvas
                                            condWrap.addEventListener('mousedown', function(ce) { ce.stopPropagation(); });
                                        }
                                    } else if (nHit.type === 'colorHex') {
                                        // Open native OS color picker
                                        var hexVal = (self._editorState.nodes[popNodeId] && self._editorState.nodes[popNodeId].color) || '#3b82f6';
                                        // Ensure valid hex for input[type=color] (must be #rrggbb)
                                        if (hexVal.length === 4) hexVal = '#' + hexVal[1] + hexVal[1] + hexVal[2] + hexVal[2] + hexVal[3] + hexVal[3];
                                        if (!/^#[0-9a-fA-F]{6}$/.test(hexVal)) hexVal = '#3b82f6';
                                        var cpInp = document.createElement('input');
                                        cpInp.type = 'color';
                                        cpInp.value = hexVal;
                                        cpInp.style.cssText = 'position:absolute;z-index:9999;opacity:0;width:1px;height:1px;';
                                        var cpRect = self.canvas.getBoundingClientRect();
                                        cpInp.style.left = (cpRect.left + nHit.x) + 'px';
                                        cpInp.style.top = (cpRect.top + nHit.y) + 'px';
                                        document.body.appendChild(cpInp);
                                        var cpNodeId = popNodeId;
                                        cpInp.addEventListener('input', function() {
                                            if (!self._editorState.nodes[cpNodeId]) self._editorState.nodes[cpNodeId] = {};
                                            self._editorState.nodes[cpNodeId].color = cpInp.value;
                                            self.invalidateUpdateView();
                                        });
                                        cpInp.addEventListener('change', function() {
                                            if (!self._editorState.nodes[cpNodeId]) self._editorState.nodes[cpNodeId] = {};
                                            self._editorState.nodes[cpNodeId].color = cpInp.value;
                                            if (cpInp.parentNode) cpInp.parentNode.removeChild(cpInp);
                                            self.invalidateUpdateView();
                                        });
                                        cpInp.addEventListener('blur', function() {
                                            setTimeout(function() {
                                                if (cpInp.parentNode) cpInp.parentNode.removeChild(cpInp);
                                            }, 200);
                                        });
                                        cpInp.click();
                                    } else if (nHit.type === 'prefix' || nHit.type === 'suffix') {
                                        // Create temporary input for prefix/suffix editing
                                        var psField = nHit.type;
                                        var psValue = (self._editorState.nodes[popNodeId] && self._editorState.nodes[popNodeId][psField]) || '';
                                        var psInp = document.createElement('input');
                                        psInp.type = 'text';
                                        psInp.value = psValue;
                                        psInp.placeholder = psField === 'prefix' ? 'e.g. $, errors:' : 'e.g. %, events, /s';
                                        psInp.style.cssText = 'position:absolute;z-index:9999;font-size:11px;border:1px solid #3b82f6;padding:0 4px;height:18px;background:#1e293b;color:#f1f5f9;border-radius:3px;';
                                        var psRect = self.canvas.getBoundingClientRect();
                                        psInp.style.left = (psRect.left + nHit.x) + 'px';
                                        psInp.style.top = (psRect.top + nHit.y) + 'px';
                                        psInp.style.width = nHit.w + 'px';
                                        document.body.appendChild(psInp);
                                        psInp.focus();
                                        psInp.select();
                                        var psDone = false;
                                        var psNodeId = popNodeId;
                                        function finishPsEdit() {
                                            if (psDone) return;
                                            psDone = true;
                                            if (psInp.value) {
                                                self._editorState.nodes[psNodeId][psField] = psInp.value;
                                            } else {
                                                delete self._editorState.nodes[psNodeId][psField];
                                            }
                                            if (psInp.parentNode) psInp.parentNode.removeChild(psInp);
                                            self.invalidateUpdateView();
                                        }
                                        psInp.addEventListener('blur', finishPsEdit);
                                        psInp.addEventListener('keydown', function(pke) {
                                            if (pke.key === 'Enter') finishPsEdit();
                                        });
                                    } else if (nHit.type === 'label') {
                                        // Create temporary input for label editing
                                        var popNode = null;
                                        for (var pni = 0; pni < self._computedNodes.length; pni++) {
                                            if (self._computedNodes[pni].id === popNodeId) {
                                                popNode = self._computedNodes[pni];
                                                break;
                                            }
                                        }
                                        var currentLabel = (self._editorState.nodes[popNodeId] && self._editorState.nodes[popNodeId].label) || (popNode ? popNode.label : '');
                                        var inp = document.createElement('input');
                                        inp.type = 'text';
                                        inp.value = currentLabel;
                                        inp.style.position = 'absolute';
                                        var canvasRect = self.canvas.getBoundingClientRect();
                                        inp.style.left = (canvasRect.left + nHit.x) + 'px';
                                        inp.style.top = (canvasRect.top + nHit.y) + 'px';
                                        inp.style.width = nHit.w + 'px';
                                        inp.style.height = '18px';
                                        inp.style.fontSize = '11px';
                                        inp.style.border = '1px solid #3b82f6';
                                        inp.style.padding = '0 4px';
                                        inp.style.zIndex = '9999';
                                        document.body.appendChild(inp);
                                        inp.focus();
                                        inp.select();
                                        var inputDone = false;
                                        function finishLabelEdit() {
                                            if (inputDone) return;
                                            inputDone = true;
                                            self._editorState.nodes[popNodeId].label = inp.value;
                                            if (inp.parentNode) inp.parentNode.removeChild(inp);
                                            self.invalidateUpdateView();
                                        }
                                        inp.addEventListener('blur', finishLabelEdit);
                                        inp.addEventListener('keydown', function(ke) {
                                            if (ke.key === 'Enter') finishLabelEdit();
                                        });
                                    }
                                    return;
                                }
                            }
                            // Click inside popup but not on a hit area — do nothing
                            return;
                        } else {
                            // Click outside popup — close it
                            self._showNodePopup = false;
                            self._nodePopupId = null;
                            self.invalidateUpdateView();
                        }
                    }

                    // Connection popup hit-testing removed — DOM panel handles connection edits

                    // In connecting mode, handle node clicks
                    if (self._isConnecting) {
                        for (var cni = 0; cni < self._computedNodes.length; cni++) {
                            var cnd = self._computedNodes[cni];
                            if (hitTestNode(mx, my, cnd)) {
                                if (!self._connectFromId) {
                                    self._connectFromId = cnd.id;
                                    self.invalidateUpdateView();
                                } else if (cnd.id !== self._connectFromId) {
                                    // Create the connection
                                    if (!self._editorState.connections) self._editorState.connections = [];
                                    self._editorState.connections.push({
                                        from: self._connectFromId,
                                        to: cnd.id,
                                        style: 'straight',
                                        color: '',
                                        width: 2,
                                        dash: false,
                                        arrow: 'forward',
                                        label: '',
                                        manual: true
                                    });
                                    self._isConnecting = false;
                                    self._connectFromId = null;
                                    self._connectFromPort = null;
                                    self.canvas.style.cursor = 'default';
                                    self.invalidateUpdateView();
                                }
                                return;
                            }
                        }
                        return;
                    }

                    // Check anchor handles — ONLY on the selected connection
                    if (self._connPopupIdx !== null && self._connPopupIdx !== undefined) {
                        var selCci = self._connPopupIdx;
                        var ahc = self._computedConnections[selCci];
                        if (ahc) {
                            // Use _editorIdx stored on the computed connection for exact match
                            var edcAh = self._editorState.connections || [];
                            var ahEdIdx = -1;
                            if (ahc._editorIdx !== undefined && ahc._editorIdx < edcAh.length) {
                                ahEdIdx = ahc._editorIdx;
                            } else {
                                // Fallback: simple from+to match
                                for (var aeci2 = 0; aeci2 < edcAh.length; aeci2++) {
                                    if (edcAh[aeci2].from === ahc.from && edcAh[aeci2].to === ahc.to) {
                                        ahEdIdx = aeci2;
                                        break;
                                    }
                                }
                            }
                            if (ahEdIdx >= 0) {
                                if (ahc._startAnchorHit && pointInCircle(mx, my, ahc._startAnchorHit.x, ahc._startAnchorHit.y, 8)) {
                                    self._isDraggingAnchor = true;
                                    self._dragAnchorConnIdx = ahEdIdx;
                                    self._dragAnchorEnd = 'start';
                                    self._dragAnchorNode = self._computedNodeMap[ahc.from] || null;
                                    self.canvas.style.cursor = 'crosshair';
                                    return;
                                }
                                if (ahc._endAnchorHit && pointInCircle(mx, my, ahc._endAnchorHit.x, ahc._endAnchorHit.y, 8)) {
                                    self._isDraggingAnchor = true;
                                    self._dragAnchorConnIdx = ahEdIdx;
                                    self._dragAnchorEnd = 'end';
                                    self._dragAnchorNode = self._computedNodeMap[ahc.to] || null;
                                    self.canvas.style.cursor = 'crosshair';
                                    return;
                                }
                            }
                        }
                    }

                    // Check waypoint delete buttons (× icons)
                    for (var wdci = 0; wdci < self._computedConnections.length; wdci++) {
                        var wdHits = self._computedConnections[wdci]._wpDeleteHits;
                        if (!wdHits) continue;
                        for (var wdhi = 0; wdhi < wdHits.length; wdhi++) {
                            if (pointInCircle(mx, my, wdHits[wdhi].x, wdHits[wdhi].y, wdHits[wdhi].r + 2)) {
                                // Find editorState connection
                                var wdConn = self._computedConnections[wdci];
                                var edcDel = self._editorState.connections || [];
                                var wdEdIdx = -1;
                                if (wdConn._editorIdx !== undefined && wdConn._editorIdx < edcDel.length) {
                                    wdEdIdx = wdConn._editorIdx;
                                } else {
                                    for (var wdei = 0; wdei < edcDel.length; wdei++) {
                                        if (edcDel[wdei].from === wdConn.from && edcDel[wdei].to === wdConn.to) {
                                            wdEdIdx = wdei;
                                            break;
                                        }
                                    }
                                }
                                if (wdEdIdx >= 0) {
                                    if (edcDel[wdEdIdx].waypoints && edcDel[wdEdIdx].waypoints.length > wdHits[wdhi].wpIdx) {
                                        edcDel[wdEdIdx].waypoints.splice(wdHits[wdhi].wpIdx, 1);
                                        if (edcDel[wdEdIdx].waypoints.length === 0) delete edcDel[wdEdIdx].waypoints;
                                    }
                                }
                                self.invalidateUpdateView();
                                return;
                            }
                        }
                    }

                    // Check waypoint handles for dragging
                    var edConnsWp = self._editorState.connections || [];
                    for (var wci = 0; wci < edConnsWp.length; wci++) {
                        var wps = edConnsWp[wci].waypoints;
                        if (!wps) continue;
                        for (var wpj = 0; wpj < wps.length; wpj++) {
                            if (pointInCircle(mx, my, wps[wpj].x, wps[wpj].y, 8)) {
                                self._isDraggingWaypoint = true;
                                self._dragWpConnIdx = wci;
                                self._dragWpIdx = wpj;
                                self.canvas.style.cursor = 'move';
                                return;
                            }
                        }
                    }

                    // Check connection label hit for dragging
                    for (var lhi = 0; lhi < self._computedConnections.length; lhi++) {
                        var lhc = self._computedConnections[lhi];
                        if (lhc._labelHitRect && lhc.label) {
                            var lr = lhc._labelHitRect;
                            if (pointInRect(mx, my, lr.x, lr.y, lr.w, lr.h)) {
                                // Find editorState connection index using _editorIdx for exact match
                                var edcArr = self._editorState.connections || [];
                                var lEdIdx = -1;
                                if (lhc._editorIdx !== undefined && lhc._editorIdx < edcArr.length) {
                                    lEdIdx = lhc._editorIdx;
                                } else {
                                    for (var leci = 0; leci < edcArr.length; leci++) {
                                        if (edcArr[leci].from === lhc.from && edcArr[leci].to === lhc.to) {
                                            lEdIdx = leci;
                                            break;
                                        }
                                    }
                                }
                                if (lEdIdx >= 0) {
                                    self._isDraggingLabel = true;
                                    self._dragLabelConnIdx = lEdIdx;
                                    self._dragLabelConnFrom = lhc.from;
                                    self._dragLabelConnTo = lhc.to;
                                    self.canvas.style.cursor = 'move';
                                    return;
                                }
                            }
                        }
                    }

                    // Check resize handles on selected node (single selection only)
                    if (self._selectedNodeIds.length === 1) {
                        for (var rni = 0; rni < self._computedNodes.length; rni++) {
                            if (self._computedNodes[rni].id === self._selectedNodeIds[0]) {
                                var rsNode = self._computedNodes[rni];
                                var handles = getResizeHandles(rsNode);
                                for (var rhi = 0; rhi < handles.length; rhi++) {
                                    var rh = handles[rhi];
                                    if (pointInRect(mx, my, rh.x - 2, rh.y - 2, rh.w + 4, rh.h + 4)) {
                                        self._isResizing = true;
                                        self._resizeNodeId = rsNode.id;
                                        self._resizeHandle = rh.corner;
                                        self._resizeStartX = mx;
                                        self._resizeStartY = my;
                                        self._resizeStartNodeX = rsNode.x;
                                        self._resizeStartNodeY = rsNode.y;
                                        self._resizeStartNodeW = rsNode.w;
                                        self._resizeStartNodeH = rsNode.h;
                                        self.canvas.style.cursor = rh.cursor;
                                        return;
                                    }
                                }
                                break;
                            }
                        }
                    }

                    // Check connection port hits — start drag-to-connect
                    for (var npi = 0; npi < self._computedNodes.length; npi++) {
                        var pn = self._computedNodes[npi];
                        if (pn._ports && arrContains(self._selectedNodeIds, pn.id)) {
                            for (var ppi = 0; ppi < pn._ports.length; ppi++) {
                                var port = pn._ports[ppi];
                                var pdx = mx - port.px;
                                var pdy = my - port.py;
                                if (pdx * pdx + pdy * pdy <= 64) {
                                    self._isConnecting = true;
                                    self._connectFromId = pn.id;
                                    self._connectFromPort = port.side;
                                    self._connectMouseX = mx;
                                    self._connectMouseY = my;
                                    self.canvas.style.cursor = 'crosshair';
                                    e.preventDefault();
                                    return;
                                }
                            }
                        }
                    }

                    // Check node hits — start drag in edit mode
                    for (var ni = 0; ni < self._computedNodes.length; ni++) {
                        var nd = self._computedNodes[ni];
                        if (hitTestNode(mx, my, nd)) {
                            self._pushUndo();
                            // Pin ALL node positions to editorState so auto-layout
                            // doesn't shift other nodes during drag
                            for (var pinI = 0; pinI < self._computedNodes.length; pinI++) {
                                var pinN = self._computedNodes[pinI];
                                if (!self._editorState.nodes[pinN.id]) {
                                    self._editorState.nodes[pinN.id] = {};
                                }
                                if (self._editorState.nodes[pinN.id].x === undefined) {
                                    self._editorState.nodes[pinN.id].x = pinN.x;
                                    self._editorState.nodes[pinN.id].y = pinN.y;
                                }
                            }
                            // Multi-select: shift+click toggles node in selection
                            if (e.shiftKey) {
                                if (arrContains(self._selectedNodeIds, nd.id)) {
                                    self._selectedNodeIds = arrRemove(self._selectedNodeIds, nd.id);
                                } else {
                                    self._selectedNodeIds.push(nd.id);
                                }
                            } else {
                                // If clicking an already-selected node in a group, keep group for drag
                                if (!arrContains(self._selectedNodeIds, nd.id)) {
                                    self._selectedNodeIds = [nd.id];
                                }
                            }
                            // Store per-node drag start positions for multi-drag
                            self._dragNodeStarts = {};
                            for (var dnsi = 0; dnsi < self._selectedNodeIds.length; dnsi++) {
                                var dnsId = self._selectedNodeIds[dnsi];
                                for (var dnsj = 0; dnsj < self._computedNodes.length; dnsj++) {
                                    if (self._computedNodes[dnsj].id === dnsId) {
                                        self._dragNodeStarts[dnsId] = {
                                            x: self._computedNodes[dnsj].x,
                                            y: self._computedNodes[dnsj].y
                                        };
                                        break;
                                    }
                                }
                            }
                            self._isDragging = true;
                            self._dragNodeId = nd.id;
                            self._dragStartX = mx;
                            self._dragStartY = my;
                            self._dragNodeStartX = nd.x;
                            self._dragNodeStartY = nd.y;
                            self._selectedConnection = null;
                            self._showConnPopup = false;
                            self._updatePanel();
                            self.invalidateUpdateView();
                            return;
                        }
                    }

                    // Check connection hits for selection — find the CLOSEST connection
                    // within threshold using robust distToConnection (edge points + curves)
                    var hitThreshold = 12;
                    var closestCci = -1;
                    var closestDist = Infinity;
                    for (var cci = 0; cci < self._computedConnections.length; cci++) {
                        var cc = self._computedConnections[cci];
                        var fromNd = self._computedNodeMap[cc.from];
                        var toNd = self._computedNodeMap[cc.to];
                        if (fromNd && toNd) {
                            var ccResult = distToConnection(mx, my, cc, fromNd, toNd);
                            if (ccResult.dist <= hitThreshold && ccResult.dist < closestDist) {
                                closestDist = ccResult.dist;
                                closestCci = cci;
                            }
                        }
                    }
                    if (closestCci >= 0) {
                        var cc = self._computedConnections[closestCci];
                        // Use computed connection index (closestCci) for unique identification
                        self._selectedConnection = { index: closestCci };
                        self._selectedNodeIds = [];
                        self._showNodePopup = false;
                        // Find matching editorState connection using _editorIdx for exact match
                        var edConnIdx = -1;
                        var edCS = self._editorState.connections || [];
                        if (cc._editorIdx !== undefined && cc._editorIdx < edCS.length) {
                            edConnIdx = cc._editorIdx;
                        } else {
                            for (var eci = 0; eci < edCS.length; eci++) {
                                if (edCS[eci].from === cc.from && edCS[eci].to === cc.to) {
                                    edConnIdx = eci;
                                    break;
                                }
                            }
                        }
                        if (edConnIdx === -1) {
                            if (!self._editorState.connections) self._editorState.connections = [];
                            self._editorState.connections.push({
                                from: cc.from, to: cc.to,
                                style: cc.style || 'straight',
                                color: cc.color || '',
                                width: cc.width || 2,
                                dash: cc.dash || false,
                                startEndpoint: cc.startEndpoint || 'none',
                                endEndpoint: cc.endEndpoint || 'filledArrow',
                                label: cc.label || '',
                                manual: cc.manual || false
                            });
                            edConnIdx = self._editorState.connections.length - 1;
                        }
                        // Toggle click-triggered animation active state
                        var edCSClick = self._editorState.connections || [];
                        if (edConnIdx >= 0 && edCSClick[edConnIdx] && edCSClick[edConnIdx].animationTrigger === 'click') {
                            edCSClick[edConnIdx]._animActive = !edCSClick[edConnIdx]._animActive;
                        }
                        self._showConnPopup = true;
                        self._connPopupIdx = edConnIdx;
                        self._connPopupPos = { x: mx, y: my };
                        self._updatePanel();
                        self.invalidateUpdateView();
                        return;
                    }

                    // Clicked empty space — start rubber-band selection
                    self._isRubberBanding = true;
                    self._rubberBandStart = { x: mx, y: my };
                    self._rubberBandEnd = { x: mx, y: my };
                    if (!e.shiftKey) {
                        self._selectedNodeIds = [];
                    }
                    self._selectedConnection = null;
                    self._showNodePopup = false;
                    self._showConnPopup = false;
                    self._updatePanel();
                    self.invalidateUpdateView();
                } else if (!self._lockMode) {
                    // View mode, lock off — allow temporary drag
                    for (var vni = 0; vni < self._computedNodes.length; vni++) {
                        var vnd = self._computedNodes[vni];
                        if (hitTestNode(mx, my, vnd)) {
                            e.preventDefault();
                            e.stopPropagation();
                            self._isDragging = true;
                            self._dragNodeId = vnd.id;
                            self._dragStartX = mx;
                            self._dragStartY = my;
                            self._dragNodeStartX = vnd.x;
                            self._dragNodeStartY = vnd.y;
                            // Save original position for snap-back
                            var hadPos = self._editorState.nodes[vnd.id] &&
                                self._editorState.nodes[vnd.id].x !== undefined;
                            self._snapBackPos = { x: vnd.x, y: vnd.y, hadPosition: hadPos };
                            return;
                        }
                    }
                    // View mode: handle click-trigger animation toggle for connections
                    // Find the CLOSEST connection using robust distToConnection
                    var edConnsVM = self._editorState.connections || [];
                    var vmHitThreshold = 12;
                    var vmClosestCi = -1;
                    var vmClosestDist = Infinity;
                    for (var vmci = 0; vmci < self._computedConnections.length; vmci++) {
                        var vmConn = self._computedConnections[vmci];
                        var vmFrom = self._computedNodeMap[vmConn.from];
                        var vmTo = self._computedNodeMap[vmConn.to];
                        if (vmFrom && vmTo) {
                            var vmResult = distToConnection(mx, my, vmConn, vmFrom, vmTo);
                            if (vmResult.dist <= vmHitThreshold && vmResult.dist < vmClosestDist) {
                                vmClosestDist = vmResult.dist;
                                vmClosestCi = vmci;
                            }
                        }
                    }
                    if (vmClosestCi >= 0) {
                        var vmConn2 = self._computedConnections[vmClosestCi];
                        // Find editorState connection and toggle click animation
                        for (var vmei = 0; vmei < edConnsVM.length; vmei++) {
                            if (edConnsVM[vmei].from === vmConn2.from && edConnsVM[vmei].to === vmConn2.to) {
                                if (edConnsVM[vmei].animationTrigger === 'click') {
                                    edConnsVM[vmei]._animActive = !edConnsVM[vmei]._animActive;
                                    self.invalidateUpdateView();
                                }
                                break;
                            }
                        }
                    }
                }
            };

            // ── Mouse Move ──
            this._onMouseMove = function(e) {
                // Stop event propagation during modal interactions
                if (self._isDragging || self._isResizing || self._isConnecting || self._editMode || self._isPanning) {
                    e.preventDefault();
                    e.stopPropagation();
                }

                // Handle panning
                if (self._isPanning) {
                    var pdx = e.clientX - self._panStartX;
                    var pdy = e.clientY - self._panStartY;
                    self._panX += pdx;
                    self._panY += pdy;
                    self._panStartX = e.clientX;
                    self._panStartY = e.clientY;
                    self.invalidateUpdateView();
                    return;
                }

                var rect = self.canvas.getBoundingClientRect();
                var rawMx = e.clientX - rect.left;
                var rawMy = e.clientY - rect.top;
                var mx = rawMx - self._panX;
                var my = rawMy - self._panY;
                self._mouseX = rawMx;
                self._mouseY = rawMy;

                // Handle anchor dragging — snap to nearest node edge
                if (self._isDraggingAnchor && self._dragAnchorNode) {
                    var an = self._dragAnchorNode;
                    var aCx = an.x + an.w / 2;
                    var aCy = an.y + an.h / 2;
                    // Determine which edge is closest to mouse
                    var dTop = Math.abs(my - an.y);
                    var dBot = Math.abs(my - (an.y + an.h));
                    var dLeft = Math.abs(mx - an.x);
                    var dRight = Math.abs(mx - (an.x + an.w));
                    var minD = Math.min(dTop, dBot, dLeft, dRight);
                    var newAnchor = 'auto';
                    var newOffset = 0;
                    if (minD === dTop) {
                        newAnchor = 'top';
                        newOffset = Math.round(mx - aCx);
                    } else if (minD === dBot) {
                        newAnchor = 'bottom';
                        newOffset = Math.round(mx - aCx);
                    } else if (minD === dLeft) {
                        newAnchor = 'left';
                        newOffset = Math.round(my - aCy);
                    } else {
                        newAnchor = 'right';
                        newOffset = Math.round(my - aCy);
                    }
                    // Clamp offset to node bounds
                    if (newAnchor === 'top' || newAnchor === 'bottom') {
                        newOffset = Math.max(-an.w / 2 + 5, Math.min(an.w / 2 - 5, newOffset));
                    } else {
                        newOffset = Math.max(-an.h / 2 + 5, Math.min(an.h / 2 - 5, newOffset));
                    }
                    var ec = self._editorState.connections[self._dragAnchorConnIdx];
                    if (ec) {
                        if (self._dragAnchorEnd === 'start') {
                            ec.sourceAnchor = newAnchor;
                            ec.sourceAnchorOffset = newOffset;
                        } else {
                            ec.targetAnchor = newAnchor;
                            ec.targetAnchorOffset = newOffset;
                        }
                    }
                    self.invalidateUpdateView();
                    return;
                }

                // Handle waypoint dragging
                if (self._isDraggingWaypoint && self._dragWpConnIdx !== null) {
                    var wpConns = self._editorState.connections;
                    if (wpConns[self._dragWpConnIdx] && wpConns[self._dragWpConnIdx].waypoints) {
                        wpConns[self._dragWpConnIdx].waypoints[self._dragWpIdx] = { x: mx, y: my };
                    }
                    self.invalidateUpdateView();
                    self.canvas.style.cursor = 'move';
                    return;
                }

                // Handle label dragging — project mouse onto connection path
                if (self._isDraggingLabel && self._dragLabelConnIdx !== null) {
                    var lblConns = self._editorState.connections;
                    var lblConn = lblConns[self._dragLabelConnIdx];
                    if (lblConn) {
                        // Find the computed connection to get its cached points
                        var lblCompConn = null;
                        for (var lci2 = 0; lci2 < self._computedConnections.length; lci2++) {
                            if (self._computedConnections[lci2].from === self._dragLabelConnFrom &&
                                self._computedConnections[lci2].to === self._dragLabelConnTo) {
                                lblCompConn = self._computedConnections[lci2];
                                break;
                            }
                        }
                        var lblPts = lblCompConn && lblCompConn._deferredDraw ? lblCompConn._deferredDraw.labelPoints : null;
                        var lblStyle = lblCompConn ? lblCompConn.style : 'straight';
                        if (lblPts && lblPts.length >= 2) {
                            var bestT = 0.5;
                            var bestDist = Infinity;
                            for (var lt = 0; lt <= 1.0; lt += 0.02) {
                                var lpt = interpolateConnectionPath(lblPts, lblStyle, lt);
                                var ldx = mx - lpt.x;
                                var ldy = my - lpt.y;
                                var ldist = ldx * ldx + ldy * ldy;
                                if (ldist < bestDist) {
                                    bestDist = ldist;
                                    bestT = lt;
                                }
                            }
                            lblConn.labelPosition = bestT;
                        }
                    }
                    self.invalidateUpdateView();
                    self.canvas.style.cursor = 'move';
                    return;
                }

                // Handle resizing
                if (self._isResizing && self._resizeNodeId) {
                    var rdx = mx - self._resizeStartX;
                    var rdy = my - self._resizeStartY;
                    var rCorner = self._resizeHandle;
                    var rnx = self._resizeStartNodeX;
                    var rny = self._resizeStartNodeY;
                    var rnw = self._resizeStartNodeW;
                    var rnh = self._resizeStartNodeH;
                    var newNx = rnx, newNy = rny, newNw = rnw, newNh = rnh;

                    if (rCorner === 'br') {
                        newNw = Math.max(80, rnw + rdx);
                        newNh = Math.max(60, rnh + rdy);
                    } else if (rCorner === 'bl') {
                        newNw = Math.max(80, rnw - rdx);
                        newNh = Math.max(60, rnh + rdy);
                        newNx = rnx + rnw - newNw;
                    } else if (rCorner === 'tr') {
                        newNw = Math.max(80, rnw + rdx);
                        newNh = Math.max(60, rnh - rdy);
                        newNy = rny + rnh - newNh;
                    } else if (rCorner === 'tl') {
                        newNw = Math.max(80, rnw - rdx);
                        newNh = Math.max(60, rnh - rdy);
                        newNx = rnx + rnw - newNw;
                        newNy = rny + rnh - newNh;
                    }

                    // Update editorState in real-time so computeNodePositions
                    // picks up the new size on redraw
                    if (!self._editorState.nodes[self._resizeNodeId]) {
                        self._editorState.nodes[self._resizeNodeId] = {};
                    }
                    self._editorState.nodes[self._resizeNodeId].x = newNx;
                    self._editorState.nodes[self._resizeNodeId].y = newNy;
                    self._editorState.nodes[self._resizeNodeId].w = newNw;
                    self._editorState.nodes[self._resizeNodeId].h = newNh;

                    self.invalidateUpdateView();
                    return;
                }

                // In connecting mode, update mouse position and redraw for temp line
                if (self._isConnecting && self._connectFromId) {
                    self._connectMouseX = mx;
                    self._connectMouseY = my;
                    self.invalidateUpdateView();
                    if (self._connectFromPort) return;
                }

                // Handle rubber-band selection drag
                if (self._isRubberBanding) {
                    self._rubberBandEnd = { x: mx, y: my };
                    self.invalidateUpdateView();
                    return;
                }

                // Handle dragging — move all selected nodes together
                if (self._isDragging && self._dragNodeId) {
                    self._didDrag = true;
                    var deltaX = mx - self._dragStartX;
                    var deltaY = my - self._dragStartY;

                    // Move all selected nodes by the same delta
                    if (self._editMode && self._selectedNodeIds.length > 1 && self._dragNodeStarts) {
                        for (var mdi = 0; mdi < self._selectedNodeIds.length; mdi++) {
                            var mdId = self._selectedNodeIds[mdi];
                            var mdStart = self._dragNodeStarts[mdId];
                            if (mdStart) {
                                if (!self._editorState.nodes[mdId]) {
                                    self._editorState.nodes[mdId] = {};
                                }
                                self._editorState.nodes[mdId].x = mdStart.x + deltaX;
                                self._editorState.nodes[mdId].y = mdStart.y + deltaY;
                            }
                        }
                    } else {
                        var newX = self._dragNodeStartX + deltaX;
                        var newY = self._dragNodeStartY + deltaY;
                        // Update editorState in real-time so computeNodePositions
                        // picks up the new position on redraw
                        if (!self._editorState.nodes[self._dragNodeId]) {
                            self._editorState.nodes[self._dragNodeId] = {};
                        }
                        self._editorState.nodes[self._dragNodeId].x = newX;
                        self._editorState.nodes[self._dragNodeId].y = newY;
                    }

                    self.invalidateUpdateView();
                    // Update cursor
                    self.canvas.style.cursor = self._editMode ? 'move' : 'grabbing';
                    return;
                }

                // Update hover state
                var oldHover = self._hoverItem;
                self._hoverItem = null;

                // Clear hover-triggered animation active state (will be re-set if still hovering)
                var edConnsClr = self._editorState.connections || [];
                var hadHoverAnim = false;
                for (var haci = 0; haci < edConnsClr.length; haci++) {
                    if (edConnsClr[haci].animationTrigger === 'hover' && edConnsClr[haci]._animActive) {
                        hadHoverAnim = true;
                    }
                    if (edConnsClr[haci].animationTrigger === 'hover') {
                        edConnsClr[haci]._animActive = false;
                    }
                }

                // Check toolbar buttons (use raw coordinates — toolbar is not panned)
                if (self._editMode && self._toolbarButtons) {
                    for (var bi = 0; bi < self._toolbarButtons.length; bi++) {
                        var btn = self._toolbarButtons[bi];
                        if (pointInRect(rawMx, rawMy, btn.x, btn.y, btn.w, btn.h)) {
                            self._hoverItem = { type: 'button', index: bi };
                            break;
                        }
                    }
                }

                // Check nodes
                if (!self._hoverItem) {
                    for (var ni = 0; ni < self._computedNodes.length; ni++) {
                        var nd = self._computedNodes[ni];
                        if (hitTestNode(mx, my, nd)) {
                            self._hoverItem = { type: 'node', id: nd.id, index: ni };
                            break;
                        }
                    }
                }

                // Check connections — find closest within threshold using distToConnection
                if (!self._hoverItem) {
                    var hvThreshold = 12;
                    var hvClosestCci = -1;
                    var hvClosestDist = Infinity;
                    for (var cci = 0; cci < self._computedConnections.length; cci++) {
                        var cc = self._computedConnections[cci];
                        var fromNd = self._computedNodeMap[cc.from];
                        var toNd = self._computedNodeMap[cc.to];
                        if (fromNd && toNd) {
                            var hvResult = distToConnection(mx, my, cc, fromNd, toNd);
                            if (hvResult.dist <= hvThreshold && hvResult.dist < hvClosestDist) {
                                hvClosestDist = hvResult.dist;
                                hvClosestCci = cci;
                            }
                        }
                    }
                    if (hvClosestCci >= 0) {
                        self._hoverItem = { type: 'connection', index: hvClosestCci };
                        // Set _animActive for hover-triggered animations
                        // Map computed connection index back to editorState connection
                        var hoveredComp = self._computedConnections[hvClosestCci];
                        var edConnsHv = self._editorState.connections || [];
                        var hoveredSet = false;
                        for (var hvei = 0; hvei < edConnsHv.length; hvei++) {
                            if (edConnsHv[hvei].animationTrigger === 'hover') {
                                // Match by from+to
                                var isHoveredConn = hoveredComp && edConnsHv[hvei].from === hoveredComp.from && edConnsHv[hvei].to === hoveredComp.to;
                                edConnsHv[hvei]._animActive = isHoveredConn;
                                if (isHoveredConn) hoveredSet = true;
                            }
                        }
                        // Trigger redraw to start/stop animation loop
                        if (hoveredSet) self.invalidateUpdateView();
                    }
                }

                // Check port hover — show crosshair when over a connection port
                var onPort = false;
                if (self._editMode) {
                    for (var hpi = 0; hpi < self._computedNodes.length; hpi++) {
                        if (self._computedNodes[hpi]._ports && arrContains(self._selectedNodeIds, self._computedNodes[hpi].id)) {
                            for (var hpp = 0; hpp < self._computedNodes[hpi]._ports.length; hpp++) {
                                var hp = self._computedNodes[hpi]._ports[hpp];
                                var hpdx = mx - hp.px;
                                var hpdy = my - hp.py;
                                if (hpdx * hpdx + hpdy * hpdy <= 64) {
                                    self.canvas.style.cursor = 'crosshair';
                                    onPort = true;
                                    break;
                                }
                            }
                            if (onPort) break;
                        }
                    }
                }

                // Update cursor based on state
                if (onPort) {
                    // already set above
                } else if (self._isConnecting) {
                    self.canvas.style.cursor = 'crosshair';
                } else if (self._hoverItem) {
                    if (self._hoverItem.type === 'button') {
                        self.canvas.style.cursor = 'pointer';
                    } else if (self._hoverItem.type === 'node') {
                        // Check resize handles first
                        var onHandle = false;
                        if (self._editMode && self._selectedNodeIds.length === 1 && self._hoverItem.id === self._selectedNodeIds[0]) {
                            for (var rhi2 = 0; rhi2 < self._computedNodes.length; rhi2++) {
                                if (self._computedNodes[rhi2].id === self._selectedNodeIds[0]) {
                                    var hHandles = getResizeHandles(self._computedNodes[rhi2]);
                                    for (var hhi = 0; hhi < hHandles.length; hhi++) {
                                        if (pointInRect(mx, my, hHandles[hhi].x - 2, hHandles[hhi].y - 2, hHandles[hhi].w + 4, hHandles[hhi].h + 4)) {
                                            self.canvas.style.cursor = hHandles[hhi].cursor;
                                            onHandle = true;
                                            break;
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                        if (!onHandle) {
                            if (self._editMode) {
                                self.canvas.style.cursor = 'move';
                            } else {
                                self.canvas.style.cursor = 'default';
                            }
                        }
                    } else if (self._hoverItem.type === 'connection') {
                        self.canvas.style.cursor = self._editMode ? 'pointer' : 'default';
                    }
                } else {
                    self.canvas.style.cursor = 'default';
                }

                // Sparkline hover check (only when not dragging/panning)
                if (!self._isDragging && !self._isPanning) {
                    var sparkHoverNode = null;
                    var sparkHoverIdx = -1;
                    for (var shi = 0; shi < self._computedNodes.length; shi++) {
                        var shn = self._computedNodes[shi];
                        if (shn.sparkHover === 'on' && shn._sparkBounds && shn._sparkDataRef && shn._sparkDataRef.length > 0) {
                            var sb = shn._sparkBounds;
                            if (mx >= sb.x && mx <= sb.x + sb.w && my >= sb.y && my <= sb.y + sb.h) {
                                var relX = (mx - sb.x) / sb.w;
                                var dataIdx = Math.round(relX * (shn._sparkDataRef.length - 1));
                                dataIdx = Math.max(0, Math.min(shn._sparkDataRef.length - 1, dataIdx));
                                sparkHoverNode = shn;
                                sparkHoverIdx = dataIdx;
                                break;
                            }
                        }
                    }
                    var sparkHoverChanged = (self._sparkHoverNode !== sparkHoverNode || self._sparkHoverIdx !== sparkHoverIdx);
                    self._sparkHoverNode = sparkHoverNode;
                    self._sparkHoverIdx = sparkHoverIdx;
                    if (sparkHoverChanged) {
                        self.invalidateUpdateView();
                    }
                }

                // Re-render on hover change for visual feedback
                var hoverChanged = false;
                if (!oldHover && self._hoverItem) hoverChanged = true;
                if (oldHover && !self._hoverItem) hoverChanged = true;
                if (oldHover && self._hoverItem) {
                    if (oldHover.type !== self._hoverItem.type || oldHover.id !== self._hoverItem.id || oldHover.index !== self._hoverItem.index) {
                        hoverChanged = true;
                    }
                }
                if (hoverChanged) {
                    self.invalidateUpdateView();
                }
                // In view mode, always re-render when hovering for tooltip positioning
                if (!self._editMode && self._hoverItem && (self._hoverItem.type === 'node' || self._hoverItem.type === 'connection')) {
                    self.invalidateUpdateView();
                }
            };

            // ── Mouse Up ──
            this._onMouseUp = function(e) {
                // Handle pan end
                if (self._isPanning) {
                    self._isPanning = false;
                    self.canvas.style.cursor = self._spaceHeld ? 'grab' : 'default';
                    return;
                }

                if (self._editMode || self._isDragging || self._isResizing || self._isRubberBanding) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                var rect = self.canvas.getBoundingClientRect();
                self._mouseX = e.clientX - rect.left;
                self._mouseY = e.clientY - rect.top;

                // Handle rubber-band selection end
                if (self._isRubberBanding) {
                    self._isRubberBanding = false;
                    var rbx1 = Math.min(self._rubberBandStart.x, self._rubberBandEnd.x);
                    var rby1 = Math.min(self._rubberBandStart.y, self._rubberBandEnd.y);
                    var rbx2 = Math.max(self._rubberBandStart.x, self._rubberBandEnd.x);
                    var rby2 = Math.max(self._rubberBandStart.y, self._rubberBandEnd.y);
                    var rbW = rbx2 - rbx1;
                    var rbH = rby2 - rby1;
                    // Only select if rectangle is large enough (avoid accidental clicks)
                    if (rbW > 5 || rbH > 5) {
                        for (var rbi = 0; rbi < self._computedNodes.length; rbi++) {
                            var rbn = self._computedNodes[rbi];
                            // Node is inside if its center is within the rectangle
                            var rnCx = rbn.x + rbn.w / 2;
                            var rnCy = rbn.y + rbn.h / 2;
                            if (rnCx >= rbx1 && rnCx <= rbx2 && rnCy >= rby1 && rnCy <= rby2) {
                                if (!arrContains(self._selectedNodeIds, rbn.id)) {
                                    self._selectedNodeIds.push(rbn.id);
                                }
                            }
                        }
                    }
                    self._rubberBandStart = null;
                    self._rubberBandEnd = null;
                    self._updatePanel();
                    self.invalidateUpdateView();
                    return;
                }

                // Handle port-based drag-to-connect end
                if (self._isConnecting && self._connectFromPort) {
                    self._isConnecting = false;
                    var cmx = self._mouseX - self._panX;
                    var cmy = self._mouseY - self._panY;
                    // Find target node under cursor
                    for (var tni = 0; tni < self._computedNodes.length; tni++) {
                        var tn = self._computedNodes[tni];
                        if (tn.id !== self._connectFromId && hitTestNode(cmx, cmy, tn)) {
                            // Create connection
                            var newConn = {
                                from: self._connectFromId,
                                to: tn.id,
                                endEndpoint: 'filledArrow',
                                sourceAnchor: self._connectFromPort || 'auto',
                                targetAnchor: 'auto',
                                style: 'straight',
                                color: '',
                                width: 2,
                                manual: true
                            };
                            if (!self._editorState.connections) self._editorState.connections = [];
                            self._pushUndo();
                            self._editorState.connections.push(newConn);
                            self.invalidateUpdateView();
                            break;
                        }
                    }
                    self._connectFromId = null;
                    self._connectFromPort = null;
                    self.canvas.style.cursor = 'default';
                    return;
                }

                // Handle pending toolbar action
                if (self._pendingToolbarAction) {
                    var action = self._pendingToolbarAction;
                    self._pendingToolbarAction = null;
                    // Verify mouse is still over the button
                    var mx = self._mouseX;
                    var my = self._mouseY;
                    for (var bi = 0; bi < self._toolbarButtons.length; bi++) {
                        var btn = self._toolbarButtons[bi];
                        if (btn.action === action && pointInRect(mx, my, btn.x, btn.y, btn.w, btn.h)) {
                            self._executeToolbarAction(action);
                            break;
                        }
                    }
                    self._isDragging = false;
                    self._dragNodeId = null;
                    return;
                }

                // Handle anchor drag end
                if (self._isDraggingAnchor) {
                    self._isDraggingAnchor = false;
                    self._dragAnchorConnIdx = null;
                    self._dragAnchorEnd = null;
                    self._dragAnchorNode = null;
                    self.canvas.style.cursor = 'default';
                    self.invalidateUpdateView();
                    return;
                }

                // Handle waypoint drag end
                if (self._isDraggingWaypoint) {
                    self._isDraggingWaypoint = false;
                    self._dragWpConnIdx = null;
                    self._dragWpIdx = null;
                    self.canvas.style.cursor = 'default';
                    self.invalidateUpdateView();
                    return;
                }

                // Handle label drag end
                if (self._isDraggingLabel) {
                    self._isDraggingLabel = false;
                    self._dragLabelConnIdx = null;
                    self.canvas.style.cursor = 'default';
                    self.invalidateUpdateView();
                    return;
                }

                // Handle resize end
                if (self._isResizing && self._resizeNodeId) {
                    for (var rui = 0; rui < self._computedNodes.length; rui++) {
                        if (self._computedNodes[rui].id === self._resizeNodeId) {
                            var resizedNode = self._computedNodes[rui];
                            if (!self._editorState.nodes[self._resizeNodeId]) {
                                self._editorState.nodes[self._resizeNodeId] = {};
                            }
                            self._editorState.nodes[self._resizeNodeId].x = resizedNode.x;
                            self._editorState.nodes[self._resizeNodeId].y = resizedNode.y;
                            self._editorState.nodes[self._resizeNodeId].w = resizedNode.w;
                            self._editorState.nodes[self._resizeNodeId].h = resizedNode.h;
                            break;
                        }
                    }
                    self._isResizing = false;
                    self._resizeNodeId = null;
                    self._resizeHandle = null;
                    self.canvas.style.cursor = 'default';
                    self.invalidateUpdateView();
                    return;
                }

                // Handle drag end
                if (self._isDragging && self._dragNodeId) {
                    var wasDrag = self._didDrag;
                    var draggedId = self._dragNodeId;

                    if (self._editMode) {
                        // Modal edit mode: persist positions for all dragged nodes
                        if (wasDrag) {
                            var dragIds = self._selectedNodeIds.length > 1 ? self._selectedNodeIds : [draggedId];
                            for (var mdi2 = 0; mdi2 < dragIds.length; mdi2++) {
                                var mdId2 = dragIds[mdi2];
                                for (var ni = 0; ni < self._computedNodes.length; ni++) {
                                    if (self._computedNodes[ni].id === mdId2) {
                                        var movedNode = self._computedNodes[ni];
                                        if (!self._editorState.nodes[mdId2]) {
                                            self._editorState.nodes[mdId2] = {};
                                        }
                                        self._editorState.nodes[mdId2].x = movedNode.x;
                                        self._editorState.nodes[mdId2].y = movedNode.y;
                                        break;
                                    }
                                }
                            }
                            // Snap to grid
                            if (self._snapEnabled && self._gridSize > 0) {
                                for (var snapI = 0; snapI < self._selectedNodeIds.length; snapI++) {
                                    var snapId = self._selectedNodeIds[snapI];
                                    var snapNode = self._editorState.nodes[snapId];
                                    if (snapNode && snapNode.x !== undefined) {
                                        snapNode.x = Math.round(snapNode.x / self._gridSize) * self._gridSize;
                                        snapNode.y = Math.round(snapNode.y / self._gridSize) * self._gridSize;
                                    }
                                }
                            }
                        }
                    } else {
                        // View mode: snap back to original position in editorState
                        if (self._snapBackPos && wasDrag) {
                            if (self._editorState.nodes[draggedId]) {
                                if (self._snapBackPos.hadPosition) {
                                    self._editorState.nodes[draggedId].x = self._snapBackPos.x;
                                    self._editorState.nodes[draggedId].y = self._snapBackPos.y;
                                } else {
                                    // Node had no saved position before drag — remove it
                                    delete self._editorState.nodes[draggedId].x;
                                    delete self._editorState.nodes[draggedId].y;
                                    // Clean up empty object
                                    var hasProps = false;
                                    for (var k in self._editorState.nodes[draggedId]) {
                                        if (self._editorState.nodes[draggedId].hasOwnProperty(k)) {
                                            hasProps = true;
                                            break;
                                        }
                                    }
                                    if (!hasProps) delete self._editorState.nodes[draggedId];
                                }
                            }
                            self.invalidateUpdateView();
                        }
                        self._snapBackPos = null;

                        // Drilldown on non-drag click in view mode
                        if (!wasDrag) {
                            var hitNode = null;
                            for (var ddi = 0; ddi < self._computedNodes.length; ddi++) {
                                if (self._computedNodes[ddi].id === draggedId) {
                                    hitNode = self._computedNodes[ddi];
                                    break;
                                }
                            }
                            if (hitNode) {
                                var drilldownData = {};
                                drilldownData[self._drilldownField] = hitNode.label;
                                e.preventDefault();
                                self.drilldown({
                                    action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
                                    data: drilldownData
                                }, e);
                            }
                        }
                    }
                } else if (!self._editMode) {
                    // View mode click on node (lock mode — no drag started)
                    var vmx = self._mouseX - self._panX;
                    var vmy = self._mouseY - self._panY;
                    for (var vhi = 0; vhi < self._computedNodes.length; vhi++) {
                        var vhNode = self._computedNodes[vhi];
                        if (hitTestNode(vmx, vmy, vhNode)) {
                            var drillData = {};
                            drillData[self._drilldownField] = vhNode.label;
                            e.preventDefault();
                            self.drilldown({
                                action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
                                data: drillData
                            }, e);
                            break;
                        }
                    }
                }

                self._isDragging = false;
                self._dragNodeId = null;
                self._dragNodeStarts = {};
                self._didDrag = false;
            };

            // ── Double Click ──
            this._onDblClick = function(e) {
                if (!self._editMode) return;
                var rect = self.canvas.getBoundingClientRect();
                var mx = (e.clientX - rect.left) - self._panX;
                var my = (e.clientY - rect.top) - self._panY;

                // Double-click on node → open popup
                for (var dni = 0; dni < self._computedNodes.length; dni++) {
                    var dnd = self._computedNodes[dni];
                    if (hitTestNode(mx, my, dnd)) {
                        self._selectedNodeIds = [dnd.id];
                        self._selectedConnection = null;
                        self._showConnPopup = false;
                        self._updatePanel();
                        self.invalidateUpdateView();
                        return;
                    }
                }

                // Double-click on connection → add waypoint
                // Find the closest connection using robust distToConnection
                var conns = self._computedConnections;
                var dcHitThreshold = 12;
                var dcClosestIdx = -1;
                var dcClosestSeg = -1;
                var dcClosestDist = Infinity;
                for (var dci = 0; dci < conns.length; dci++) {
                    var dc = conns[dci];
                    var dcFrom = self._computedNodeMap[dc.from];
                    var dcTo = self._computedNodeMap[dc.to];
                    if (!dcFrom || !dcTo) continue;
                    var dcResult = distToConnection(mx, my, dc, dcFrom, dcTo);
                    if (dcResult.dist <= dcHitThreshold && dcResult.dist < dcClosestDist) {
                        dcClosestDist = dcResult.dist;
                        dcClosestIdx = dci;
                        dcClosestSeg = dcResult.segment;
                    }
                }
                if (dcClosestIdx >= 0) {
                    var dc2 = conns[dcClosestIdx];
                    // Find matching editorState connection using _editorIdx for exact match
                    var edConns3 = self._editorState.connections || [];
                    var edConnIdx3 = -1;
                    if (dc2._editorIdx !== undefined && dc2._editorIdx < edConns3.length) {
                        edConnIdx3 = dc2._editorIdx;
                    } else {
                        for (var eci2 = 0; eci2 < edConns3.length; eci2++) {
                            if (edConns3[eci2].from === dc2.from && edConns3[eci2].to === dc2.to) {
                                edConnIdx3 = eci2;
                                break;
                            }
                        }
                    }
                    if (edConnIdx3 >= 0) {
                        if (!edConns3[edConnIdx3].waypoints) edConns3[edConnIdx3].waypoints = [];
                        // Insert waypoint at click position, in correct segment position
                        edConns3[edConnIdx3].waypoints.splice(dcClosestSeg, 0, { x: mx, y: my });
                        self.invalidateUpdateView();
                        return;
                    }
                    // If not in editorState yet, promote it
                    if (!self._editorState.connections) self._editorState.connections = [];
                    self._editorState.connections.push({
                        from: dc2.from, to: dc2.to,
                        style: dc2.style || 'straight',
                        color: dc2.color || '',
                        width: dc2.width || 2,
                        dash: dc2.dash || false,
                        startEndpoint: dc2.startEndpoint || 'none',
                        endEndpoint: dc2.endEndpoint || 'filledArrow',
                        label: dc2.label || '',
                        manual: dc2.manual || false,
                        waypoints: [{ x: mx, y: my }]
                    });
                    self.invalidateUpdateView();
                    return;
                }
            };

            // ── Right Click — cancel connecting ──
            this._onContextMenu = function(e) {
                if (self._isConnecting) {
                    e.preventDefault();
                    self._isConnecting = false;
                    self._connectFromId = null;
                    self._connectFromPort = null;
                    self.canvas.style.cursor = 'default';
                    self.invalidateUpdateView();
                }
            };

            // ── Keydown ──
            this._onKeyDown = function(e) {
                // Space — begin pan mode
                if (e.key === ' ' || e.keyCode === 32) {
                    var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
                    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
                    e.preventDefault();
                    self._spaceHeld = true;
                    self.canvas.style.cursor = 'grab';
                    return;
                }
                if (e.key === 'Escape') {
                    var changed = false;
                    if (self._isConnecting) {
                        self._isConnecting = false;
                        self._connectFromId = null;
                        self._connectFromPort = null;
                        self.canvas.style.cursor = 'default';
                        changed = true;
                    }
                    if (self._showNodePopup) {
                        self._showNodePopup = false;
                        self._nodePopupId = null;
                        changed = true;
                    }
                    if (self._showConnPopup) {
                        self._showConnPopup = false;
                        self._connPopupIdx = null;
                        changed = true;
                    }
                    if (self._selectedNodeIds.length > 0 || self._selectedConnection) {
                        self._selectedNodeIds = [];
                        self._selectedConnection = null;
                        changed = true;
                    }
                    if (changed) {
                        self._updatePanel();
                        self.invalidateUpdateView();
                    }
                }
                // Delete/Backspace
                if ((e.key === 'Delete' || e.key === 'Backspace' || e.keyCode === 46 || e.keyCode === 8) && self._editMode) {
                    var delTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
                    if (delTag === 'input' || delTag === 'textarea' || delTag === 'select') return;
                    e.preventDefault();
                    self._deleteSelected();
                }
                // Undo: Cmd+Z / Ctrl+Z
                if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey && self._editMode) {
                    e.preventDefault();
                    self._undo();
                }
                // Redo: Cmd+Shift+Z / Ctrl+Y
                if ((e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) ||
                    (e.key === 'y' && e.ctrlKey)) {
                    if (self._editMode) {
                        e.preventDefault();
                        self._redo();
                    }
                }
            };

            // Attach events to both canvas (for view mode) and overlay (for edit mode in Splunk)
            this.canvas.addEventListener('mousedown', this._onMouseDown, true);
            this.canvas.addEventListener('mousemove', this._onMouseMove, true);
            this.canvas.addEventListener('mouseup', this._onMouseUp, true);
            this.canvas.addEventListener('dblclick', this._onDblClick);
            this.canvas.addEventListener('contextmenu', this._onContextMenu);
            this._onMouseLeave = function() {
                if (self._sparkHoverNode) {
                    self._sparkHoverNode = null;
                    self._sparkHoverIdx = -1;
                    self.invalidateUpdateView();
                }
            };
            this.canvas.addEventListener('mouseleave', this._onMouseLeave);
            // (overlay removed — modal editor handles edit mode events)
            document.addEventListener('keydown', this._onKeyDown);

            this._onKeyUp = function(e) {
                if (e.key === ' ' || e.keyCode === 32) {
                    self._spaceHeld = false;
                    if (!self._isPanning) {
                        self.canvas.style.cursor = 'default';
                    }
                    return;
                }
            };
            document.addEventListener('keyup', this._onKeyUp);
        },

        _refreshPanel: function() {
            // Rebuild panel while preserving section open/close states and scroll position
            if (!this._panelBody) return;
            var scrollPos = this._panelBody.scrollTop;
            var sectionStates = [];
            var sections = this._panelBody.children;
            for (var si = 0; si < sections.length; si++) {
                var secBody = sections[si]._body;
                sectionStates.push(secBody ? secBody.style.display !== 'none' : true);
            }
            this._updatePanel();
            var newSections = this._panelBody.children;
            for (var ri = 0; ri < newSections.length && ri < sectionStates.length; ri++) {
                var rBody = newSections[ri]._body;
                var rArrow = newSections[ri]._arrow;
                var rSummary = newSections[ri]._summary;
                if (rBody) {
                    rBody.style.display = sectionStates[ri] ? '' : 'none';
                    if (rArrow) rArrow.textContent = sectionStates[ri] ? '\u25BC' : '\u25B6';
                    if (rSummary) rSummary.style.display = sectionStates[ri] ? 'none' : '';
                }
            }
            this._panelBody.scrollTop = scrollPos;
        },

        _updatePanel: function() {
            if (!this._panelBody || !this._editMode) return;
            var body = this._panelBody;
            body.innerHTML = '';
            var es = this._editorState;
            var colors = PALETTES[this._currentPalette || 'corporate'] || PALETTES.corporate;
            var self = this;

            if (this._selectedNodeIds.length === 1) {
                var nodeId = this._selectedNodeIds[0];
                var ns = es.nodes[nodeId] || {};
                this._panelTitle.textContent = ns.label || nodeId;
                this._buildNodePanel(body, nodeId, ns, colors);
            } else if (this._selectedNodeIds.length > 1) {
                this._panelTitle.textContent = this._selectedNodeIds.length + ' nodes';
                this._buildMultiSelectPanel(body);
            } else if (this._selectedConnection !== null && this._selectedConnection !== undefined) {
                this._panelTitle.textContent = 'Connection';
                this._buildConnectionPanel(body);
            } else {
                this._panelTitle.textContent = 'Canvas Tools';
                this._buildCanvasToolsPanel(body);
            }
        },

        _buildCanvasToolsPanel: function(body) {
            var self = this;

            // ── Canvas Tools Section ──
            var toolsSec = createPanelSection('Canvas Tools', '', true);
            var toolsBody = toolsSec._body;

            toolsBody.appendChild(createToggleRow('Grid', [
                {value: 'off', label: 'Off'},
                {value: 'on', label: 'On'}
            ], self._gridEnabled ? 'on' : 'off', function(val) {
                self._gridEnabled = (val === 'on');
                self.invalidateUpdateView();
            }));

            toolsBody.appendChild(createToggleRow('Grid Size', [
                {value: '10', label: '10'},
                {value: '20', label: '20'},
                {value: '50', label: '50'}
            ], String(self._gridSize), function(val) {
                self._gridSize = parseInt(val, 10);
                self.invalidateUpdateView();
            }));

            toolsBody.appendChild(createToggleRow('Snap', [
                {value: 'off', label: 'Off'},
                {value: 'on', label: 'On'}
            ], self._snapEnabled ? 'on' : 'off', function(val) {
                self._snapEnabled = (val === 'on');
                self.invalidateUpdateView();
            }));

            body.appendChild(toolsSec);

            // ── Align Section (collapsed, needs multi-select) ──
            var alignSec = createPanelSection('Align', '', false);
            var alignBody = alignSec._body;

            var noteEl = document.createElement('div');
            noteEl.textContent = 'Select 2+ nodes';
            noteEl.style.cssText = 'color:#94a3b8;font:11px -apple-system,BlinkMacSystemFont,sans-serif;padding:6px 10px 2px 10px;';
            alignBody.appendChild(noteEl);

            var alignBtnGroups = [
                [{label: 'Left'}, {label: 'Center'}, {label: 'Right'}],
                [{label: 'Top'}, {label: 'Center'}, {label: 'Bottom'}],
                [{label: 'Distrib H'}, {label: 'Distrib V'}]
            ];
            for (var gi = 0; gi < alignBtnGroups.length; gi++) {
                var grp = alignBtnGroups[gi];
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:4px;padding:4px 10px;';
                for (var bi = 0; bi < grp.length; bi++) {
                    var btn = document.createElement('button');
                    btn.textContent = grp[bi].label;
                    btn.disabled = true;
                    btn.style.cssText = 'flex:1;padding:4px 2px;border-radius:4px;border:1px solid #334155;background:rgba(30,41,59,0.5);color:#475569;font:10px -apple-system,BlinkMacSystemFont,sans-serif;cursor:not-allowed;';
                    row.appendChild(btn);
                }
                alignBody.appendChild(row);
            }

            body.appendChild(alignSec);
        },

        _buildMultiSelectPanel: function(body) {
            var self = this;
            var es = this._editorState;

            // ── Selection Section ──
            var selSec = createPanelSection('Selection', '', true);
            var selBody = selSec._body;

            var countEl = document.createElement('div');
            countEl.textContent = self._selectedNodeIds.length + ' nodes selected';
            countEl.style.cssText = 'color:#cbd5e1;font:11px -apple-system,BlinkMacSystemFont,sans-serif;padding:6px 10px 8px 10px;';
            selBody.appendChild(countEl);

            // Align buttons — descriptive labels like PowerPoint
            // Horizontal alignment row
            var hAlignLabel = document.createElement('div');
            hAlignLabel.textContent = 'HORIZONTAL';
            hAlignLabel.style.cssText = 'color:#64748b;font-size:8px;padding:4px 10px 2px;text-transform:uppercase;letter-spacing:0.5px;';
            selBody.appendChild(hAlignLabel);
            var hAlignDefs = [
                {label: '\u2502\u2590 Left', dir: 'left'},
                {label: '\u2503 Center', dir: 'center'},
                {label: '\u258C\u2502 Right', dir: 'right'}
            ];
            var hRow = document.createElement('div');
            hRow.style.cssText = 'display:flex;gap:4px;padding:2px 10px;';
            for (var hai = 0; hai < hAlignDefs.length; hai++) {
                (function(btnDef) {
                    var btn = document.createElement('button');
                    btn.textContent = btnDef.label;
                    btn.style.cssText = 'flex:1;padding:5px 2px;border-radius:4px;border:1px solid #334155;background:rgba(30,41,59,0.8);color:#cbd5e1;font:10px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;transition:background 0.15s;';
                    btn.addEventListener('mouseenter', function() { btn.style.background = '#334155'; });
                    btn.addEventListener('mouseleave', function() { btn.style.background = 'rgba(30,41,59,0.8)'; });
                    btn.addEventListener('click', function() {
                        alignNodes(self._editorState, self._selectedNodeIds, self._computedNodeMap, btnDef.dir);
                        self._pushUndo();
                        self.invalidateUpdateView();
                    });
                    btn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                    hRow.appendChild(btn);
                })(hAlignDefs[hai]);
            }
            selBody.appendChild(hRow);

            // Vertical alignment row
            var vAlignLabel = document.createElement('div');
            vAlignLabel.textContent = 'VERTICAL';
            vAlignLabel.style.cssText = 'color:#64748b;font-size:8px;padding:6px 10px 2px;text-transform:uppercase;letter-spacing:0.5px;';
            selBody.appendChild(vAlignLabel);
            var vAlignDefs = [
                {label: '\u2500\u2580 Top', dir: 'top'},
                {label: '\u2501 Middle', dir: 'middle'},
                {label: '\u2584\u2500 Bottom', dir: 'bottom'}
            ];
            var vRow = document.createElement('div');
            vRow.style.cssText = 'display:flex;gap:4px;padding:2px 10px;';
            for (var vai = 0; vai < vAlignDefs.length; vai++) {
                (function(btnDef) {
                    var btn = document.createElement('button');
                    btn.textContent = btnDef.label;
                    btn.style.cssText = 'flex:1;padding:5px 2px;border-radius:4px;border:1px solid #334155;background:rgba(30,41,59,0.8);color:#cbd5e1;font:10px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;transition:background 0.15s;';
                    btn.addEventListener('mouseenter', function() { btn.style.background = '#334155'; });
                    btn.addEventListener('mouseleave', function() { btn.style.background = 'rgba(30,41,59,0.8)'; });
                    btn.addEventListener('click', function() {
                        alignNodes(self._editorState, self._selectedNodeIds, self._computedNodeMap, btnDef.dir);
                        self._pushUndo();
                        self.invalidateUpdateView();
                    });
                    btn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                    vRow.appendChild(btn);
                })(vAlignDefs[vai]);
            }
            selBody.appendChild(vRow);

            // Distribute buttons
            var distLabel = document.createElement('div');
            distLabel.textContent = 'DISTRIBUTE';
            distLabel.style.cssText = 'color:#64748b;font-size:8px;padding:6px 10px 2px;text-transform:uppercase;letter-spacing:0.5px;';
            selBody.appendChild(distLabel);
            var distRow = document.createElement('div');
            distRow.style.cssText = 'display:flex;gap:4px;padding:2px 10px 6px 10px;';
            var distBtns = [{label: '\u2194 Horizontal', axis: 'horizontal'}, {label: '\u2195 Vertical', axis: 'vertical'}];
            for (var di = 0; di < distBtns.length; di++) {
                (function(btnDef) {
                    var btn = document.createElement('button');
                    btn.textContent = btnDef.label;
                    btn.style.cssText = 'flex:1;padding:5px 2px;border-radius:4px;border:1px solid #334155;background:rgba(30,41,59,0.8);color:#cbd5e1;font:10px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;transition:background 0.15s;';
                    btn.addEventListener('mouseenter', function() { btn.style.background = '#334155'; });
                    btn.addEventListener('mouseleave', function() { btn.style.background = 'rgba(30,41,59,0.8)'; });
                    btn.addEventListener('click', function() {
                        distributeNodes(self._editorState, self._selectedNodeIds, self._computedNodeMap, btnDef.axis);
                        self._pushUndo();
                        self.invalidateUpdateView();
                    });
                    btn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                    distRow.appendChild(btn);
                })(distBtns[di]);
            }
            selBody.appendChild(distRow);

            body.appendChild(selSec);

            // ── Shared Properties Section ──
            var sharedSec = createPanelSection('Shared Properties', '', true);
            var sharedBody = sharedSec._body;

            // Determine mixed values
            function sharedValue(prop, defaultVal) {
                var first = null;
                for (var si = 0; si < self._selectedNodeIds.length; si++) {
                    var nd = es.nodes[self._selectedNodeIds[si]] || {};
                    var v = nd[prop] || defaultVal;
                    if (first === null) { first = v; }
                    else if (v !== first) { return 'mixed'; }
                }
                return first || defaultVal;
            }

            function makeMultiOnChange(prop) {
                return function(val) {
                    self._pushUndo();
                    for (var si = 0; si < self._selectedNodeIds.length; si++) {
                        var sid = self._selectedNodeIds[si];
                        if (!es.nodes[sid]) es.nodes[sid] = {};
                        es.nodes[sid][prop] = val;
                    }
                    self.invalidateUpdateView();
                    self._updatePanel();
                };
            }

            var currentShape = sharedValue('shape', 'rect');
            var shapeOptions = [
                {value: 'rect', label: 'Rect'}, {value: 'circle', label: 'Circle'},
                {value: 'diamond', label: 'Diamond'}, {value: 'hexagon', label: 'Hexagon'},
                {value: 'triangle', label: 'Triangle'}, {value: 'cylinder', label: 'Cylinder'},
                {value: 'cloud', label: 'Cloud'}, {value: 'pill', label: 'Pill'}
            ];
            if (currentShape === 'mixed') {
                shapeOptions.push({value: 'mixed', label: 'Mixed'});
            }
            sharedBody.appendChild(createToggleRow('Shape', shapeOptions, currentShape, makeMultiOnChange('shape')));

            var colors = PALETTES[this._currentPalette || 'corporate'] || PALETTES.corporate;
            var currentColor = sharedValue('color', '');
            sharedBody.appendChild(createColorRow('Color', colors, currentColor === 'mixed' ? '' : currentColor, makeMultiOnChange('color')));

            var currentOpacity = sharedValue('opacity', 'default');
            var opacityOptions = [
                {value: 'default', label: '100%'}, {value: '0.8', label: '80%'},
                {value: '0.6', label: '60%'}, {value: '0.4', label: '40%'}
            ];
            if (currentOpacity === 'mixed') {
                opacityOptions.push({value: 'mixed', label: 'Mixed'});
            }
            sharedBody.appendChild(createToggleRow('Opacity', opacityOptions, currentOpacity, makeMultiOnChange('opacity')));

            body.appendChild(sharedSec);
        },

        _buildNodePanel: function(body, nodeId, ns, colors) {
            var es = this._editorState;
            var self = this;

            // Helper to create onChange callback that does NOT rebuild the panel
            // (safe for color pickers and non-structural changes)
            function makeOnChange(prop) {
                return function(val) {
                    self._pushUndo(); // capture pre-mutation state for correct undo
                    if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                    es.nodes[nodeId][prop] = val;
                    self.invalidateUpdateView();
                };
            }

            // Helper for properties that change panel structure (shows/hides sub-controls)
            function makeOnChangeAndRefresh(prop) {
                return function(val) {
                    self._pushUndo();
                    if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                    es.nodes[nodeId][prop] = val;
                    self.invalidateUpdateView();
                    self._refreshPanel();
                };
            }

            // ── Appearance Section ──
            var appearSec = createPanelSection('Appearance', '', true);
            var appearBody = appearSec._body;

            // Z-Order (Layer)
            appearBody.appendChild(createToggleRow('Layer', [
                {value: 'back', label: 'Back'}, {value: 'default', label: 'Default'}, {value: 'front', label: 'Front'}
            ], ns.zOrder || 'default', makeOnChange('zOrder')));

            var zBtnRow = document.createElement('div');
            zBtnRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';

            var bringFwdBtn = document.createElement('button');
            bringFwdBtn.textContent = 'Bring Forward';
            bringFwdBtn.style.cssText = 'flex:1;padding:4px;border-radius:4px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:10px;cursor:pointer;';
            bringFwdBtn.addEventListener('click', function() {
                if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                var cur = parseInt(es.nodes[nodeId].zOrder, 10) || 0;
                es.nodes[nodeId].zOrder = String(cur + 1);
                self._pushUndo();
                self.invalidateUpdateView();
            });

            var sendBackBtn = document.createElement('button');
            sendBackBtn.textContent = 'Send Back';
            sendBackBtn.style.cssText = 'flex:1;padding:4px;border-radius:4px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:10px;cursor:pointer;';
            sendBackBtn.addEventListener('click', function() {
                if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                var cur = parseInt(es.nodes[nodeId].zOrder, 10) || 0;
                es.nodes[nodeId].zOrder = String(cur - 1);
                self._pushUndo();
                self.invalidateUpdateView();
            });

            zBtnRow.appendChild(sendBackBtn);
            zBtnRow.appendChild(bringFwdBtn);
            appearBody.appendChild(zBtnRow);

            // Shape
            var currentShape = ns.shape || 'rect';
            appearBody.appendChild(createToggleRow('Shape', [
                {value: 'rect', label: 'Rect'}, {value: 'circle', label: 'Circle'},
                {value: 'diamond', label: 'Diamond'}, {value: 'hexagon', label: 'Hexagon'},
                {value: 'triangle', label: 'Triangle'}, {value: 'cylinder', label: 'Cylinder'},
                {value: 'cloud', label: 'Cloud'}, {value: 'pill', label: 'Pill'}
            ], currentShape, makeOnChangeAndRefresh('shape')));

            // Chart Color (accent/palette color)
            appearBody.appendChild(createColorRow('Chart Color', colors, ns.color || '', makeOnChange('color')));

            // Background Color override
            appearBody.appendChild(createColorRow('Background', colors, ns.bgColor || '', makeOnChange('bgColor')));

            // Border Color override
            appearBody.appendChild(createColorRow('Border Color', colors, ns.borderColor || '', makeOnChange('borderColor')));

            // Border Radius (only for rect)
            if (currentShape === 'rect') {
                appearBody.appendChild(createToggleRow('Border Radius', [
                    {value: '0', label: '0'}, {value: '4', label: '4'},
                    {value: '8', label: '8'}, {value: '12', label: '12'},
                    {value: '20', label: '20'}, {value: '50', label: '50'}
                ], ns.borderRadius || '0', makeOnChange('borderRadius')));
                appearBody.appendChild(createTextRow('Custom Radius', ns.borderRadius || '', makeOnChange('borderRadius'), { numeric: true, min: 0, max: 100, step: 1 }));
            }

            // Opacity
            appearBody.appendChild(createToggleRow('Opacity', [
                {value: 'default', label: '100%'}, {value: '0.8', label: '80%'},
                {value: '0.6', label: '60%'}, {value: '0.4', label: '40%'}
            ], ns.opacity || 'default', makeOnChange('opacity')));
            var opacityOnChange = makeOnChange('opacity');
            appearBody.appendChild(createTextRow('Custom %', String(Math.round((parseFloat(ns.opacity) || 1) * 100)), function(val) {
                var pct = parseInt(val, 10);
                if (!isNaN(pct) && pct >= 0 && pct <= 100) {
                    opacityOnChange(String(pct / 100));
                }
            }, { numeric: true, min: 0, max: 100, step: 5 }));

            // Stroke Pattern
            appearBody.appendChild(createToggleRow('Stroke Pattern', [
                {value: 'solid', label: 'Solid'}, {value: 'dashed', label: 'Dashed'},
                {value: 'dotted', label: 'Dotted'}, {value: 'dash-dot', label: 'Dash-Dot'},
                {value: 'long-dash', label: 'Long'}
            ], ns.strokePattern || 'solid', makeOnChange('strokePattern')));

            // Custom Dash/Gap
            appearBody.appendChild(createTextRow('Dash Length', ns.strokeDash || '', makeOnChange('strokeDash'), { numeric: true, min: 1, max: 100, step: 1 }));
            appearBody.appendChild(createTextRow('Gap Length', ns.strokeGap || '', makeOnChange('strokeGap'), { numeric: true, min: 1, max: 100, step: 1 }));

            // Border Width
            appearBody.appendChild(createToggleRow('Border Width', [
                {value: 'default', label: 'Auto'}, {value: '0', label: 'None'},
                {value: '1', label: 'Thin'}, {value: '2', label: 'Med'},
                {value: '3', label: 'Thick'}
            ], ns.borderWidth || 'default', makeOnChange('borderWidth')));
            appearBody.appendChild(createTextRow('Custom Width (px)', ns.borderWidth || '', makeOnChange('borderWidth'), { numeric: true, min: 0, max: 20, step: 1 }));

            body.appendChild(appearSec);

            // ── Text & Value or Content Section ──
            if (currentShape === 'textbox') {
                // Textbox: show markdown content textarea
                var contentSection = createPanelSection('Content', '', true);
                var ta = document.createElement('textarea');
                ta.value = ns.markdownContent || '## Title\n\nText here';
                ta.style.cssText = 'width:100%;box-sizing:border-box;height:120px;padding:8px;' +
                    'border-radius:4px;border:1px solid #334155;background:#0f172a;color:#cbd5e1;' +
                    'font:11px monospace;resize:vertical;';
                ta.addEventListener('input', function() {
                    if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                    es.nodes[nodeId].markdownContent = ta.value;
                    self.invalidateUpdateView();
                });
                ta.addEventListener('blur', function() {
                    self._pushUndo();
                });
                ta.addEventListener('keydown', function(e) { e.stopPropagation(); });
                contentSection._body.appendChild(ta);
                body.appendChild(contentSection);
            } else {
                var textSec = createPanelSection('Text & Value', '', false);
                var textBody = textSec._body;

                // Label
                textBody.appendChild(createTextRow('Label', ns.label || '', makeOnChange('label')));

                // Value show/hide
                var isHidden = ns.hideValue ? true : false;
                textBody.appendChild(createToggleRow('Value', [
                    {value: false, label: 'Show'}, {value: true, label: 'Hide'}
                ], isHidden, makeOnChangeAndRefresh('hideValue')));

                // Raw Value
                textBody.appendChild(createToggleRow('Raw Value', [
                    {value: 'truncated', label: 'Truncated'}, {value: 'full', label: 'Full'}
                ], ns.rawValue || 'truncated', makeOnChange('rawValue')));

                // Prefix
                textBody.appendChild(createTextRow('Prefix', ns.prefix || '', makeOnChange('prefix')));

                // Suffix
                textBody.appendChild(createTextRow('Suffix', ns.suffix || '', makeOnChange('suffix')));

                // Font Size
                textBody.appendChild(createToggleRow('Font Size', [
                    {value: 'default', label: 'Auto'}, {value: 'small', label: 'S'},
                    {value: 'medium', label: 'M'}, {value: 'large', label: 'L'},
                    {value: 'xlarge', label: 'XL'}
                ], ns.fontSize || 'default', makeOnChange('fontSize')));
                textBody.appendChild(createTextRow('Custom Font (px)', ns.customFontSize || '', makeOnChange('customFontSize'), { numeric: true, min: 6, max: 72, step: 1 }));

                // H. Align
                textBody.appendChild(createToggleRow('H. Align', [
                    {value: 'left', label: 'Left'}, {value: 'center', label: 'Center'},
                    {value: 'right', label: 'Right'}
                ], ns.textAlign || 'center', makeOnChange('textAlign')));

                // V. Align
                textBody.appendChild(createToggleRow('V. Align', [
                    {value: 'top', label: 'Top'}, {value: 'center', label: 'Center'},
                    {value: 'bottom', label: 'Bottom'}
                ], ns.verticalAlign || 'center', makeOnChange('verticalAlign')));

                // Label Color (hex + picker only, no swatches)
                textBody.appendChild(createColorRow('Label Color', [], ns.labelColor || '', makeOnChange('labelColor')));

                // Value Color (hex + picker only, no swatches)
                textBody.appendChild(createColorRow('Value Color', [], ns.valueColor || '', makeOnChange('valueColor')));

                // Padding
                textBody.appendChild(createToggleRow('Padding', [
                    {value: 'compact', label: 'Compact'}, {value: 'normal', label: 'Normal'},
                    {value: 'spacious', label: 'Spacious'}
                ], ns.padding || 'normal', makeOnChange('padding')));
                textBody.appendChild(createTextRow('Custom Padding', ns.customPadding || '', makeOnChange('customPadding'), { numeric: true, min: 0, max: 50, step: 2 }));

                body.appendChild(textSec);
            }

            // ── Sparkline Section ──
            var sparkType = ns.sparklineType || '';
            var sparkPos = ns.sparkPosition || 'default';
            var sparkSummary = (sparkType || 'Auto') + ' / ' + (sparkPos === 'default' ? 'Below' : sparkPos);
            var sparkSec = createPanelSection('Sparkline', sparkSummary, false);
            var sparkBody = sparkSec._body;

            sparkBody.appendChild(createToggleRow('Chart Type', [
                {value: '', label: 'Auto'}, {value: 'line', label: 'Line'},
                {value: 'area', label: 'Area'}, {value: 'bar', label: 'Bar'},
                {value: 'step', label: 'Step'}, {value: 'dot', label: 'Dot'},
                {value: 'none', label: 'Off'}
            ], sparkType, makeOnChange('sparklineType')));

            sparkBody.appendChild(createToggleRow('Position', [
                {value: 'default', label: 'Below'}, {value: 'above', label: 'Above'},
                {value: 'behind', label: 'Behind'}, {value: 'left', label: 'Left'},
                {value: 'right', label: 'Right'}
            ], sparkPos, makeOnChange('sparkPosition')));

            sparkBody.appendChild(createToggleRow('Chart Height', [
                {value: 'default', label: 'Auto'}, {value: 'small', label: 'S'},
                {value: 'medium', label: 'M'}, {value: 'large', label: 'L'}
            ], ns.chartHeight || 'default', makeOnChange('chartHeight')));
            sparkBody.appendChild(createTextRow('Custom Height', ns.customChartHeight || '', makeOnChange('customChartHeight'), { numeric: true, min: 10, max: 200, step: 5 }));

            sparkBody.appendChild(createToggleRow('Hover Detail', [
                {value: 'off', label: 'Off'}, {value: 'on', label: 'On'}
            ], ns.sparkHover || 'off', makeOnChange('sparkHover')));

            // Trend indicator
            sparkBody.appendChild(createToggleRow('Trend', [
                {value: 'off', label: 'Off'}, {value: 'absolute', label: 'Absolute'}, {value: 'percent', label: 'Percent'}
            ], ns.trendDisplay || 'off', makeOnChangeAndRefresh('trendDisplay')));

            if (ns.trendDisplay && ns.trendDisplay !== 'off') {
                sparkBody.appendChild(createTextRow('Compare Back', ns.trendCompareBack || '1', makeOnChange('trendCompareBack'), { numeric: true, min: 1, max: 59, step: 1 }));
                sparkBody.appendChild(createColorRow('Trend Up', colors, ns.trendUpColor || '#22c55e', makeOnChange('trendUpColor')));
                sparkBody.appendChild(createColorRow('Trend Down', colors, ns.trendDownColor || '#ef4444', makeOnChange('trendDownColor')));
            }

            body.appendChild(sparkSec);

            // ── Effects Section ──
            var shadowOn = ns.shadowEnabled === 'on';
            var glowOn = ns.glowEnabled === 'on';
            var innerShadowOn = ns.innerShadow === 'on';
            var gradientOn = ns.gradientFill === 'on';
            var frostedOn = ns.frostedGlass === 'on';
            var effectsParts = [];
            if (shadowOn) effectsParts.push('Shadow');
            if (glowOn) effectsParts.push('Glow');
            if (innerShadowOn) effectsParts.push('Inner Shadow');
            if (gradientOn) effectsParts.push('Gradient');
            if (frostedOn) effectsParts.push('Frosted');
            var effectsSummary = effectsParts.length > 0 ? effectsParts.join(' + ') : 'None';
            var effectsSec = createPanelSection('Effects', effectsSummary, false);
            var effectsBody = effectsSec._body;

            effectsBody.appendChild(createToggleRow('Shadow', [
                {value: 'off', label: 'Off'}, {value: 'on', label: 'On'}
            ], ns.shadowEnabled || 'off', makeOnChangeAndRefresh('shadowEnabled')));

            if (shadowOn) {
                effectsBody.appendChild(createTextRow('Shadow Blur', ns.shadowBlur || '8', makeOnChange('shadowBlur'), { numeric: true, min: 0, max: 50, step: 1 }));
                effectsBody.appendChild(createTextRow('Shadow Offset X', ns.shadowOffsetX || '2', makeOnChange('shadowOffsetX'), { numeric: true, min: -50, max: 50, step: 1 }));
                effectsBody.appendChild(createTextRow('Shadow Offset Y', ns.shadowOffsetY || '4', makeOnChange('shadowOffsetY'), { numeric: true, min: -50, max: 50, step: 1 }));
                effectsBody.appendChild(createColorRow('Shadow Color', [], ns.shadowColor || '#000000', makeOnChange('shadowColor')));
            }

            effectsBody.appendChild(createToggleRow('Glow', [
                {value: 'off', label: 'Off'}, {value: 'on', label: 'On'}
            ], ns.glowEnabled || 'off', makeOnChangeAndRefresh('glowEnabled')));

            if (glowOn) {
                effectsBody.appendChild(createTextRow('Glow Blur', ns.glowBlur || '12', makeOnChange('glowBlur'), { numeric: true, min: 0, max: 50, step: 1 }));
                effectsBody.appendChild(createColorRow('Glow Color', [], ns.glowColor || '#3b82f6', makeOnChange('glowColor')));
            }

            effectsBody.appendChild(createToggleRow('Inner Shadow', [
                {value: 'off', label: 'Off'}, {value: 'on', label: 'On'}
            ], ns.innerShadow || 'off', makeOnChangeAndRefresh('innerShadow')));

            effectsBody.appendChild(createToggleRow('Gradient Fill', [
                {value: 'off', label: 'Off'}, {value: 'on', label: 'On'}
            ], ns.gradientFill || 'off', makeOnChangeAndRefresh('gradientFill')));

            if (gradientOn) {
                effectsBody.appendChild(createToggleRow('Gradient Dir.', [
                    {value: 'top-down', label: '\u2193'}, {value: 'left-right', label: '\u2192'},
                    {value: 'diagonal', label: '\u2198'}, {value: 'radial', label: '\u25CE'}
                ], ns.gradientDirection || 'top-down', makeOnChange('gradientDirection')));

                effectsBody.appendChild(createColorRow('Gradient Start', colors, ns.gradientStart || '', makeOnChange('gradientStart')));
                effectsBody.appendChild(createColorRow('Gradient End', colors, ns.gradientEnd || '', makeOnChange('gradientEnd')));
            }

            effectsBody.appendChild(createToggleRow('Frosted Glass', [
                {value: 'off', label: 'Off'}, {value: 'on', label: 'On'}
            ], ns.frostedGlass || 'off', makeOnChangeAndRefresh('frostedGlass')));

            body.appendChild(effectsSec);

            // ── Conditions Section ──
            var conds = ns.conditions || [];
            var condSummary = '';
            if (conds.length > 0) {
                condSummary = conds.length + ' rule' + (conds.length > 1 ? 's' : '');
                var ct = ns.conditionTarget || 'background';
                if (ct !== 'background') condSummary += ' \u2192 ' + ct;
            } else {
                condSummary = 'None';
            }
            var condSec = createPanelSection('Conditions', condSummary, false);
            var condBody = condSec._body;

            // Get the node's current computed value for presets and context display
            var computedNode = self._computedNodeMap ? self._computedNodeMap[nodeId] : null;
            var nodeValue = computedNode ? computedNode.value : 0;
            var nodeValueNum = parseFloat(nodeValue) || 0;

            // Current value context
            var valueCtx = document.createElement('div');
            valueCtx.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;background:#0f172a;border:1px solid #1e293b;border-radius:4px;margin-bottom:8px;';
            var valueLabel = document.createElement('span');
            valueLabel.textContent = 'Current value:';
            valueLabel.style.cssText = 'color:#64748b;font-size:9px;';
            var valueDisplay = document.createElement('span');
            valueDisplay.textContent = nodeValueNum ? formatCount(nodeValueNum) : String(nodeValue || 'N/A');
            valueDisplay.style.cssText = 'color:#e2e8f0;font-size:11px;font-weight:600;font-family:monospace;';
            valueCtx.appendChild(valueLabel);
            valueCtx.appendChild(valueDisplay);
            condBody.appendChild(valueCtx);

            // ── Dynamic Elements (where the condition color is applied) ──
            condBody.appendChild(createToggleRow('Dynamic Elements', [
                {value: 'none',       label: 'None'},
                {value: 'value',      label: 'Value'},
                {value: 'trend',      label: 'Trend'},
                {value: 'value+trend',label: 'Val+Trend'},
                {value: 'background', label: 'BG'},
                {value: 'border',     label: 'Border'},
                {value: 'sparkline',  label: 'Spark'},
                {value: 'all',        label: 'All'}
            ], ns.conditionTarget || 'background', makeOnChange('conditionTarget')));

            // ── Quick Presets ──
            var presetLabel = document.createElement('div');
            presetLabel.textContent = 'QUICK PRESETS';
            presetLabel.style.cssText = 'color:#64748b;font-size:8px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;';
            condBody.appendChild(presetLabel);

            var presetRow = document.createElement('div');
            presetRow.style.cssText = 'display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;';

            var presets = [
                {
                    label: 'Traffic Light',
                    create: function() {
                        var v = nodeValueNum || 100;
                        var lo = Math.round(v * 0.5);
                        var hi = Math.round(v * 1.5);
                        return [
                            {op: '<=', val: String(lo), color: '#22c55e'},
                            {op: '<=', val: String(hi), color: '#eab308'},
                            {op: '>', val: String(hi), color: '#ef4444'}
                        ];
                    }
                },
                {
                    label: 'Binary',
                    create: function() {
                        var v = nodeValueNum || 100;
                        var mid = Math.round(v);
                        return [
                            {op: '<=', val: String(mid), color: '#22c55e'},
                            {op: '>', val: String(mid), color: '#ef4444'}
                        ];
                    }
                },
                {
                    label: 'Heat Map',
                    create: function() {
                        var v = nodeValueNum || 100;
                        return [
                            {op: '<=', val: String(Math.round(v * 0.25)), color: '#3b82f6'},
                            {op: '<=', val: String(Math.round(v * 0.5)), color: '#22c55e'},
                            {op: '<=', val: String(Math.round(v * 1.5)), color: '#f97316'},
                            {op: '>', val: String(Math.round(v * 1.5)), color: '#ef4444'}
                        ];
                    }
                },
                {
                    label: 'Status Text',
                    create: function() {
                        return [
                            {op: 'contains', val: 'ok', color: '#22c55e'},
                            {op: 'contains', val: 'warn', color: '#eab308'},
                            {op: 'contains', val: 'error', color: '#ef4444'},
                            {op: 'contains', val: 'critical', color: '#dc2626'}
                        ];
                    }
                }
            ];

            for (var pi = 0; pi < presets.length; pi++) {
                (function(preset) {
                    var presetBtn = document.createElement('button');
                    presetBtn.textContent = preset.label;
                    presetBtn.style.cssText = 'padding:3px 8px;border-radius:3px;font-size:9px;font-weight:600;cursor:pointer;border:1px solid #334155;background:#1e293b;color:#94a3b8;transition:all 0.15s;';
                    presetBtn.addEventListener('mouseenter', function() {
                        presetBtn.style.borderColor = '#3b82f6';
                        presetBtn.style.color = '#93c5fd';
                        presetBtn.style.background = 'rgba(59,130,246,0.15)';
                    });
                    presetBtn.addEventListener('mouseleave', function() {
                        presetBtn.style.borderColor = '#334155';
                        presetBtn.style.color = '#94a3b8';
                        presetBtn.style.background = '#1e293b';
                    });
                    presetBtn.addEventListener('click', function() {
                        if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                        es.nodes[nodeId].conditions = preset.create();
                        self._pushUndo();
                        self.invalidateUpdateView();
                        self._refreshPanel();
                    });
                    presetBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                    presetRow.appendChild(presetBtn);
                })(presets[pi]);
            }
            condBody.appendChild(presetRow);

            // Reverse button — flips the order of existing conditions (high→low becomes low→high)
            if (conds.length > 1) {
                var reverseBtn = document.createElement('button');
                reverseBtn.textContent = '\u21C5 Reverse Order';
                reverseBtn.style.cssText = 'display:block;width:100%;padding:4px;border-radius:3px;font-size:9px;cursor:pointer;border:1px solid #334155;background:#1e293b;color:#94a3b8;margin-bottom:8px;transition:all 0.15s;';
                reverseBtn.addEventListener('mouseenter', function() { reverseBtn.style.borderColor = '#6366f1'; reverseBtn.style.color = '#a5b4fc'; });
                reverseBtn.addEventListener('mouseleave', function() { reverseBtn.style.borderColor = '#334155'; reverseBtn.style.color = '#94a3b8'; });
                reverseBtn.addEventListener('click', function() {
                    if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                    var reversed = [];
                    for (var rvi = conds.length - 1; rvi >= 0; rvi--) {
                        reversed.push(conds[rvi]);
                    }
                    es.nodes[nodeId].conditions = reversed;
                    self._pushUndo();
                    self.invalidateUpdateView();
                    self._refreshPanel();
                });
                reverseBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                condBody.appendChild(reverseBtn);
            }

            // ── Rules list ──
            if (conds.length > 0) {
                var rulesLabel = document.createElement('div');
                rulesLabel.textContent = 'RULES';
                rulesLabel.style.cssText = 'color:#64748b;font-size:8px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;';
                condBody.appendChild(rulesLabel);
            }

            for (var ci = 0; ci < conds.length; ci++) {
                (function(ruleIdx) {
                    var rule = conds[ruleIdx];
                    var ruleRow = document.createElement('div');
                    ruleRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:6px;padding:6px 8px;background:#0f172a;border-radius:6px;border:1px solid #1e293b;flex-wrap:wrap;';

                    // Color indicator (left)
                    var colorDot = document.createElement('div');
                    var dotColor = (rule.color && /^#[0-9a-fA-F]{6}$/.test(rule.color)) ? rule.color : '#ef4444';
                    colorDot.style.cssText = 'width:16px;height:16px;border-radius:3px;background:' + dotColor + ';cursor:pointer;flex-shrink:0;position:relative;';
                    // Hidden color picker behind the dot
                    var hiddenColor = document.createElement('input');
                    hiddenColor.type = 'color';
                    hiddenColor.value = dotColor;
                    hiddenColor.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:pointer;';
                    hiddenColor.addEventListener('input', function() {
                        if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                        if (!es.nodes[nodeId].conditions) es.nodes[nodeId].conditions = [];
                        if (es.nodes[nodeId].conditions[ruleIdx]) {
                            es.nodes[nodeId].conditions[ruleIdx].color = hiddenColor.value;
                        }
                        colorDot.style.background = hiddenColor.value;
                        self._pushUndo();
                        self.invalidateUpdateView();
                    });
                    hiddenColor.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                    colorDot.appendChild(hiddenColor);
                    ruleRow.appendChild(colorDot);

                    // "If value" label
                    var ifLabel = document.createElement('span');
                    ifLabel.textContent = 'If value';
                    ifLabel.style.cssText = 'color:#64748b;font-size:9px;white-space:nowrap;';
                    ruleRow.appendChild(ifLabel);

                    // Operator dropdown
                    var opSelect = document.createElement('select');
                    opSelect.style.cssText = 'background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:3px;font-size:9px;padding:3px 4px;min-width:70px;outline:none;';
                    var ops =      ['<',          '<=',      '>',           '>=',       '=',       '!=',        'contains'];
                    var opLabels = ['less than',  'at most', 'more than',   'at least', 'equals',  'not equal', 'contains'];
                    for (var oi = 0; oi < ops.length; oi++) {
                        var opt = document.createElement('option');
                        opt.value = ops[oi];
                        opt.textContent = opLabels[oi];
                        if (rule.op === ops[oi]) opt.selected = true;
                        opSelect.appendChild(opt);
                    }
                    opSelect.addEventListener('change', function() {
                        if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                        if (!es.nodes[nodeId].conditions) es.nodes[nodeId].conditions = [];
                        if (es.nodes[nodeId].conditions[ruleIdx]) {
                            es.nodes[nodeId].conditions[ruleIdx].op = opSelect.value;
                        }
                        self._pushUndo();
                        self.invalidateUpdateView();
                    });
                    opSelect.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                    ruleRow.appendChild(opSelect);

                    // Value input
                    var valInput = document.createElement('input');
                    valInput.type = 'text';
                    valInput.value = rule.val || '';
                    valInput.placeholder = 'value';
                    valInput.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:3px;font-size:10px;padding:3px 6px;outline:none;';
                    valInput.addEventListener('blur', function() {
                        if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                        if (!es.nodes[nodeId].conditions) es.nodes[nodeId].conditions = [];
                        if (es.nodes[nodeId].conditions[ruleIdx]) {
                            es.nodes[nodeId].conditions[ruleIdx].val = valInput.value;
                        }
                        self._pushUndo();
                        self.invalidateUpdateView();
                    });
                    valInput.addEventListener('keydown', function(e) {
                        e.stopPropagation();
                        if (e.key === 'Enter' || e.keyCode === 13) valInput.blur();
                    });
                    valInput.addEventListener('keyup', function(e) { e.stopPropagation(); });
                    valInput.addEventListener('keypress', function(e) { e.stopPropagation(); });
                    ruleRow.appendChild(valInput);

                    // (Per-rule target removed — use Dynamic Elements selector at section top)

                    // Delete button
                    var delBtn = document.createElement('button');
                    delBtn.textContent = '\u00D7';
                    delBtn.style.cssText = 'width:20px;height:20px;border-radius:3px;border:none;background:#dc2626;color:#fff;font-size:12px;cursor:pointer;flex-shrink:0;line-height:1;display:flex;align-items:center;justify-content:center;';
                    delBtn.addEventListener('click', function() {
                        if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                        if (!es.nodes[nodeId].conditions) es.nodes[nodeId].conditions = [];
                        es.nodes[nodeId].conditions.splice(ruleIdx, 1);
                        self._pushUndo();
                        self.invalidateUpdateView();
                        self._refreshPanel();
                    });
                    delBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                    ruleRow.appendChild(delBtn);

                    condBody.appendChild(ruleRow);
                })(ci);
            }

            // ── Bottom buttons: Add Rule + Clear All ──
            var condBtnRow = document.createElement('div');
            condBtnRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;';

            // Add Rule button
            var addRuleBtn = document.createElement('button');
            addRuleBtn.textContent = '+ Rule';
            addRuleBtn.style.cssText = 'padding:4px 12px;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;border:1px solid #3b82f6;background:rgba(59,130,246,0.2);color:#93c5fd;flex:1;';
            var ruleColors = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
            addRuleBtn.addEventListener('click', function() {
                if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                if (!es.nodes[nodeId].conditions) es.nodes[nodeId].conditions = [];
                var existingConds = es.nodes[nodeId].conditions;
                var nextColor = ruleColors[existingConds.length % ruleColors.length];
                // Auto-calculate value based on node value and existing rules
                var computedNode = self._computedNodeMap ? self._computedNodeMap[nodeId] : null;
                var nv = computedNode ? parseFloat(computedNode.value) || 0 : 0;
                var nextVal = '0';
                var nextOp = '>';
                if (existingConds.length === 0) {
                    // First rule: "at most" half the value
                    nextOp = '<=';
                    nextVal = String(Math.round(nv * 0.5));
                } else {
                    // Find the highest numeric val in existing rules
                    var maxExisting = 0;
                    for (var eci = 0; eci < existingConds.length; eci++) {
                        var ev = parseFloat(existingConds[eci].val);
                        if (!isNaN(ev) && ev > maxExisting) maxExisting = ev;
                    }
                    if (maxExisting > 0) {
                        // Next step: increment by ~50% of max or by the node value step
                        var step = Math.round(maxExisting * 0.5) || Math.round(nv * 0.25) || 100;
                        nextVal = String(Math.round(maxExisting + step));
                        nextOp = '<=';
                    } else {
                        nextVal = String(Math.round(nv * 0.5));
                        nextOp = '<=';
                    }
                }
                existingConds.push({op: nextOp, val: nextVal, color: nextColor});
                self._pushUndo();
                self.invalidateUpdateView();
                self._refreshPanel();
            });
            addRuleBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            condBtnRow.appendChild(addRuleBtn);

            // Clear All button (only show if rules exist)
            if (conds.length > 0) {
                var clearBtn = document.createElement('button');
                clearBtn.textContent = 'Clear All';
                clearBtn.style.cssText = 'padding:4px 12px;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;border:1px solid #dc2626;background:rgba(220,38,38,0.15);color:#fca5a5;';
                clearBtn.addEventListener('click', function() {
                    if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
                    es.nodes[nodeId].conditions = [];
                    self._pushUndo();
                    self.invalidateUpdateView();
                    self._refreshPanel();
                });
                clearBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
                condBtnRow.appendChild(clearBtn);
            }

            condBody.appendChild(condBtnRow);

            body.appendChild(condSec);
        },

        _startAnimationLoop: function() {
            if (this._animationFrame) return;
            var self = this;
            var targetInterval = 1000 / 30; // 30fps
            function tick(timestamp) {
                if (!self._hasActiveAnimations) {
                    self._animationFrame = null;
                    return;
                }
                if (timestamp - self._lastAnimTime >= targetInterval) {
                    self._animationOffset += 1;
                    self._lastAnimTime = timestamp;
                    self.invalidateUpdateView();
                }
                self._animationFrame = requestAnimationFrame(tick);
            }
            this._animationFrame = requestAnimationFrame(tick);
        },

        _stopAnimationLoop: function() {
            if (this._animationFrame) {
                cancelAnimationFrame(this._animationFrame);
                this._animationFrame = null;
            }
        },

        _buildConnectionPanel: function(body) {
            var idx = this._connPopupIdx;
            var conns = this._editorState.connections || [];
            if (idx === null || idx === undefined || idx >= conns.length) return;
            var conn = conns[idx];
            var self = this;
            var es = this._editorState;
            var colors = PALETTES[this._currentPalette || 'corporate'] || PALETTES.corporate;

            function makeConnChange(prop) {
                return function(val) {
                    self._pushUndo(); // capture pre-mutation state for correct undo
                    conns[idx][prop] = val;
                    self.invalidateUpdateView();
                };
            }

            // ── Style Section ──
            var styleSec = createPanelSection('Style', '', true);
            var styleBody = styleSec._body;

            // Line Style
            styleBody.appendChild(createToggleRow('Line Style', [
                {value: 'straight', label: 'Straight'},
                {value: 'curved', label: 'Curved'}
            ], conn.style || 'straight', makeConnChange('style')));

            // Width
            styleBody.appendChild(createToggleRow('Width', [
                {value: 1, label: '1'}, {value: 2, label: '2'},
                {value: 3, label: '3'}, {value: 4, label: '4'}
            ], conn.width || 2, makeConnChange('width')));

            // Stroke Pattern
            styleBody.appendChild(createToggleRow('Stroke Pattern', [
                {value: 'solid', label: 'Solid'}, {value: 'dashed', label: 'Dashed'},
                {value: 'dotted', label: 'Dotted'}, {value: 'dash-dot', label: 'Dash-Dot'},
                {value: 'long-dash', label: 'Long'}
            ], conn.strokePattern || 'solid', makeConnChange('strokePattern')));

            // Custom Dash/Gap
            styleBody.appendChild(createTextRow('Dash Length', conn.strokeDash || '', makeConnChange('strokeDash'), { numeric: true, min: 1, max: 100, step: 1 }));
            styleBody.appendChild(createTextRow('Gap Length', conn.strokeGap || '', makeConnChange('strokeGap'), { numeric: true, min: 1, max: 100, step: 1 }));

            // Color
            styleBody.appendChild(createColorRow('Color', colors, conn.color || '', makeConnChange('color')));

            body.appendChild(styleSec);

            // ── Endpoints Section ──
            var epSec = createPanelSection('Endpoints', '', true);
            var epBody = epSec._body;

            // Migrate old arrow field for display
            var startEp = conn.startEndpoint || 'none';
            var endEp = conn.endEndpoint || 'filledArrow';
            if (conn.arrow && !conn.startEndpoint && !conn.endEndpoint) {
                if (conn.arrow === 'forward') { startEp = 'none'; endEp = 'filledArrow'; }
                else if (conn.arrow === 'backward') { startEp = 'filledArrow'; endEp = 'none'; }
                else if (conn.arrow === 'both') { startEp = 'filledArrow'; endEp = 'filledArrow'; }
                else { startEp = 'none'; endEp = 'none'; }
            }

            var epTypes = [
                {value: 'none', label: '\u2014'},
                {value: 'filledArrow', label: '\u25C0'},
                {value: 'openArrow', label: '\u25C1'},
                {value: 'filledBall', label: '\u25CF'},
                {value: 'ball', label: '\u25CB'},
                {value: 'filledDiamond', label: '\u25C6'},
                {value: 'diamond', label: '\u25C7'},
                {value: 'bar', label: '|'}
            ];

            var endEpTypes = [
                {value: 'none', label: '\u2014'},
                {value: 'filledArrow', label: '\u25B6'},
                {value: 'openArrow', label: '\u25B7'},
                {value: 'filledBall', label: '\u25CF'},
                {value: 'ball', label: '\u25CB'},
                {value: 'filledDiamond', label: '\u25C6'},
                {value: 'diamond', label: '\u25C7'},
                {value: 'bar', label: '|'}
            ];

            // Start Type
            epBody.appendChild(createToggleRow('Start Type', epTypes, startEp, function(val) {
                conns[idx].startEndpoint = val;
                delete conns[idx].arrow;
                self._pushUndo();
                self.invalidateUpdateView();
            }));

            // Start Flip
            epBody.appendChild(createToggleRow('Start Flip', [
                {value: 'false', label: 'Off'}, {value: 'true', label: 'On'}
            ], conn.startFlipped ? 'true' : 'false', function(val) {
                conns[idx].startFlipped = (val === 'true');
                self._pushUndo();
                self.invalidateUpdateView();
            }));

            // End Type
            epBody.appendChild(createToggleRow('End Type', endEpTypes, endEp, function(val) {
                conns[idx].endEndpoint = val;
                delete conns[idx].arrow;
                self._pushUndo();
                self.invalidateUpdateView();
            }));

            // End Flip
            epBody.appendChild(createToggleRow('End Flip', [
                {value: 'false', label: 'Off'}, {value: 'true', label: 'On'}
            ], conn.endFlipped ? 'true' : 'false', function(val) {
                conns[idx].endFlipped = (val === 'true');
                self._pushUndo();
                self.invalidateUpdateView();
            }));

            // Endpoint Size
            epBody.appendChild(createTextRow('Endpoint Size', conn.endpointSize || '', function(val) {
                var num = parseInt(val, 10);
                if (val && !isNaN(num)) {
                    conns[idx].endpointSize = num;
                } else {
                    delete conns[idx].endpointSize;
                }
                self._pushUndo();
                self.invalidateUpdateView();
            }, { numeric: true, min: 1, max: 30, step: 1 }));

            body.appendChild(epSec);

            // ── Anchors Section ──
            var srcAnchor = conn.sourceAnchor || 'auto';
            var tgtAnchor = conn.targetAnchor || 'auto';
            var anchorSummary = srcAnchor + ' \u2192 ' + tgtAnchor;
            var anchorSec = createPanelSection('Anchors', anchorSummary, false);
            var anchorBody = anchorSec._body;

            var anchorOpts = [
                {value: 'auto', label: 'Auto'},
                {value: 'top', label: 'Top'},
                {value: 'bottom', label: 'Bottom'},
                {value: 'left', label: 'Left'},
                {value: 'right', label: 'Right'}
            ];

            anchorBody.appendChild(createToggleRow('Source Anchor', anchorOpts, srcAnchor, makeConnChange('sourceAnchor')));
            anchorBody.appendChild(createToggleRow('Target Anchor', anchorOpts, tgtAnchor, makeConnChange('targetAnchor')));

            anchorBody.appendChild(createTextRow('Source Offset', conn.sourceAnchorOffset || '', function(val) {
                var num = parseInt(val, 10);
                if (val && !isNaN(num)) {
                    conns[idx].sourceAnchorOffset = num;
                } else {
                    delete conns[idx].sourceAnchorOffset;
                }
                self._pushUndo();
                self.invalidateUpdateView();
            }, { numeric: true, min: -50, max: 50, step: 1 }));

            anchorBody.appendChild(createTextRow('Target Offset', conn.targetAnchorOffset || '', function(val) {
                var num = parseInt(val, 10);
                if (val && !isNaN(num)) {
                    conns[idx].targetAnchorOffset = num;
                } else {
                    delete conns[idx].targetAnchorOffset;
                }
                self._pushUndo();
                self.invalidateUpdateView();
            }, { numeric: true, min: -50, max: 50, step: 1 }));

            body.appendChild(anchorSec);

            // ── Label Section ──
            var labelSec = createPanelSection('Label', '', false);
            var labelBody = labelSec._body;

            labelBody.appendChild(createTextRow('Label Text', conn.label || '', makeConnChange('label')));

            labelBody.appendChild(createTextRow('Position %', String(Math.round((conn.labelPosition !== undefined ? conn.labelPosition : 0.5) * 100)), function(val) {
                var pct = parseInt(val, 10);
                if (!isNaN(pct)) {
                    conns[idx].labelPosition = Math.max(0, Math.min(100, pct)) / 100;
                    self._pushUndo();
                    self.invalidateUpdateView();
                }
            }, { numeric: true, min: 0, max: 100, step: 5 }));

            labelBody.appendChild(createTextRow('Font Size', conn.labelFontSize || '', makeConnChange('labelFontSize'), { numeric: true, min: 6, max: 36, step: 1 }));

            labelBody.appendChild(createColorRow('Text Color', colors, conn.labelColor || '', makeConnChange('labelColor')));

            labelBody.appendChild(createColorRow('Background', colors, conn.labelBgColor || '', makeConnChange('labelBgColor')));

            labelBody.appendChild(createColorRow('Border Color', colors, conn.labelBorderColor || '', makeConnChange('labelBorderColor')));

            labelBody.appendChild(createToggleRow('Border Style', [
                {value: 'solid', label: 'Solid'}, {value: 'dashed', label: 'Dashed'},
                {value: 'dotted', label: 'Dotted'}, {value: 'none', label: 'None'}
            ], conn.labelBorderStyle || 'solid', makeConnChange('labelBorderStyle')));

            labelBody.appendChild(createTextRow('Border Width', conn.labelBorderWidth || '', makeConnChange('labelBorderWidth'), { numeric: true, min: 0, max: 6, step: 0.5 }));

            labelBody.appendChild(createTextRow('Border Radius', conn.labelBorderRadius || '', makeConnChange('labelBorderRadius'), { numeric: true, min: 0, max: 20, step: 1 }));

            body.appendChild(labelSec);

            // ── Animation Section ──
            var animSec = createPanelSection('Animation', '', false);
            var animBody = animSec._body;

            // Animation Type
            animBody.appendChild(createToggleRow('Type', [
                {value: 'none', label: 'None'},
                {value: 'marching-ants', label: 'March'},
                {value: 'pulse', label: 'Pulse'}
            ], conn.animationType || 'none', makeConnChange('animationType')));

            // Animation Trigger
            animBody.appendChild(createToggleRow('Trigger', [
                {value: 'always', label: 'Always'},
                {value: 'hover', label: 'Hover'},
                {value: 'click', label: 'Click'}
            ], conn.animationTrigger || 'always', makeConnChange('animationTrigger')));

            // Animation Speed
            animBody.appendChild(createToggleRow('Speed', [
                {value: 'slow', label: 'Slow'},
                {value: 'medium', label: 'Med'},
                {value: 'fast', label: 'Fast'}
            ], conn.animationSpeed || 'medium', makeConnChange('animationSpeed')));

            body.appendChild(animSec);
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data) {
            // NOTE: never read config here — only in updateView
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data \u2014 Business Process Flow'
                );
            }

            var fields = data.fields;
            var rows = data.rows;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            // Detect format: timechart if first field is _time
            var isTimechart = fields.length > 0 && fields[0].name === '_time';
            var nodes = [];

            if (isTimechart) {
                // Format B: timechart — each column (after _time) is a node
                for (var fi = 1; fi < fields.length; fi++) {
                    var seriesName = fields[fi].name;
                    var series = [];
                    var lastVal = 0;

                    for (var ri = 0; ri < rows.length; ri++) {
                        var val = rows[ri][fi];
                        if (val !== null && val !== undefined && val !== '') {
                            var numVal = Number(val);
                            if (!isNaN(numVal)) {
                                series.push(numVal);
                                lastVal = numVal;
                            } else {
                                series.push(null);
                            }
                        } else {
                            series.push(null);
                        }
                    }

                    nodes.push({
                        id: seriesName,
                        label: seriesName,
                        value: lastVal,
                        step: null,
                        connectsTo: [],
                        series: series,
                        subtitle: '',
                        rowIndex: fi
                    });
                }
            } else {
                // Format A: stats/table — each row is a node
                // Field resolution deferred to updateView; pass colIdx and rows
                for (var rj = 0; rj < rows.length; rj++) {
                    nodes.push({ rowIndex: rj });
                }
            }

            var result = {
                nodes: nodes,
                isTimechart: isTimechart,
                colIdx: colIdx,
                rows: rows
            };

            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            // 1. Data fallback
            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            // 2. Read all config settings with defaults matching formatter.html
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var labelField    = config[ns + 'labelField']    || 'sourcetype';
            var valueField    = config[ns + 'valueField']    || 'count';
            var subtitleField = config[ns + 'subtitleField'] || '';
            var palette       = config[ns + 'palette']       || 'corporate';
            var accentLine    = config[ns + 'accentLine']    || 'false';
            var sparklineType = config[ns + 'sparklineType'] || 'area';
            var nodeRadius    = config[ns + 'nodeRadius']    || '8';
            var lock          = config[ns + 'lock']          || 'false';
            var editorStateStr = config[ns + 'editorState']  || '';
            var drilldownField = config[ns + 'drilldownField'] || 'sourcetype';
            var globalRawValue = config[ns + 'rawValue'] === 'true';
            var globalShadowEnabled = config[ns + 'shadowEnabled'] === 'true';
            var globalShadowBlur = parseInt(config[ns + 'shadowBlur'], 10) || 8;
            var globalShadowOffsetX = parseInt(config[ns + 'shadowOffsetX'], 10) || 2;
            var globalShadowOffsetY = parseInt(config[ns + 'shadowOffsetY'], 10) || 2;
            var globalShadowColor = config[ns + 'shadowColor'] || '#000000';
            var globalGlowEnabled = config[ns + 'glowEnabled'] === 'true';
            var globalGlowBlur = parseInt(config[ns + 'glowBlur'], 10) || 12;
            var globalGlowColor = config[ns + 'glowColor'] || '#3b82f6';
            var globalDefaultOpacity = config[ns + 'defaultOpacity'] || '1';
            var globalDefaultStrokePattern = config[ns + 'defaultStrokePattern'] || 'solid';
            var globalDefaultBorderWidth = config[ns + 'defaultBorderWidth'] || '1';
            var globalDefaultBorderColor = config[ns + 'defaultBorderColor'] || '';
            var globalDefaultBgColor = config[ns + 'defaultBgColor'] || '';

            // Edit mode is session-only — controlled by DOM Edit button, not config
            this._lockMode = lock === 'true';
            this._drilldownField = drilldownField;
            this._currentPalette = palette;
            this._globalEffects = {
                rawValue: globalRawValue,
                shadowEnabled: globalShadowEnabled, shadowBlur: globalShadowBlur,
                shadowOffsetX: globalShadowOffsetX, shadowOffsetY: globalShadowOffsetY,
                shadowColor: globalShadowColor,
                glowEnabled: globalGlowEnabled, glowBlur: globalGlowBlur, glowColor: globalGlowColor,
                defaultOpacity: globalDefaultOpacity,
                defaultStrokePattern: globalDefaultStrokePattern,
                defaultBorderWidth: globalDefaultBorderWidth,
                defaultBorderColor: globalDefaultBorderColor,
                defaultBgColor: globalDefaultBgColor
            };

            // Start periodic auto-sync: localStorage → formatter textarea.
            // Formatter textarea only exists when Dashboard Studio edit mode is open
            // AND the user has clicked on this panel. We poll to catch that moment.
            if (!this._syncInterval) {
                var syncSelf = this;
                this._syncInterval = setInterval(function() {
                    try {
                        var lsData = localStorage.getItem(syncSelf._getStorageKey());
                        if (!lsData) return;
                        var syncNs = '';
                        try { syncNs = syncSelf.getPropertyNamespaceInfo().propertyNamespace; } catch(e4) {}
                        var syncName = syncNs + 'editorState';
                        var allTas = document.querySelectorAll('splunk-text-area, textarea');
                        for (var st = 0; st < allTas.length; st++) {
                            var syncTa = allTas[st];
                            if ((syncTa.getAttribute('name') || '') === syncName) {
                                var curVal = '';
                                if (syncTa.tagName.toLowerCase() === 'splunk-text-area') {
                                    var syncInner = syncTa.querySelector('textarea');
                                    curVal = syncInner ? syncInner.value : (syncTa.getAttribute('value') || '');
                                } else {
                                    curVal = syncTa.value || '';
                                }
                                if (curVal !== lsData) {
                                    if (syncTa.tagName.toLowerCase() === 'splunk-text-area') {
                                        syncTa.setAttribute('value', lsData);
                                        var syncInn = syncTa.querySelector('textarea');
                                        if (syncInn) syncInn.value = lsData;
                                    } else {
                                        syncTa.value = lsData;
                                    }
                                    var syncEvt = document.createEvent('Event');
                                    syncEvt.initEvent('change', true, true);
                                    syncTa.dispatchEvent(syncEvt);
                                }
                                break;
                            }
                        }
                    } catch(e5) { /* ignore */ }
                }, 2000);
            }

            // 3. Parse editorState — config (dashboard JSON) first, localStorage fallback
            var stateSource = editorStateStr || '';
            if (!stateSource) {
                try {
                    stateSource = localStorage.getItem(this._getStorageKey()) || '';
                } catch (e) { /* ignore */ }
            }
            if (stateSource && !this._editorStateLoaded) {
                this._editorStateLoaded = true;
                try {
                    var parsed = JSON.parse(stateSource);
                    if (parsed && typeof parsed === 'object') {
                        if (parsed.nodes) {
                            this._editorState.nodes = parsed.nodes;
                        }
                        if (parsed.connections) {
                            this._editorState.connections = parsed.connections;
                        }
                        if (parsed.lock !== undefined) {
                            this._editorState.lock = parsed.lock;
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            // 4. Size canvas for HiDPI
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

            // 5. Detect theme
            var isDark = false;
            try {
                var themeUtil = SplunkVisualizationUtils.getCurrentTheme;
                if (themeUtil) {
                    var themeName = themeUtil();
                    isDark = themeName === 'dark';
                }
            } catch (e) {
                // fallback: check body class
                if (document.body.classList.contains('dark')) isDark = true;
            }
            var theme = getThemeColors(isDark);

            // 6. Get palette colors
            var colors = PALETTES[palette] || PALETTES.corporate;
            // Monochrome palette: reverse for light mode so dark chips show on light bg
            if (!isDark && palette === 'mono') {
                colors = colors.slice().reverse();
            }

            // 7. Resolve nodes from data
            var resolvedNodes = [];
            var colIdx = data.colIdx || {};
            var rows = data.rows || [];

            if (data.isTimechart) {
                // Timechart nodes are already resolved
                for (var ti = 0; ti < data.nodes.length; ti++) {
                    var tn = data.nodes[ti];
                    resolvedNodes.push({
                        id: tn.id,
                        label: tn.label,
                        value: tn.value,
                        step: tn.step,
                        connectsTo: tn.connectsTo,
                        series: tn.series,
                        subtitle: '',
                        color: colors[ti % colors.length],
                        rowIndex: tn.rowIndex
                    });
                }
            } else {
                // Format A: resolve fields from config
                var labelIdx = colIdx[labelField] !== undefined ? colIdx[labelField] : -1;
                var valueIdx = colIdx[valueField] !== undefined ? colIdx[valueField] : -1;
                var subtitleIdx = subtitleField && colIdx[subtitleField] !== undefined ? colIdx[subtitleField] : -1;
                var stepIdx = colIdx['step'] !== undefined ? colIdx['step'] : -1;
                var connectsIdx = colIdx['connects_to'] !== undefined ? colIdx['connects_to'] : -1;

                for (var ri = 0; ri < rows.length; ri++) {
                    var row = rows[ri];
                    var nodeLabel = labelIdx >= 0 ? String(row[labelIdx] || '') : ('Node ' + (ri + 1));
                    var nodeValue = valueIdx >= 0 ? Number(row[valueIdx]) || 0 : 0;
                    var nodeSub = subtitleIdx >= 0 ? String(row[subtitleIdx] || '') : '';
                    var nodeStep = stepIdx >= 0 ? row[stepIdx] : null;
                    var nodeConnects = [];
                    if (connectsIdx >= 0 && row[connectsIdx]) {
                        var parts = String(row[connectsIdx]).split(',');
                        for (var pi = 0; pi < parts.length; pi++) {
                            var trimmed = parts[pi].replace(/^\s+|\s+$/g, '');
                            if (trimmed) nodeConnects.push(trimmed);
                        }
                    }

                    var nodeId = nodeLabel || ('node_' + ri);

                    resolvedNodes.push({
                        id: nodeId,
                        label: nodeLabel,
                        value: nodeValue,
                        step: nodeStep,
                        connectsTo: nodeConnects,
                        series: [],
                        subtitle: nodeSub,
                        color: colors[ri % colors.length],
                        rowIndex: ri
                    });
                }
            }

            // 7b. Add manual nodes from editorState that aren't data-driven
            var existingIds = {};
            for (var eid = 0; eid < resolvedNodes.length; eid++) {
                existingIds[resolvedNodes[eid].id] = true;
            }
            var edNodeKeys = Object.keys(this._editorState.nodes);
            for (var ek = 0; ek < edNodeKeys.length; ek++) {
                var eKey = edNodeKeys[ek];
                var eNode = this._editorState.nodes[eKey];
                if (eNode.manual && !existingIds[eKey]) {
                    resolvedNodes.push({
                        id: eKey,
                        label: eNode.label || 'New Node',
                        value: null,
                        step: null,
                        connectsTo: [],
                        series: [],
                        subtitle: '',
                        color: eNode.color || colors[resolvedNodes.length % colors.length],
                        rowIndex: -1
                    });
                }
            }

            // 8. Toolbar height
            var toolbarH = this._editMode ? 36 : 0;

            // 9. Compute node positions
            var positioned = computeNodePositions(resolvedNodes, this._editorState, w, h, toolbarH);
            this._computedNodes = positioned;
            this._computedNodeMap = {};
            for (var ci2 = 0; ci2 < positioned.length; ci2++) {
                this._computedNodeMap[positioned[ci2].id] = positioned[ci2];
            }

            // 10. Build connections
            var connections = buildConnections(positioned, this._editorState);
            this._computedConnections = connections;

            // 11. Build node map for connection drawing
            var nodeMap = {};
            for (var nm = 0; nm < positioned.length; nm++) {
                nodeMap[positioned[nm].id] = positioned[nm];
            }

            // ── Render canvas ──
            ctx.clearRect(0, 0, w, h);

            // Draw toolbar if edit mode (toolbar is NOT panned)
            if (this._editMode) {
                drawToolbar(ctx, w, theme, toolbarH, this._toolbarButtons, this._hoverItem, this._lockMode, this._saveFlash, this._saveError, this._saveMessage, this._statusMessage);
            }

            // Apply pan offset for world-space drawing
            ctx.save();
            ctx.translate(this._panX, this._panY);

            // Draw grid (in world space, scrolls with canvas)
            if (this._editMode && this._gridEnabled) {
                drawGrid(ctx, w, h, this._gridSize, this._panX, this._panY, isDark);
            }

            // Draw connections
            for (var ci = 0; ci < connections.length; ci++) {
                var conn = connections[ci];
                var fromNd = nodeMap[conn.from];
                var toNd = nodeMap[conn.to];
                if (fromNd && toNd) {
                    var connSelected = this._editMode && this._selectedConnection !== null &&
                        this._selectedConnection.index === ci;
                    var connHovered = this._hoverItem && this._hoverItem.type === 'connection' && this._hoverItem.index === ci;
                    conn._mouseX = this._mouseX - this._panX;
                    conn._mouseY = this._mouseY - this._panY;
                    drawConnection(ctx, fromNd, toNd, conn, theme, connSelected, this._editMode, connHovered, this._animationOffset);
                }
            }

            // Sort nodes by zOrder before drawing (lower first = drawn underneath)
            var drawOrder = [];
            for (var doi = 0; doi < positioned.length; doi++) {
                drawOrder.push(positioned[doi]);
            }
            drawOrder.sort(function(a, b) {
                var za = a.zOrder === 'back' ? -100 : a.zOrder === 'front' ? 100 : (parseInt(a.zOrder, 10) || 0);
                var zb = b.zOrder === 'back' ? -100 : b.zOrder === 'front' ? 100 : (parseInt(b.zOrder, 10) || 0);
                return za - zb;
            });

            // Draw nodes
            for (var di = 0; di < drawOrder.length; di++) {
                var pn = drawOrder[di];
                var isNodeSelected = this._editMode && arrContains(this._selectedNodeIds, pn.id);
                var isNodeHovered = this._hoverItem &&
                    this._hoverItem.type === 'node' &&
                    this._hoverItem.id === pn.id;
                drawNode(ctx, pn, theme, accentLine, sparklineType, nodeRadius, isNodeSelected, isNodeHovered, this._globalEffects || {});
            }

            // ── Connection Ports on Selected Nodes ──
            if (this._editMode) {
                for (var cpi = 0; cpi < positioned.length; cpi++) {
                    var cpn = positioned[cpi];
                    if (arrContains(this._selectedNodeIds, cpn.id)) {
                        var portRadius = 6;
                        var portColor = '#6366f1';
                        var ports = [
                            { side: 'top', px: cpn.x + cpn.w / 2, py: cpn.y },
                            { side: 'bottom', px: cpn.x + cpn.w / 2, py: cpn.y + cpn.h },
                            { side: 'left', px: cpn.x, py: cpn.y + cpn.h / 2 },
                            { side: 'right', px: cpn.x + cpn.w, py: cpn.y + cpn.h / 2 }
                        ];
                        for (var pdi = 0; pdi < ports.length; pdi++) {
                            ctx.beginPath();
                            ctx.arc(ports[pdi].px, ports[pdi].py, portRadius, 0, Math.PI * 2);
                            ctx.fillStyle = portColor;
                            ctx.fill();
                            ctx.strokeStyle = '#fff';
                            ctx.lineWidth = 1.5;
                            ctx.stroke();
                        }
                        cpn._ports = ports;
                    } else {
                        cpn._ports = null;
                    }
                }
            }

            // ── Sparkline Hover Overlay ──
            if (this._sparkHoverNode && this._sparkHoverIdx >= 0) {
                var shNode = this._sparkHoverNode;
                var shSb = shNode._sparkBounds;
                var shSd = shNode._sparkDataRef;
                var shIdx = this._sparkHoverIdx;

                if (shSb && shSd && shSd.length > 0) {
                    var shDataVal = shSd[shIdx];
                    var shDpX = shSb.x + (shSd.length > 1 ? (shIdx / (shSd.length - 1)) * shSb.w : shSb.w / 2);

                    // Vertical crosshair line
                    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(shDpX, shSb.y);
                    ctx.lineTo(shDpX, shSb.y + shSb.h);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Data point dot — compute Y from min/max
                    var shMinV = shSd[0], shMaxV = shSd[0];
                    for (var svi = 1; svi < shSd.length; svi++) {
                        if (shSd[svi] < shMinV) shMinV = shSd[svi];
                        if (shSd[svi] > shMaxV) shMaxV = shSd[svi];
                    }
                    var shRange = shMaxV - shMinV || 1;
                    var shDpY = shSb.y + shSb.h - ((shDataVal - shMinV) / shRange) * shSb.h;

                    ctx.fillStyle = '#fff';
                    ctx.beginPath();
                    ctx.arc(shDpX, shDpY, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = shNode.color || '#3b82f6';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // Tooltip box
                    var shTooltipText = formatCount(shDataVal);
                    ctx.font = 'bold 11px sans-serif';
                    var shTw = ctx.measureText(shTooltipText).width + 16;
                    var shTh = 24;
                    var shTx = shDpX - shTw / 2;
                    var shTy = shDpY - shTh - 8;

                    // Keep tooltip in bounds
                    if (shTx < shSb.x) shTx = shSb.x;
                    if (shTx + shTw > shSb.x + shSb.w) shTx = shSb.x + shSb.w - shTw;
                    if (shTy < shSb.y) shTy = shDpY + 8; // flip below if too high

                    // Draw tooltip background
                    ctx.fillStyle = 'rgba(15,23,42,0.95)';
                    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                    ctx.lineWidth = 1;
                    roundRect(ctx, shTx, shTy, shTw, shTh, 4);
                    ctx.fill();
                    ctx.stroke();

                    // Draw tooltip text
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(shTooltipText, shTx + shTw / 2, shTy + shTh / 2);

                    // Reset text state
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'alphabetic';
                }
            }

            // Draw connection overlays (endpoints, waypoints) ON TOP of nodes
            drawConnectionOverlays(ctx, connections, theme);

            // Check for active animations and start/stop the animation loop
            var edConns = this._editorState.connections || [];
            this._hasActiveAnimations = false;
            for (var ai = 0; ai < edConns.length; ai++) {
                var ac = edConns[ai];
                var at = ac.animationType || 'none';
                if (at !== 'none') {
                    var atr = ac.animationTrigger || 'always';
                    if (atr === 'always' || ac._animActive) {
                        this._hasActiveAnimations = true;
                        break;
                    }
                }
            }
            if (this._hasActiveAnimations) {
                this._startAnimationLoop();
            } else {
                this._stopAnimationLoop();
            }

            // Edit mode UI extras
            if (this._editMode) {
                if (this._selectedNodeIds.length === 1) {
                    for (var rhi3 = 0; rhi3 < positioned.length; rhi3++) {
                        if (positioned[rhi3].id === this._selectedNodeIds[0]) {
                            drawResizeHandles(ctx, positioned[rhi3], theme);
                            break;
                        }
                    }
                }
                if (this._isConnecting && this._connectFromId) {
                    var fromConnNode = nodeMap[this._connectFromId];
                    if (fromConnNode) {
                        var clStartX = fromConnNode.x + fromConnNode.w / 2;
                        var clStartY = fromConnNode.y + fromConnNode.h / 2;
                        if (this._connectFromPort === 'top') { clStartX = fromConnNode.x + fromConnNode.w / 2; clStartY = fromConnNode.y; }
                        else if (this._connectFromPort === 'bottom') { clStartX = fromConnNode.x + fromConnNode.w / 2; clStartY = fromConnNode.y + fromConnNode.h; }
                        else if (this._connectFromPort === 'left') { clStartX = fromConnNode.x; clStartY = fromConnNode.y + fromConnNode.h / 2; }
                        else if (this._connectFromPort === 'right') { clStartX = fromConnNode.x + fromConnNode.w; clStartY = fromConnNode.y + fromConnNode.h / 2; }
                        var clEndX = this._connectFromPort ? this._connectMouseX : (this._mouseX - this._panX);
                        var clEndY = this._connectFromPort ? this._connectMouseY : (this._mouseY - this._panY);
                        ctx.save();
                        ctx.setLineDash([6, 3]);
                        ctx.strokeStyle = '#6366f1';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(clStartX, clStartY);
                        ctx.lineTo(clEndX, clEndY);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.restore();
                    }
                }
                // Draw rubber-band selection rectangle
                if (this._isRubberBanding && this._rubberBandStart && this._rubberBandEnd) {
                    var rbsx = Math.min(this._rubberBandStart.x, this._rubberBandEnd.x);
                    var rbsy = Math.min(this._rubberBandStart.y, this._rubberBandEnd.y);
                    var rbsw = Math.abs(this._rubberBandEnd.x - this._rubberBandStart.x);
                    var rbsh = Math.abs(this._rubberBandEnd.y - this._rubberBandStart.y);
                    ctx.save();
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.fillStyle = 'rgba(59,130,246,0.08)';
                    ctx.fillRect(rbsx, rbsy, rbsw, rbsh);
                    ctx.strokeRect(rbsx, rbsy, rbsw, rbsh);
                    ctx.setLineDash([]);
                    ctx.restore();
                }
                // Node popup replaced by DOM panel (_updatePanel / _buildNodePanel)
                // Connection popup replaced by DOM panel (_updatePanel / _buildConnectionPanel)
            }

            // Restore from pan translate — everything below is in screen space
            ctx.restore();

            // Hover tooltips in view mode
            if (!this._editMode && this._hoverItem) {
                if (this._hoverItem.type === 'node' && nodeMap[this._hoverItem.id]) {
                    var ttNode = nodeMap[this._hoverItem.id];
                    var ttText = ttNode.label;
                    if (ttNode.value !== null && ttNode.value !== undefined) ttText += '\n' + formatCount(ttNode.value);
                    if (ttNode.subtitle) ttText += '\n' + ttNode.subtitle;
                    drawTooltip(ctx, ttText, this._mouseX, this._mouseY, w, h, isDark);
                } else if (this._hoverItem.type === 'connection') {
                    var ttConn = connections[this._hoverItem.index];
                    if (ttConn && ttConn.label) drawTooltip(ctx, ttConn.label, this._mouseX, this._mouseY, w, h, isDark);
                }
            }

            // Show/hide edit button
            if (this._editBtn) {
                this._editBtn.style.display = this._editMode ? 'none' : 'flex';
            }

            // Show/hide properties panel
            if (this._panelEl && this._panelStrip) {
                if (this._editMode) {
                    // Theme the panel
                    var panelBg = isDark ? 'rgba(15,23,42,0.97)' : 'rgba(255,255,255,0.97)';
                    var panelBorder = isDark ? '#334155' : '#e2e8f0';
                    var panelText = isDark ? '#cbd5e1' : '#334155';
                    var panelTitleColor = isDark ? '#fbbf24' : '#b45309';

                    this._panelEl.style.background = panelBg;
                    this._panelEl.style.borderLeftColor = panelBorder;
                    this._panelHeader.style.borderBottomColor = panelBorder;
                    this._panelTitle.style.color = panelTitleColor;
                    this._panelCollapseBtn.style.color = panelText;

                    this._panelStrip.style.background = panelBg;
                    this._panelStrip.style.borderLeftColor = panelBorder;
                    this._panelStripIcon.style.color = panelText;
                    this._panelStripLabel.style.color = panelText;

                    if (this._panelCollapsed) {
                        this._panelEl.style.display = 'none';
                        this._panelStrip.style.display = 'flex';
                    } else {
                        this._panelEl.style.display = 'flex';
                        this._panelStrip.style.display = 'none';
                    }
                } else {
                    this._panelEl.style.display = 'none';
                    this._panelStrip.style.display = 'none';
                }
            }

            this._hitNodes = positioned;
            this._hitConnections = connections;

            // Live-update code editor if open
            if (this._showCodeEditor && this._codeTa && this._codePre) {
                var liveJson = JSON.stringify(this._editorState, null, 2);
                // Only update if user isn't actively typing (textarea not focused)
                if (document.activeElement !== this._codeTa) {
                    this._codeTa.value = liveJson;
                    this._highlightJson(this._codePre, liveJson);
                }
            }
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            // Clear editor-state sync interval
            clearInterval(this._syncInterval);

            // Remove canvas event listeners
            if (this.canvas) {
                this.canvas.removeEventListener('mousedown', this._onMouseDown);
                this.canvas.removeEventListener('mousemove', this._onMouseMove);
                this.canvas.removeEventListener('mouseup', this._onMouseUp);
                this.canvas.removeEventListener('dblclick', this._onDblClick);
                this.canvas.removeEventListener('contextmenu', this._onContextMenu);
                this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
            }

            // Stop animation loop
            this._stopAnimationLoop();

            // Remove document-level key listeners (stored as named refs)
            if (this._onKeyDown) {
                document.removeEventListener('keydown', this._onKeyDown);
                this._onKeyDown = null;
            }
            if (this._onKeyUp) {
                document.removeEventListener('keyup', this._onKeyUp);
                this._onKeyUp = null;
            }

            // Remove panel DOM elements
            if (this._panelEl && this._panelEl.parentNode) {
                this._panelEl.parentNode.removeChild(this._panelEl);
            }
            if (this._panelStrip && this._panelStrip.parentNode) {
                this._panelStrip.parentNode.removeChild(this._panelStrip);
            }
            if (this._editBtn && this._editBtn.parentNode) {
                this._editBtn.parentNode.removeChild(this._editBtn);
            }

            // Null DOM references
            this._panelEl = null;
            this._panelStrip = null;
            this._panelBody = null;
            this._panelTitle = null;
            this._editBtn = null;

            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
