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
     * Linear interpolation between two hex colors.
     */
    function lerpColor(a, b, t) {
        var ar = parseInt(a.slice(1, 3), 16);
        var ag = parseInt(a.slice(3, 5), 16);
        var ab = parseInt(a.slice(5, 7), 16);
        var br = parseInt(b.slice(1, 3), 16);
        var bg = parseInt(b.slice(3, 5), 16);
        var bb = parseInt(b.slice(5, 7), 16);
        var rr = Math.round(ar + (br - ar) * t);
        var rg = Math.round(ag + (bg - ag) * t);
        var rb = Math.round(ab + (bb - ab) * t);
        return '#' + ((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1);
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
     * Draw arrowhead at a point with given angle.
     */
    function drawArrowhead(ctx, x, y, angle, size, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, -size * 0.5);
        ctx.lineTo(-size, size * 0.5);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
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

    function pointNearLine(px, py, x1, y1, x2, y2, threshold) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        var lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1)) <= threshold;
        var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
        var projX = x1 + t * dx;
        var projY = y1 + t * dy;
        var dist = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
        return dist <= threshold;
    }

    function pointNearBezier(px, py, x1, y1, cpx, cpy, x2, y2, threshold, steps) {
        var numSteps = steps || 20;
        for (var i = 0; i <= numSteps; i++) {
            var t = i / numSteps;
            var it = 1 - t;
            var bx = it * it * x1 + 2 * it * t * cpx + t * t * x2;
            var by = it * it * y1 + 2 * it * t * cpy + t * t * y2;
            var dx = px - bx;
            var dy = py - by;
            if (dx * dx + dy * dy <= threshold * threshold) return true;
        }
        return false;
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

            if (edState && edState.x !== undefined && edState.y !== undefined) {
                result.push({
                    id: nd.id,
                    label: nd.label,
                    value: nd.value,
                    subtitle: nd.subtitle || '',
                    x: edState.x,
                    y: edState.y,
                    w: nw,
                    h: nh,
                    shape: shape,
                    color: colorOverride || nd.color || '#3b82f6',
                    series: nd.series || [],
                    connectsTo: nd.connectsTo || [],
                    step: nd.step,
                    rowIndex: nd.rowIndex
                });
            } else {
                autoNodes.push({
                    id: nd.id,
                    label: nd.label,
                    value: nd.value,
                    subtitle: nd.subtitle || '',
                    w: nw,
                    h: nh,
                    shape: shape,
                    color: colorOverride || nd.color || '#3b82f6',
                    series: nd.series || [],
                    connectsTo: nd.connectsTo || [],
                    step: nd.step,
                    rowIndex: nd.rowIndex
                });
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
                    arrow: mc.arrow || 'forward',
                    label: mc.label || '',
                    manual: true
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

    function drawNode(ctx, node, theme, accentLine, sparklineType, nodeRadius, isSelected, isHovered) {
        var x = node.x;
        var y = node.y;
        var w = node.w;
        var h = node.h;
        var shape = node.shape || 'rect';
        var radius = parseInt(nodeRadius, 10) || 8;

        // Shadow for hover
        if (isHovered) {
            ctx.shadowColor = hexToRgba(node.color, 0.3);
            ctx.shadowBlur = 12;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 4;
        }

        // Draw shape
        if (shape === 'circle') {
            var r = Math.min(w, h) / 2;
            var cx = x + w / 2;
            var cy = y + h / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = theme.nodeBg;
            ctx.fill();
            ctx.strokeStyle = isSelected ? node.color : theme.nodeBorder;
            ctx.lineWidth = isSelected ? 2.5 : 1;
            ctx.stroke();
        } else if (shape === 'diamond') {
            var dcx = x + w / 2;
            var dcy = y + h / 2;
            var dhw = w / 2;
            var dhh = h / 2;
            ctx.beginPath();
            ctx.moveTo(dcx, dcy - dhh);
            ctx.lineTo(dcx + dhw, dcy);
            ctx.lineTo(dcx, dcy + dhh);
            ctx.lineTo(dcx - dhw, dcy);
            ctx.closePath();
            ctx.fillStyle = theme.nodeBg;
            ctx.fill();
            ctx.strokeStyle = isSelected ? node.color : theme.nodeBorder;
            ctx.lineWidth = isSelected ? 2.5 : 1;
            ctx.stroke();
        } else {
            // rect
            roundRect(ctx, x, y, w, h, radius);
            ctx.fillStyle = theme.nodeBg;
            ctx.fill();
            ctx.strokeStyle = isSelected ? node.color : theme.nodeBorder;
            ctx.lineWidth = isSelected ? 2.5 : 1;
            ctx.stroke();
        }

        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Accent line at top
        if (accentLine === 'true' && shape === 'rect') {
            ctx.save();
            roundRect(ctx, x, y, w, Math.min(3, h), radius);
            ctx.clip();
            ctx.fillStyle = node.color;
            ctx.fillRect(x, y, w, 3);
            ctx.restore();
        }

        // Layout zones within node
        var textPadX = 10;
        var textPadY = shape === 'rect' && accentLine === 'true' ? 10 : 8;
        var sparkH = 28;
        var hasSpark = node.series && node.series.length > 1 && sparklineType !== 'none';

        // Label
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = theme.textMuted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        var labelY = y + textPadY;
        if (shape === 'circle' || shape === 'diamond') {
            labelY = y + h * 0.15;
        }
        ctx.fillText(truncateText(node.label, 18), x + w / 2, labelY);

        // Value
        var valueText = formatCount(node.value);
        ctx.font = 'bold 22px "SF Mono", "Fira Code", "Consolas", monospace';
        ctx.fillStyle = theme.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var valueY = y + h * 0.45;
        if (hasSpark) {
            valueY = y + h * 0.38;
        }
        if (node.subtitle) {
            valueY = y + h * 0.35;
        }
        ctx.fillText(valueText, x + w / 2, valueY);

        // Subtitle
        if (node.subtitle) {
            ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = theme.textMuted;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(truncateText(node.subtitle, 22), x + w / 2, valueY + 14);
        }

        // Sparkline
        if (hasSpark) {
            var sparkY = y + h - sparkH - 6;
            var sparkX = x + 6;
            var sparkW = w - 12;
            // Clip to node shape for clean edges
            ctx.save();
            if (shape === 'rect') {
                roundRect(ctx, x, y, w, h, radius);
                ctx.clip();
            }
            drawSparkline(ctx, node.series, sparkX, sparkY, sparkW, sparkH, sparklineType, node.color);
            ctx.restore();
        }

        // Reset
        ctx.lineWidth = 1;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    // ── Connection Drawing ────────────────────────────────────────

    function drawConnection(ctx, fromNode, toNode, conn, theme, isSelected) {
        var fromCx = fromNode.x + fromNode.w / 2;
        var fromCy = fromNode.y + fromNode.h / 2;
        var toCx = toNode.x + toNode.w / 2;
        var toCy = toNode.y + toNode.h / 2;

        var startPt = getEdgeConnectionPoint(fromNode, toCx, toCy);
        var endPt = getEdgeConnectionPoint(toNode, fromCx, fromCy);

        var lineColor = conn.color || theme.lineBg;
        var lineWidth = conn.width || 2;

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = isSelected ? lineWidth + 1.5 : lineWidth;

        if (conn.dash) {
            ctx.setLineDash([6, 4]);
        } else {
            ctx.setLineDash([]);
        }

        var midX, midY, angle;

        if (conn.style === 'curved') {
            // Curved: quadratic bezier with perpendicular offset
            var mx = (startPt.x + endPt.x) / 2;
            var my = (startPt.y + endPt.y) / 2;
            var dx = endPt.x - startPt.x;
            var dy = endPt.y - startPt.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            var offset = Math.min(40, len * 0.2);
            // Perpendicular
            var nx = len > 0 ? -dy / len : 0;
            var ny = len > 0 ? dx / len : 0;
            var cpx = mx + nx * offset;
            var cpy = my + ny * offset;

            ctx.beginPath();
            ctx.moveTo(startPt.x, startPt.y);
            ctx.quadraticCurveTo(cpx, cpy, endPt.x, endPt.y);
            ctx.stroke();

            midX = 0.25 * startPt.x + 0.5 * cpx + 0.25 * endPt.x;
            midY = 0.25 * startPt.y + 0.5 * cpy + 0.25 * endPt.y;
            // Angle at endpoint
            angle = Math.atan2(endPt.y - cpy, endPt.x - cpx);
        } else {
            // Straight
            ctx.beginPath();
            ctx.moveTo(startPt.x, startPt.y);
            ctx.lineTo(endPt.x, endPt.y);
            ctx.stroke();

            midX = (startPt.x + endPt.x) / 2;
            midY = (startPt.y + endPt.y) / 2;
            angle = Math.atan2(endPt.y - startPt.y, endPt.x - startPt.x);
        }

        ctx.setLineDash([]);
        ctx.lineWidth = 1;

        // Arrow
        var arrowDir = conn.arrow || 'forward';
        if (arrowDir === 'forward' || arrowDir === 'both') {
            drawArrowhead(ctx, endPt.x, endPt.y, angle, 8, lineColor);
        }
        if (arrowDir === 'backward' || arrowDir === 'both') {
            var backAngle = angle + Math.PI;
            drawArrowhead(ctx, startPt.x, startPt.y, backAngle, 8, lineColor);
        }

        // Label
        if (conn.label) {
            ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            var labelW = ctx.measureText(conn.label).width + 8;
            var labelH = 16;

            // Background for readability
            roundRect(ctx, midX - labelW / 2, midY - labelH / 2, labelW, labelH, 3);
            ctx.fillStyle = theme.nodeBg;
            ctx.globalAlpha = 0.9;
            ctx.fill();
            ctx.globalAlpha = 1;

            ctx.fillStyle = theme.textMuted;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(conn.label, midX, midY);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
    }

    // ── Toolbar Drawing ───────────────────────────────────────────

    function drawToolbar(ctx, w, theme, toolbarH, buttons) {
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

        // Title
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = theme.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Edit Mode', 12, toolbarH / 2);

        // Buttons
        var btnX = 110;
        var btnH = 26;
        var btnY = (toolbarH - btnH) / 2;
        var btnPad = 8;

        // Clear the buttons array and populate
        buttons.length = 0;

        var btnLabels = ['Add Connection', 'Delete Selected', 'Reset Layout'];
        for (var i = 0; i < btnLabels.length; i++) {
            ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            var tw = ctx.measureText(btnLabels[i]).width + 16;

            roundRect(ctx, btnX, btnY, tw, btnH, 4);
            ctx.fillStyle = theme.nodeBg;
            ctx.fill();
            ctx.strokeStyle = theme.nodeBorder;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = theme.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(btnLabels[i], btnX + tw / 2, toolbarH / 2);

            buttons.push({
                x: btnX,
                y: btnY,
                w: tw,
                h: btnH,
                label: btnLabels[i],
                action: btnLabels[i].toLowerCase().replace(/ /g, '_')
            });

            btnX += tw + btnPad;
        }

        ctx.textAlign = 'left';
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
        return pointInRect(px, py, node.x, node.y, node.w, node.h);
    }

    // ══════════════════════════════════════════════════════════════
    // ██ Visualization Object
    // ══════════════════════════════════════════════════════════════

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('business-process-flow-viz');

            // Create canvas
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            // State
            this._lastGoodData = null;
            this._editorState = { nodes: {}, connections: [], lock: false };
            this._isDragging = false;
            this._dragNodeId = null;
            this._dragStartX = 0;
            this._dragStartY = 0;
            this._dragNodeStartX = 0;
            this._dragNodeStartY = 0;
            this._isConnecting = false;
            this._connectFromId = null;
            this._isResizing = false;
            this._resizeNodeId = null;
            this._resizeHandle = null;
            this._selectedConnection = null;
            this._selectedNodeId = null;
            this._editMode = false;
            this._lockMode = false;
            this._hitNodes = [];
            this._hitConnections = [];
            this._hoverItem = null;
            this._mouseX = 0;
            this._mouseY = 0;
            this._toolbarButtons = [];
            this._computedNodes = [];
            this._computedConnections = [];

            var self = this;

            this._onMouseDown = function(e) {
                var rect = self.canvas.getBoundingClientRect();
                self._mouseX = e.clientX - rect.left;
                self._mouseY = e.clientY - rect.top;
                // Full drag/connect/resize logic in Tasks 4-5
            };

            this._onMouseMove = function(e) {
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                self._mouseX = mx;
                self._mouseY = my;

                // Update hover state for cursor changes
                var oldHover = self._hoverItem;
                self._hoverItem = null;

                // Check toolbar buttons
                if (self._editMode && self._toolbarButtons) {
                    for (var bi = 0; bi < self._toolbarButtons.length; bi++) {
                        var btn = self._toolbarButtons[bi];
                        if (pointInRect(mx, my, btn.x, btn.y, btn.w, btn.h)) {
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

                // Update cursor
                if (self._hoverItem) {
                    if (self._hoverItem.type === 'button') {
                        self.canvas.style.cursor = 'pointer';
                    } else if (self._hoverItem.type === 'node') {
                        self.canvas.style.cursor = self._editMode ? 'grab' : 'pointer';
                    }
                } else {
                    self.canvas.style.cursor = 'default';
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
            };

            this._onMouseUp = function(e) {
                var rect = self.canvas.getBoundingClientRect();
                self._mouseX = e.clientX - rect.left;
                self._mouseY = e.clientY - rect.top;
                // Full logic in Tasks 4-5
            };

            this.canvas.addEventListener('mousedown', this._onMouseDown);
            this.canvas.addEventListener('mousemove', this._onMouseMove);
            this.canvas.addEventListener('mouseup', this._onMouseUp);
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
            var editMode      = config[ns + 'editMode']      || 'false';
            var lock          = config[ns + 'lock']          || 'false';
            var editorStateStr = config[ns + 'editorState']  || '';
            var drilldownField = config[ns + 'drilldownField'] || 'sourcetype';

            this._editMode = editMode === 'true';
            this._lockMode = lock === 'true';
            this._drilldownField = drilldownField;

            // 3. Parse editorState
            if (editorStateStr) {
                try {
                    var parsed = JSON.parse(editorStateStr);
                    if (parsed && typeof parsed === 'object') {
                        // Merge with current in-memory state
                        if (parsed.nodes) {
                            var nkeys = Object.keys(parsed.nodes);
                            for (var nk = 0; nk < nkeys.length; nk++) {
                                this._editorState.nodes[nkeys[nk]] = parsed.nodes[nkeys[nk]];
                            }
                        }
                        if (parsed.connections) {
                            this._editorState.connections = parsed.connections;
                        }
                        if (parsed.lock !== undefined) {
                            this._editorState.lock = parsed.lock;
                        }
                    }
                } catch (e) {
                    // ignore invalid JSON
                }
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

            // 8. Toolbar height
            var toolbarH = this._editMode ? 44 : 0;

            // 9. Compute node positions
            var positioned = computeNodePositions(resolvedNodes, this._editorState, w, h, toolbarH);
            this._computedNodes = positioned;

            // 10. Build connections
            var connections = buildConnections(positioned, this._editorState);
            this._computedConnections = connections;

            // 11. Build node map for connection drawing
            var nodeMap = {};
            for (var nm = 0; nm < positioned.length; nm++) {
                nodeMap[positioned[nm].id] = positioned[nm];
            }

            // 12. Clear canvas
            ctx.fillStyle = theme.bg;
            ctx.fillRect(0, 0, w, h);

            // 13. Draw toolbar if edit mode
            if (this._editMode) {
                drawToolbar(ctx, w, theme, toolbarH, this._toolbarButtons);
            }

            // 14. Draw all connections (behind nodes)
            for (var ci = 0; ci < connections.length; ci++) {
                var conn = connections[ci];
                var fromNd = nodeMap[conn.from];
                var toNd = nodeMap[conn.to];
                if (fromNd && toNd) {
                    var connSelected = this._selectedConnection !== null &&
                        this._selectedConnection.from === conn.from &&
                        this._selectedConnection.to === conn.to;
                    drawConnection(ctx, fromNd, toNd, conn, theme, connSelected);
                }
            }

            // 15. Draw all nodes
            for (var di = 0; di < positioned.length; di++) {
                var pn = positioned[di];
                var isNodeSelected = this._selectedNodeId === pn.id;
                var isNodeHovered = this._hoverItem &&
                    this._hoverItem.type === 'node' &&
                    this._hoverItem.id === pn.id;
                drawNode(ctx, pn, theme, accentLine, sparklineType, nodeRadius, isNodeSelected, isNodeHovered);
            }

            // 16. Store hit data
            this._hitNodes = positioned;
            this._hitConnections = connections;
        },

        reflow: function() {
            this.invalidateUpdateView();
        }
    });
});
