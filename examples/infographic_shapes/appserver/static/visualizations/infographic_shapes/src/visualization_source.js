/*
 * Infographic Shapes — Splunk Custom Visualization
 *
 * A PowerPoint-style shape toolkit for Splunk Dashboard Studio.
 * Renders 30+ shapes with gradients, glow, shadow, reflection,
 * dashed strokes, embedded custom fonts, animations, and data-driven colouring.
 *
 * Expected SPL columns (all optional):
 *   value  — numeric value for threshold-based colouring
 *   color  — explicit hex colour override from search
 *   text   — dynamic text to display on the shape
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

    // ── Text utilities ──────────────────────────────────────────

    function fitText(ctx, text, maxWidth, maxSize, weight, family) {
        var size = maxSize;
        ctx.font = weight + ' ' + size + 'px ' + family;
        while (ctx.measureText(text).width > maxWidth && size > 6) {
            size--;
            ctx.font = weight + ' ' + size + 'px ' + family;
        }
        return size;
    }

    // ── Shape path functions ────────────────────────────────────
    // Each creates a closed path on ctx (beginPath + closePath).
    // Caller is responsible for fill/stroke.

    function pathRect(ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.closePath();
    }

    function pathRoundedRect(ctx, x, y, w, h, r) {
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

    /**
     * Rounded rectangle with independent corner radii (ES5-compatible arcTo chain).
     * Each radius is clamped; zero produces a sharp corner.
     */
    function pathRoundedRectPerCorner(ctx, x, y, w, h, tl, tr, br, bl) {
        tl = Math.max(0, Math.min(tl, w / 2, h / 2));
        tr = Math.max(0, Math.min(tr, w / 2, h / 2));
        br = Math.max(0, Math.min(br, w / 2, h / 2));
        bl = Math.max(0, Math.min(bl, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + w - tr, y);
        ctx.arcTo(x + w, y, x + w, y + tr, tr);
        ctx.lineTo(x + w, y + h - br);
        ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
        ctx.lineTo(x + bl, y + h);
        ctx.arcTo(x, y + h, x, y + h - bl, bl);
        ctx.lineTo(x, y + tl);
        ctx.arcTo(x, y, x + tl, y, tl);
        ctx.closePath();
    }

    function pathPill(ctx, x, y, w, h) {
        pathRoundedRect(ctx, x, y, w, h, Math.min(w, h) / 2);
    }

    function pathCircle(ctx, cx, cy, r) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
    }

    function pathEllipse(ctx, cx, cy, rx, ry) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.closePath();
    }

    function pathPolygon(ctx, cx, cy, r, sides, startAngle) {
        ctx.beginPath();
        for (var i = 0; i <= sides; i++) {
            var angle = startAngle + (i * 2 * Math.PI / sides);
            var px = cx + r * Math.cos(angle);
            var py = cy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    function pathStar(ctx, cx, cy, outerR, innerR, points) {
        ctx.beginPath();
        var total = points * 2;
        for (var i = 0; i < total; i++) {
            var angle = -Math.PI / 2 + (i * Math.PI / points);
            var r = (i % 2 === 0) ? outerR : innerR;
            var px = cx + r * Math.cos(angle);
            var py = cy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    function pathHeart(ctx, x, y, w, h) {
        var cx = x + w / 2;
        // Natural extents: -0.52..+0.52 horiz (1.04), -0.7..+0.45 vert (1.15)
        var sx = w / 1.04;
        var sy = h / 1.15;
        var s = Math.min(sx, sy);
        var cy = y + h * (0.7 / 1.15);
        var topY = cy - s * 0.35;
        ctx.beginPath();
        ctx.moveTo(cx, cy + s * 0.45);
        ctx.bezierCurveTo(cx - s * 0.02, cy + s * 0.2, cx - s * 0.52, cy + s * 0.15, cx - s * 0.5, topY);
        ctx.bezierCurveTo(cx - s * 0.48, topY - s * 0.35, cx - s * 0.15, topY - s * 0.35, cx, topY + s * 0.05);
        ctx.bezierCurveTo(cx + s * 0.15, topY - s * 0.35, cx + s * 0.48, topY - s * 0.35, cx + s * 0.5, topY);
        ctx.bezierCurveTo(cx + s * 0.52, cy + s * 0.15, cx + s * 0.02, cy + s * 0.2, cx, cy + s * 0.45);
        ctx.closePath();
    }

    function pathCross(ctx, cx, cy, w, h) {
        var armW = w * 0.33;
        var armH = h * 0.33;
        ctx.beginPath();
        ctx.moveTo(cx - armW / 2, cy - h / 2);
        ctx.lineTo(cx + armW / 2, cy - h / 2);
        ctx.lineTo(cx + armW / 2, cy - armH / 2);
        ctx.lineTo(cx + w / 2, cy - armH / 2);
        ctx.lineTo(cx + w / 2, cy + armH / 2);
        ctx.lineTo(cx + armW / 2, cy + armH / 2);
        ctx.lineTo(cx + armW / 2, cy + h / 2);
        ctx.lineTo(cx - armW / 2, cy + h / 2);
        ctx.lineTo(cx - armW / 2, cy + armH / 2);
        ctx.lineTo(cx - w / 2, cy + armH / 2);
        ctx.lineTo(cx - w / 2, cy - armH / 2);
        ctx.lineTo(cx - armW / 2, cy - armH / 2);
        ctx.closePath();
    }

    function pathLightning(ctx, cx, cy, w, h) {
        var hw = w * 0.5;
        var hh = h * 0.5;
        ctx.beginPath();
        ctx.moveTo(cx + hw * 0.1, cy - hh);
        ctx.lineTo(cx - hw * 0.5, cy + hh * 0.05);
        ctx.lineTo(cx - hw * 0.05, cy + hh * 0.05);
        ctx.lineTo(cx - hw * 0.15, cy + hh);
        ctx.lineTo(cx + hw * 0.5, cy - hh * 0.1);
        ctx.lineTo(cx + hw * 0.05, cy - hh * 0.1);
        ctx.closePath();
    }

    function pathCloud(ctx, cx, cy, w, h) {
        var rx = w * 0.46;
        var ry = h * 0.46;
        ctx.beginPath();
        ctx.moveTo(cx - rx * 0.6, cy + ry * 0.4);
        ctx.bezierCurveTo(cx - rx, cy + ry * 0.4, cx - rx, cy - ry * 0.2, cx - rx * 0.55, cy - ry * 0.3);
        ctx.bezierCurveTo(cx - rx * 0.5, cy - ry, cx + rx * 0.1, cy - ry, cx + rx * 0.15, cy - ry * 0.45);
        ctx.bezierCurveTo(cx + rx * 0.35, cy - ry * 0.8, cx + rx * 0.85, cy - ry * 0.6, cx + rx * 0.8, cy - ry * 0.15);
        ctx.bezierCurveTo(cx + rx, cy - ry * 0.05, cx + rx, cy + ry * 0.4, cx + rx * 0.6, cy + ry * 0.4);
        ctx.closePath();
    }

    function pathSun(ctx, cx, cy, r) {
        var inner = r * 0.55;
        var rays = 12;
        ctx.beginPath();
        for (var i = 0; i < rays * 2; i++) {
            var angle = (i * Math.PI / rays) - Math.PI / 2;
            var cr = (i % 2 === 0) ? r : inner;
            var px = cx + cr * Math.cos(angle);
            var py = cy + cr * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    function pathMoon(ctx, cx, cy, r) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.35, cy - r * 0.15, r * 0.75, 0, Math.PI * 2, true);
        ctx.closePath();
    }

    function pathArrowRight(ctx, x, y, w, h) {
        var shaft = h * 0.35;
        var headW = w * 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y + (h - shaft) / 2);
        ctx.lineTo(x + w - headW, y + (h - shaft) / 2);
        ctx.lineTo(x + w - headW, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w - headW, y + h);
        ctx.lineTo(x + w - headW, y + (h + shaft) / 2);
        ctx.lineTo(x, y + (h + shaft) / 2);
        ctx.closePath();
    }

    function pathArrowDouble(ctx, x, y, w, h) {
        var shaft = h * 0.3;
        var headW = w * 0.25;
        var sy = y + (h - shaft) / 2;
        var ey = y + (h + shaft) / 2;
        ctx.beginPath();
        ctx.moveTo(x + headW, sy);
        ctx.lineTo(x + headW, y);
        ctx.lineTo(x, y + h / 2);
        ctx.lineTo(x + headW, y + h);
        ctx.lineTo(x + headW, ey);
        ctx.lineTo(x + w - headW, ey);
        ctx.lineTo(x + w - headW, y + h);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w - headW, y);
        ctx.lineTo(x + w - headW, sy);
        ctx.closePath();
    }

    function pathChevron(ctx, x, y, w, h) {
        var indent = w * 0.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w - indent, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w - indent, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x + indent, y + h / 2);
        ctx.closePath();
    }

    function pathParallelogram(ctx, x, y, w, h) {
        var skew = w * 0.2;
        ctx.beginPath();
        ctx.moveTo(x + skew, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w - skew, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
    }

    function pathTrapezoid(ctx, x, y, w, h) {
        var inset = w * 0.15;
        ctx.beginPath();
        ctx.moveTo(x + inset, y);
        ctx.lineTo(x + w - inset, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
    }

    function pathRightTriangle(ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y);
        ctx.closePath();
    }

    function pathRing(ctx, cx, cy, outerR, innerR) {
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
        ctx.closePath();
    }

    function pathArcShape(ctx, cx, cy, r, thickness) {
        var startAngle = -Math.PI * 0.75;
        var endAngle = Math.PI * 0.75;
        ctx.beginPath();
        ctx.arc(cx, cy, r, startAngle, endAngle);
        ctx.arc(cx, cy, r - thickness, endAngle, startAngle, true);
        ctx.closePath();
    }

    function pathBracketLeft(ctx, x, y, w, h) {
        var t = Math.max(2, w * 0.15);
        var arm = Math.min(w * 0.4, h * 0.15);
        ctx.beginPath();
        ctx.moveTo(x + w * 0.7, y);
        ctx.lineTo(x + w * 0.3, y);
        ctx.lineTo(x + w * 0.3, y + arm);
        ctx.lineTo(x + w * 0.3 + t, y + arm);
        ctx.lineTo(x + w * 0.3 + t, y + t);
        ctx.lineTo(x + w * 0.7, y + t);
        ctx.lineTo(x + w * 0.7, y);
        ctx.moveTo(x + w * 0.7, y + h);
        ctx.lineTo(x + w * 0.3, y + h);
        ctx.lineTo(x + w * 0.3, y + h - arm);
        ctx.lineTo(x + w * 0.3 + t, y + h - arm);
        ctx.lineTo(x + w * 0.3 + t, y + h - t);
        ctx.lineTo(x + w * 0.7, y + h - t);
        ctx.lineTo(x + w * 0.7, y + h);
        ctx.closePath();
    }

    function pathBracketRight(ctx, x, y, w, h) {
        ctx.save();
        ctx.translate(x + w, y + h);
        ctx.rotate(Math.PI);
        pathBracketLeft(ctx, 0, 0, w, h);
        ctx.restore();
    }

    function pathCurlyLeft(ctx, x, y, w, h) {
        var midY = y + h / 2;
        var qw = w * 0.35;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.7, y);
        ctx.quadraticCurveTo(x + w * 0.4, y, x + w * 0.4, y + h * 0.15);
        ctx.lineTo(x + w * 0.4, midY - h * 0.08);
        ctx.quadraticCurveTo(x + w * 0.4, midY, x + w * 0.2, midY);
        ctx.quadraticCurveTo(x + w * 0.4, midY, x + w * 0.4, midY + h * 0.08);
        ctx.lineTo(x + w * 0.4, y + h - h * 0.15);
        ctx.quadraticCurveTo(x + w * 0.4, y + h, x + w * 0.7, y + h);
        ctx.lineTo(x + w * 0.7, y + h - w * 0.08);
        ctx.quadraticCurveTo(x + w * 0.48, y + h - w * 0.08, x + w * 0.48, y + h - h * 0.15);
        ctx.lineTo(x + w * 0.48, midY + h * 0.08);
        ctx.quadraticCurveTo(x + w * 0.48, midY - h * 0.02, x + w * 0.3, midY);
        ctx.quadraticCurveTo(x + w * 0.48, midY + h * 0.02, x + w * 0.48, midY - h * 0.08);
        ctx.lineTo(x + w * 0.48, y + h * 0.15);
        ctx.quadraticCurveTo(x + w * 0.48, y + w * 0.08, x + w * 0.7, y + w * 0.08);
        ctx.closePath();
    }

    function pathCurlyRight(ctx, x, y, w, h) {
        ctx.save();
        ctx.translate(x + w, y + h);
        ctx.rotate(Math.PI);
        pathCurlyLeft(ctx, 0, 0, w, h);
        ctx.restore();
    }

    // Lines are stroke-only shapes
    function pathLineH(ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.moveTo(x, y + h / 2);
        ctx.lineTo(x + w, y + h / 2);
    }

    function pathLineV(ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w / 2, y + h);
    }

    function pathLineDiag(ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
    }

    // ── Shape dispatcher ────────────────────────────────────────

    var LINE_SHAPES = { line_horizontal: 1, line_vertical: 1, line_diagonal: 1 };

    function createShapePath(ctx, shape, x, y, w, h, opts) {
        var cx = x + w / 2;
        var cy = y + h / 2;
        var r = Math.min(w, h) / 2;
        var cr = opts.cornerRadius || 12;

        switch (shape) {
            case 'rectangle':
                pathRect(ctx, x, y, w, h);
                break;
            case 'rounded_rectangle':
                if (opts && opts.perCornerRadii) {
                    var rr = opts.perCornerRadii;
                    pathRoundedRectPerCorner(ctx, x, y, w, h, rr.tl, rr.tr, rr.br, rr.bl);
                } else {
                    pathRoundedRect(ctx, x, y, w, h, cr);
                }
                break;
            case 'pill':
                pathPill(ctx, x, y, w, h);
                break;
            case 'circle':
                pathCircle(ctx, cx, cy, r);
                break;
            case 'ellipse':
                pathEllipse(ctx, cx, cy, w / 2, h / 2);
                break;
            case 'triangle':
                pathPolygon(ctx, cx, cy, r, 3, -Math.PI / 2);
                break;
            case 'right_triangle':
                pathRightTriangle(ctx, x, y, w, h);
                break;
            case 'diamond':
                pathPolygon(ctx, cx, cy, r, 4, -Math.PI / 2);
                break;
            case 'pentagon':
                pathPolygon(ctx, cx, cy, r, 5, -Math.PI / 2);
                break;
            case 'hexagon':
                pathPolygon(ctx, cx, cy, r, 6, 0);
                break;
            case 'octagon':
                pathPolygon(ctx, cx, cy, r, 8, Math.PI / 8);
                break;
            case 'star_4':
                pathStar(ctx, cx, cy, r, r * 0.4, 4);
                break;
            case 'star_5':
                pathStar(ctx, cx, cy, r, r * 0.42, 5);
                break;
            case 'star_6':
                pathStar(ctx, cx, cy, r, r * 0.5, 6);
                break;
            case 'cross':
                pathCross(ctx, cx, cy, w, h);
                break;
            case 'heart':
                pathHeart(ctx, x, y, w, h);
                break;
            case 'lightning':
                pathLightning(ctx, cx, cy, w, h);
                break;
            case 'cloud':
                pathCloud(ctx, cx, cy, w, h);
                break;
            case 'sun':
                pathSun(ctx, cx, cy, r);
                break;
            case 'moon':
                pathMoon(ctx, cx, cy, r);
                break;
            case 'arrow_right':
                pathArrowRight(ctx, x, y, w, h);
                break;
            case 'arrow_left':
                ctx.save();
                ctx.translate(x + w, y + h);
                ctx.rotate(Math.PI);
                pathArrowRight(ctx, 0, 0, w, h);
                ctx.restore();
                break;
            case 'arrow_up':
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(-Math.PI / 2);
                pathArrowRight(ctx, -w / 2, -h / 2, w, h);
                ctx.restore();
                break;
            case 'arrow_down':
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(Math.PI / 2);
                pathArrowRight(ctx, -w / 2, -h / 2, w, h);
                ctx.restore();
                break;
            case 'arrow_double':
                pathArrowDouble(ctx, x, y, w, h);
                break;
            case 'chevron':
                pathChevron(ctx, x, y, w, h);
                break;
            case 'parallelogram':
                pathParallelogram(ctx, x, y, w, h);
                break;
            case 'trapezoid':
                pathTrapezoid(ctx, x, y, w, h);
                break;
            case 'ring':
                pathRing(ctx, cx, cy, r, r * 0.6);
                break;
            case 'arc':
                pathArcShape(ctx, cx, cy, r, r * 0.25);
                break;
            case 'line_horizontal':
                pathLineH(ctx, x, y, w, h);
                break;
            case 'line_vertical':
                pathLineV(ctx, x, y, w, h);
                break;
            case 'line_diagonal':
                pathLineDiag(ctx, x, y, w, h);
                break;
            case 'bracket_left':
                pathBracketLeft(ctx, x, y, w, h);
                break;
            case 'bracket_right':
                pathBracketRight(ctx, x, y, w, h);
                break;
            case 'curly_left':
                pathCurlyLeft(ctx, x, y, w, h);
                break;
            case 'curly_right':
                pathCurlyRight(ctx, x, y, w, h);
                break;
            default:
                pathRoundedRect(ctx, x, y, w, h, cr);
        }
    }

    // ── Gradient helper (supports 2-5 colour stops) ────────────

    function createGradient(ctx, direction, x, y, w, h, colors) {
        var grad;
        if (direction === 'radial') {
            var gcx = x + w / 2;
            var gcy = y + h / 2;
            var gr = Math.max(w, h) / 2;
            grad = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, gr);
        } else if (direction === 'vertical') {
            grad = ctx.createLinearGradient(x, y, x, y + h);
        } else if (direction === 'diagonal') {
            grad = ctx.createLinearGradient(x, y, x + w, y + h);
        } else if (direction === 'diagonal_rev') {
            grad = ctx.createLinearGradient(x + w, y, x, y + h);
        } else {
            grad = ctx.createLinearGradient(x, y, x + w, y);
        }
        for (var gi = 0; gi < colors.length; gi++) {
            grad.addColorStop(gi / Math.max(1, colors.length - 1), colors[gi]);
        }
        return grad;
    }

    // ── Stroke dash helper ──────────────────────────────────────

    function applyStrokeDash(ctx, dashType, sw) {
        var u = Math.max(sw, 3);
        if (dashType === 'dashed') {
            ctx.setLineDash([u * 4, u * 2.5]);
        } else if (dashType === 'dotted') {
            ctx.setLineDash([0.1, u * 2.5]);
        } else if (dashType === 'dash_dot') {
            ctx.setLineDash([u * 4, u * 2, 0.1, u * 2]);
        } else {
            ctx.setLineDash([]);
        }
    }

    // ── Animation speed map ─────────────────────────────────────

    function animationSpeedToIncrement(speedName) {
        if (speedName === 'slow') return 0.008;
        if (speedName === 'fast') return 0.05;
        return 0.02;
    }

    // ── {field} token replacement (tooltip / labels) ───────────

    function replaceBraceTokens(template, row, colIdx) {
        if (!template) return '';
        var s = String(template);
        if (!row || !colIdx) return s;
        return s.replace(/\{([^}]+)\}/g, function(match, name) {
            var key = String(name).replace(/^\s+|\s+$/g, '');
            if (colIdx[key] === undefined) return '';
            var v = row[colIdx[key]];
            if (v === undefined || v === null) return '';
            return String(v);
        });
    }

    // ── Pattern fill (offscreen → createPattern) ─────────────────

    function createShapePattern(ctx, patternType, color, scale) {
        var sc = parseInt(scale, 10);
        if (isNaN(sc) || sc < 1) sc = 1;
        if (sc > 5) sc = 5;
        var px = Math.round(14 + sc * 6);
        var oc = document.createElement('canvas');
        oc.width = px;
        oc.height = px;
        var octx = oc.getContext('2d');
        if (!octx) return null;
        var c = color || '#000000';
        octx.strokeStyle = c;
        octx.fillStyle = c;
        octx.lineWidth = Math.max(1, sc);
        octx.lineCap = 'square';
        if (patternType === 'hatch' || patternType === 'diagonal') {
            octx.beginPath();
            octx.moveTo(0, px);
            octx.lineTo(px, 0);
            octx.stroke();
        } else if (patternType === 'dots') {
            var r = Math.max(1, 1 + sc);
            octx.beginPath();
            octx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
            octx.fill();
        } else if (patternType === 'crosshatch') {
            octx.beginPath();
            octx.moveTo(0, px);
            octx.lineTo(px, 0);
            octx.moveTo(0, 0);
            octx.lineTo(px, px);
            octx.stroke();
        } else {
            return null;
        }
        try {
            return ctx.createPattern(oc, 'repeat');
        } catch (e) {
            return null;
        }
    }

    // ── Progress fill (clipped to shape) ─────────────────────────

    function drawProgressClipped(ctx, shape, sx, sy, sw, sh, shapeOpts, pct, dir, progColor, isLine) {
        if (isLine) return;
        var p = parseFloat(pct);
        if (isNaN(p) || p <= 0) return;
        p = Math.max(0, Math.min(100, p)) / 100;
        ctx.save();
        createShapePath(ctx, shape, sx, sy, sw, sh, shapeOpts);
        ctx.clip();
        ctx.fillStyle = progColor || '#22C55E';
        if (dir === 'bottom-to-top') {
            var fh = sh * p;
            ctx.fillRect(sx, sy + sh - fh, sw, fh);
        } else if (dir === 'radial') {
            var rcx = sx + sw / 2;
            var rcy = sy + sh / 2;
            var rmax = Math.sqrt(sw * sw + sh * sh) / 2;
            ctx.beginPath();
            ctx.arc(rcx, rcy, rmax * p, 0, Math.PI * 2);
            ctx.fill();
        } else {
            var fw = sw * p;
            ctx.fillRect(sx, sy, fw, sh);
        }
        ctx.restore();
    }

    // ── Inner / inset shadow ────────────────────────────────────

    function drawInnerShadowShape(ctx, shape, sx, sy, sw, sh, shapeOpts, isLine, enabled, col, blur, ox, oy) {
        if (!enabled || isLine) return;
        ctx.save();
        createShapePath(ctx, shape, sx, sy, sw, sh, shapeOpts);
        ctx.clip();
        ctx.globalCompositeOperation = 'destination-atop';
        ctx.shadowColor = col || '#000000';
        ctx.shadowBlur = blur || 10;
        ctx.shadowOffsetX = ox || 0;
        ctx.shadowOffsetY = oy || 0;
        ctx.fillStyle = '#000000';
        ctx.fillRect(sx - sw * 3, sy - sh * 3, sw * 7, sh * 7);
        ctx.restore();
    }

    // ── Background image (clipped, async-loaded) ────────────────

    function drawBackgroundImageClipped(ctx, img, sx, sy, sw, sh, fit, shape, shapeOpts, isLine) {
        if (!img || !img.complete || !img.naturalWidth || isLine) return;
        ctx.save();
        createShapePath(ctx, shape, sx, sy, sw, sh, shapeOpts);
        ctx.clip();
        var iw = img.naturalWidth;
        var ih = img.naturalHeight;
        if (fit === 'tile') {
            try {
                var pat = ctx.createPattern(img, 'repeat');
                if (pat) {
                    ctx.fillStyle = pat;
                    ctx.fillRect(sx, sy, sw, sh);
                }
            } catch (e2) {}
            ctx.restore();
            return;
        }
        if (fit === 'stretch') {
            ctx.drawImage(img, sx, sy, sw, sh);
            ctx.restore();
            return;
        }
        var scale = 1;
        var dw = sw;
        var dh = sh;
        if (fit === 'contain') {
            scale = Math.min(sw / iw, sh / ih);
            dw = iw * scale;
            dh = ih * scale;
        } else {
            scale = Math.max(sw / iw, sh / ih);
            dw = iw * scale;
            dh = ih * scale;
        }
        var dx = sx + (sw - dw) / 2;
        var dy = sy + (sh - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
    }

    function parseCornerRadiusOverride(raw, fallback) {
        if (raw === '' || raw === null || raw === undefined) return fallback;
        var n = parseInt(raw, 10);
        if (isNaN(n)) return fallback;
        return n;
    }

    // ── Font resolution ────────────────────────────────────────
    // Fonts are loaded locally via @font-face in visualization.css
    // (or prepended from shared/fonts.css at build time).
    // No external network requests — safe for air-gapped deployments.

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('infographic-shapes-viz');

            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.zIndex = '2';
            this.el.appendChild(this.canvas);

            this._lastGoodData = null;
            this._animPhase = 0;
            this._animTimer = null;
            this._reflowTimer = null;
            this._currentFont = '';
            this._fontWaitDone = false;
            this._hasDataRender = false;

            this._bgImage = null;
            this._bgImageUrl = '';
            this._tooltipEl = null;
            this._cachedTooltipText = '';
            this._onCanvasMouseMove = null;
            this._onCanvasMouseOut = null;
            this._onCanvasClick = null;
            this._animPhaseIncrement = 0.02;
        },

        setupView: function() {
            var self = this;
            this._setupTimer = setTimeout(function() {
                if (!self._hasDataRender) {
                    self._renderDefault();
                }
            }, 300);

            this._hideFrameworkPlaceholder();
            var obs = new MutationObserver(function() {
                self._hideFrameworkPlaceholder();
            });
            obs.observe(this.el.parentNode || this.el, { childList: true, subtree: true });
            this._placeholderObs = obs;

            var selfCanvas = this;
            if (!this._tooltipEl) {
                var tip = document.createElement('div');
                tip.style.position = 'absolute';
                tip.style.pointerEvents = 'none';
                tip.style.zIndex = '20';
                tip.style.display = 'none';
                tip.style.maxWidth = '320px';
                tip.style.padding = '6px 8px';
                tip.style.fontSize = '12px';
                tip.style.lineHeight = '1.3';
                tip.style.background = 'rgba(20,20,24,0.95)';
                tip.style.color = '#F8FAFC';
                tip.style.borderRadius = '4px';
                tip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
                tip.style.wordWrap = 'break-word';
                var pos = '';
                if (window.getComputedStyle) {
                    pos = window.getComputedStyle(this.el).position;
                }
                if (!pos || pos === 'static') {
                    this.el.style.position = 'relative';
                }
                this.el.appendChild(tip);
                this._tooltipEl = tip;
            }

            if (!this._onCanvasMouseMove) {
                this._onCanvasMouseMove = function(ev) {
                    if (!selfCanvas._cachedTooltipText || !selfCanvas._tooltipEl) return;
                    selfCanvas._tooltipEl.textContent = selfCanvas._cachedTooltipText;
                    selfCanvas._tooltipEl.style.display = 'block';
                    var r = selfCanvas.canvas.getBoundingClientRect();
                    var ex = ev.clientX - r.left;
                    var ey = ev.clientY - r.top;
                    var ox = 14;
                    var oy = 14;
                    selfCanvas._tooltipEl.style.left = (ex + ox) + 'px';
                    selfCanvas._tooltipEl.style.top = (ey + oy) + 'px';
                };
                this._onCanvasMouseOut = function() {
                    if (selfCanvas._tooltipEl) {
                        selfCanvas._tooltipEl.style.display = 'none';
                    }
                };
                this._onCanvasClick = function() {
                    var url = selfCanvas._drilldownUrlCached || '';
                    if (!url) return;
                    var nt = !!selfCanvas._drilldownNewTabCached;
                    if (nt) {
                        window.open(url, '_blank');
                    } else {
                        window.location.href = url;
                    }
                };
                this.canvas.addEventListener('mousemove', this._onCanvasMouseMove);
                this.canvas.addEventListener('mouseout', this._onCanvasMouseOut);
                this.canvas.addEventListener('click', this._onCanvasClick);
            }
        },

        _hideFrameworkPlaceholder: function() {
            var el = this.el;
            var parent = el.parentNode;
            if (!parent) return;
            var nodes = parent.querySelectorAll(
                '.viz-placeholder, .shared-viz-placeholder, ' +
                '[data-test="no-data-overlay"], [class*="no-data"], ' +
                '[class*="NoData"], [class*="placeholder"]'
            );
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i] !== el && !el.contains(nodes[i])) {
                    nodes[i].style.display = 'none';
                }
            }
        },

        _renderDefault: function() {
            var rect = this.el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                var self = this;
                setTimeout(function() { self._renderDefault(); }, 200);
                return;
            }

            this._hideFrameworkPlaceholder();

            // Render with config if available (Dashboard Studio passes config
            // even when no data source is attached).
            if (this._lastConfig) {
                this.updateView({ colIdx: {}, row: [] }, this._lastConfig);
                return;
            }

            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);

            var pad = 8;
            pathRoundedRect(ctx, pad, pad, rect.width - pad * 2, rect.height - pad * 2, 12);
            ctx.fillStyle = '#1E3A5F';
            ctx.fill();
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
                return { colIdx: {}, row: [] };
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            var row = data.rows[data.rows.length - 1];
            var result = { colIdx: colIdx, row: row };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            this._hasDataRender = true;
            if (config) this._lastConfig = config;
            this._hideFrameworkPlaceholder();

            if (!data) {
                if (this._lastGoodData) data = this._lastGoodData;
                else data = { colIdx: {}, row: [] };
            }
            if (!data.colIdx) data = { colIdx: {}, row: [] };

            var ns = this.getPropertyNamespaceInfo().propertyNamespace;

            // ── Shape & layout ──
            var shape       = getOption(config, ns, 'shape', 'rounded_rectangle');
            var rotation    = parseInt(getOption(config, ns, 'rotation', '0'), 10) || 0;
            var cornerRadius = parseInt(getOption(config, ns, 'cornerRadius', '12'), 10) || 0;
            var padding     = parseInt(getOption(config, ns, 'padding', '8'), 10) || 0;
            var opacity     = parseInt(getOption(config, ns, 'opacity', '100'), 10) / 100;

            // ── Size & position overrides (0 = auto) ──
            var overrideW = parseInt(getOption(config, ns, 'overrideWidth', '0'), 10) || 0;
            var overrideH = parseInt(getOption(config, ns, 'overrideHeight', '0'), 10) || 0;
            var overrideX = parseInt(getOption(config, ns, 'overrideX', '0'), 10);
            var overrideY = parseInt(getOption(config, ns, 'overrideY', '0'), 10);
            var hasOverridePos = getOption(config, ns, 'overrideX', '') !== '' && getOption(config, ns, 'overrideX', '') !== '0';
            var hasOverridePosY = getOption(config, ns, 'overrideY', '') !== '' && getOption(config, ns, 'overrideY', '') !== '0';

            // ── Fill ──
            var fillType      = getOption(config, ns, 'fillType', 'solid');
            var fillColor     = getOption(config, ns, 'fillColor', '#1E3A5F');
            var gradientColor = getOption(config, ns, 'gradientColor', '#06B6D4');
            var gradientColor2 = getOption(config, ns, 'gradientColor2', '');
            var gradientColor3 = getOption(config, ns, 'gradientColor3', '');
            var gradientDir   = getOption(config, ns, 'gradientDirection', 'vertical');

            // ── Stroke ──
            var strokeColor = getOption(config, ns, 'strokeColor', '#06B6D4');
            var strokeWidth = parseInt(getOption(config, ns, 'strokeWidth', '0'), 10) || 0;
            var strokeDash  = getOption(config, ns, 'strokeDash', 'solid');

            // ── Shadow ──
            var shadowOn      = getOption(config, ns, 'shadowEnabled', 'false') === 'true';
            var shadowColor   = getOption(config, ns, 'shadowColor', '#000000');
            var shadowBlur    = parseInt(getOption(config, ns, 'shadowBlur', '12'), 10) || 0;
            var shadowX       = parseInt(getOption(config, ns, 'shadowOffsetX', '4'), 10) || 0;
            var shadowY       = parseInt(getOption(config, ns, 'shadowOffsetY', '4'), 10) || 0;
            var shadowOpacity = parseInt(getOption(config, ns, 'shadowOpacity', '60'), 10) / 100;
            var shadowSpread  = parseInt(getOption(config, ns, 'shadowSpread', '1'), 10) || 1;

            // ── Glow ──
            var glowOn        = getOption(config, ns, 'glowEnabled', 'false') === 'true';
            var glowColor     = getOption(config, ns, 'glowColor', '#06B6D4');
            var glowSize      = parseInt(getOption(config, ns, 'glowSize', '15'), 10) || 0;
            var glowIntensity = parseInt(getOption(config, ns, 'glowIntensity', '2'), 10) || 1;

            // ── Reflection ──
            var reflectOn      = getOption(config, ns, 'reflectionEnabled', 'false') === 'true';
            var reflectOpacity = parseFloat(getOption(config, ns, 'reflectionOpacity', '0.15'));
            var reflectHeight  = parseInt(getOption(config, ns, 'reflectionHeight', '35'), 10) || 35;
            var reflectGap     = parseInt(getOption(config, ns, 'reflectionGap', '2'), 10);

            // ── Animation ──
            var animType = getOption(config, ns, 'animationType', 'none');

            // ── Text ──
            var text       = getOption(config, ns, 'text', '');
            var fontFamily = getOption(config, ns, 'fontFamily', '');
            var fontSize   = parseInt(getOption(config, ns, 'fontSize', '0'), 10) || 0;
            var fontWeight = getOption(config, ns, 'fontWeight', 'bold');
            var textColor  = getOption(config, ns, 'textColor', '#FFFFFF');
            var textAlign  = getOption(config, ns, 'textAlign', 'center');

            var radiusTLStr = getOption(config, ns, 'radiusTL', '');
            var radiusTRStr = getOption(config, ns, 'radiusTR', '');
            var radiusBLStr = getOption(config, ns, 'radiusBL', '');
            var radiusBRStr = getOption(config, ns, 'radiusBR', '');

            var iconRaw           = getOption(config, ns, 'icon', '');
            var iconSizeOpt       = parseInt(getOption(config, ns, 'iconSize', '0'), 10) || 0;
            var iconPosition      = getOption(config, ns, 'iconPosition', 'above');

            var backgroundImageUrl = getOption(config, ns, 'backgroundImage', '');
            var backgroundFit      = getOption(config, ns, 'backgroundFit', 'cover');

            var textPosition    = getOption(config, ns, 'textPosition', 'center');

            var subtitleTpl     = getOption(config, ns, 'subtitle', '');
            var subtitleSizeOpt = parseInt(getOption(config, ns, 'subtitleSize', '0'), 10) || 0;
            var subtitleColor   = getOption(config, ns, 'subtitleColor', '#E2E8F0');

            var progressEnabled   = getOption(config, ns, 'progressEnabled', 'false') === 'true';
            var progressStatic    = parseFloat(getOption(config, ns, 'progressValue', '0'));
            var progressColor     = getOption(config, ns, 'progressColor', '#22C55E');
            var progressDirection = getOption(config, ns, 'progressDirection', 'left-to-right');

            var tooltipTpl     = getOption(config, ns, 'tooltip', '');
            var tooltipField   = getOption(config, ns, 'tooltipField', '');

            var drilldownUrl   = getOption(config, ns, 'drilldownUrl', '');
            var drilldownNewTab = getOption(config, ns, 'drilldownNewTab', 'true') === 'true';
            this._drilldownUrlCached = drilldownUrl || '';
            this._drilldownNewTabCached = drilldownNewTab;

            var patternType   = getOption(config, ns, 'patternType', 'none');
            var patternColor  = getOption(config, ns, 'patternColor', '#000000');
            var patternScaleOpt = parseInt(getOption(config, ns, 'patternScale', '2'), 10) || 2;

            var textStrokeEnabled = getOption(config, ns, 'textStrokeEnabled', 'false') === 'true';
            var textStrokeColor   = getOption(config, ns, 'textStrokeColor', '#000000');
            var textStrokeWidth   = parseInt(getOption(config, ns, 'textStrokeWidth', '2'), 10) || 2;

            var innerShadowEnabled = getOption(config, ns, 'innerShadowEnabled', 'false') === 'true';
            var innerShadowColor   = getOption(config, ns, 'innerShadowColor', '#000000');
            var innerShadowBlur    = parseInt(getOption(config, ns, 'innerShadowBlur', '12'), 10) || 12;
            var innerShadowOffsetX = parseInt(getOption(config, ns, 'innerShadowOffsetX', '0'), 10) || 0;
            var innerShadowOffsetY = parseInt(getOption(config, ns, 'innerShadowOffsetY', '0'), 10) || 0;

            var flipH = getOption(config, ns, 'flipH', 'false') === 'true';
            var flipV = getOption(config, ns, 'flipV', 'false') === 'true';

            var animationSpeed = getOption(config, ns, 'animationSpeed', 'normal');

            var visibilityField   = getOption(config, ns, 'visibilityField', '');
            var visibilityValue   = getOption(config, ns, 'visibilityValue', '');
            var visibilityInvert  = getOption(config, ns, 'visibilityInvert', 'false') === 'true';

            var subtitleField     = getOption(config, ns, 'subtitleField', '');
            var progressField     = getOption(config, ns, 'progressField', '');

            // ── Data binding: colour field override ──
            var colorField = getOption(config, ns, 'colorField', '');
            if (colorField && data.colIdx[colorField] !== undefined && data.row.length > 0) {
                var cv = String(data.row[data.colIdx[colorField]] || '');
                if (cv) fillColor = cv;
            }

            // ── Data binding: text field override ──
            var textField = getOption(config, ns, 'textField', '');
            if (textField && data.colIdx[textField] !== undefined && data.row.length > 0) {
                var tv = String(data.row[data.colIdx[textField]] || '');
                if (tv) text = tv;
            }

            // ── Data binding: threshold colouring ──
            var valueField  = getOption(config, ns, 'field', '');
            if (valueField && data.colIdx[valueField] !== undefined && data.row.length > 0) {
                var numVal = parseFloat(data.row[data.colIdx[valueField]]);
                if (!isNaN(numVal)) {
                    var critThresh = parseFloat(getOption(config, ns, 'criticalThreshold', ''));
                    var warnThresh = parseFloat(getOption(config, ns, 'warningThreshold', ''));
                    var critColor  = getOption(config, ns, 'criticalColor', '#EF4444');
                    var warnColor  = getOption(config, ns, 'warningColor', '#F59E0B');
                    var normColor  = getOption(config, ns, 'normalColor', '');
                    if (!isNaN(critThresh) && numVal >= critThresh) fillColor = critColor;
                    else if (!isNaN(warnThresh) && numVal >= warnThresh) fillColor = warnColor;
                    else if (normColor) fillColor = normColor;
                }
            }

            var subtitleText = subtitleTpl;
            if (subtitleField && data.colIdx[subtitleField] !== undefined && data.row.length > 0) {
                var sbind = String(data.row[data.colIdx[subtitleField]] || '');
                if (sbind) subtitleText = sbind;
            }

            var progressPct = progressStatic;
            if (isNaN(progressPct)) progressPct = 0;
            if (progressField && data.colIdx[progressField] !== undefined && data.row.length > 0) {
                var pbind = parseFloat(data.row[data.colIdx[progressField]]);
                if (!isNaN(pbind)) progressPct = pbind;
            }

            var tipBase = tooltipTpl;
            if (tooltipField && data.colIdx[tooltipField] !== undefined && data.row.length > 0) {
                var tfb = data.row[data.colIdx[tooltipField]];
                if (tfb !== undefined && tfb !== null && String(tfb) !== '') {
                    tipBase = String(tfb);
                }
            }
            this._cachedTooltipText = replaceBraceTokens(tipBase, data.row || [], data.colIdx || {});

            var forceHide = false;
            if (visibilityField && data.colIdx[visibilityField] !== undefined && data.row.length > 0) {
                var fvVis = data.row[data.colIdx[visibilityField]];
                var matchedVis = false;
                if (visibilityValue === '' || visibilityValue === null || visibilityValue === undefined) {
                    matchedVis = !!fvVis;
                } else {
                    matchedVis = String(fvVis) === String(visibilityValue);
                }
                var shouldShowVis = visibilityInvert ? !matchedVis : matchedVis;
                forceHide = !shouldShowVis;
            }

            var bgImgUrlEff = backgroundImageUrl;
            if (bgImgUrlEff && bgImgUrlEff !== this._bgImageUrl) {
                this._bgImageUrl = bgImgUrlEff;
                this._bgImage = new Image();
                var selfBg = this;
                this._bgImage.onload = function() {
                    selfBg.invalidateUpdateView();
                };
                this._bgImage.onerror = function() {
                    selfBg._bgImage = null;
                };
                try {
                    this._bgImage.crossOrigin = 'anonymous';
                } catch (eCg) {}
                this._bgImage.src = bgImgUrlEff;
            }
            if (!bgImgUrlEff) {
                this._bgImage = null;
                this._bgImageUrl = '';
            }

            // ── Canvas setup ──
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
            ctx.clearRect(0, 0, w, h);

            if (forceHide) {
                this.canvas.style.cursor = 'default';
                this._cachedTooltipText = '';
                this._drilldownUrlCached = '';
                return;
            }

            this.canvas.style.cursor = drilldownUrl ? 'pointer' : 'default';

            // ── Font resolution (local only — no network fetch) ──
            var fontStr = 'sans-serif';
            if (fontFamily) {
                fontStr = '"' + fontFamily + '", sans-serif';

                if (document.fonts && document.fonts.check) {
                    var testStr = '16px "' + fontFamily + '"';
                    if (!document.fonts.check(testStr)) {
                        if (this._currentFont !== fontFamily) {
                            this._currentFont = fontFamily;
                            var self3 = this;
                            document.fonts.load(testStr).then(function() {
                                self3.invalidateUpdateView();
                            });
                        }
                    }
                }
            }

            this._animPhaseIncrement = animationSpeedToIncrement(animationSpeed);

            // ── Animation phase ──
            var animScale = 1;
            var animAlpha = 1;
            var animGlowMul = 1;
            var animRotation = 0;

            if (animType !== 'none') {
                if (!this._animTimer) {
                    var self2 = this;
                    var lastFrameTime = 0;
                    var tick = function(timestamp) {
                        if (!self2._animTimer) return;
                        if (lastFrameTime > 0) {
                            var dt = (timestamp - lastFrameTime) / 1000;
                            var step = self2._animPhaseIncrement || 0.02;
                            self2._animPhase = (self2._animPhase + step * dt * 30) % 1;
                        }
                        lastFrameTime = timestamp;
                        self2.invalidateUpdateView();
                        self2._animTimer = requestAnimationFrame(tick);
                    };
                    this._animTimer = requestAnimationFrame(tick);
                }
                var phase = this._animPhase;
                var wave = (Math.sin(phase * Math.PI * 2) + 1) / 2;

                if (animType === 'pulse') {
                    animAlpha = 0.5 + wave * 0.5;
                } else if (animType === 'glow_pulse') {
                    animGlowMul = 0.3 + wave * 1.2;
                } else if (animType === 'breathe') {
                    animScale = 0.95 + wave * 0.05;
                } else if (animType === 'spin') {
                    animRotation = phase * 360;
                }
            } else if (this._animTimer) {
                cancelAnimationFrame(this._animTimer);
                this._animTimer = null;
                this._animPhase = 0;
            }

            // ── Shape bounds (with padding for effects) ──
            var effectPad = Math.max(padding, 4);
            if (shadowOn) effectPad = Math.max(effectPad, shadowBlur + Math.abs(shadowX) + Math.abs(shadowY));
            if (glowOn) effectPad = Math.max(effectPad, glowSize + 4);
            if (reflectOn) effectPad = Math.max(effectPad, 4);

            var sx, sy, sw, sh;

            if (overrideW > 0 || overrideH > 0) {
                sw = overrideW > 0 ? overrideW : w - effectPad * 2;
                sh = overrideH > 0 ? overrideH : h - effectPad * 2;
                sx = (overrideW > 0 || hasOverridePos) ? overrideX : (w - sw) / 2;
                sy = (overrideH > 0 || hasOverridePosY) ? overrideY : (h - sh) / 2;
            } else {
                sx = effectPad;
                sy = effectPad;
                sw = w - effectPad * 2;
                sh = h - effectPad * 2;
            }

            if (reflectOn) {
                var reflectSharePct = reflectHeight / 100;
                sh = sh * (1 - reflectSharePct * 0.5);
            }

            if (sw <= 0 || sh <= 0) return;

            var isLine = !!LINE_SHAPES[shape];

            var shapeOpts = { cornerRadius: cornerRadius };
            if (shape === 'rounded_rectangle' &&
                    ((radiusTLStr !== '' && radiusTLStr !== null && radiusTLStr !== undefined) ||
                    (radiusTRStr !== '' && radiusTRStr !== null && radiusTRStr !== undefined) ||
                    (radiusBRStr !== '' && radiusBRStr !== null && radiusBRStr !== undefined) ||
                    (radiusBLStr !== '' && radiusBLStr !== null && radiusBLStr !== undefined))) {
                shapeOpts.perCornerRadii = {
                    tl: parseCornerRadiusOverride(radiusTLStr, cornerRadius),
                    tr: parseCornerRadiusOverride(radiusTRStr, cornerRadius),
                    br: parseCornerRadiusOverride(radiusBRStr, cornerRadius),
                    bl: parseCornerRadiusOverride(radiusBLStr, cornerRadius)
                };
            }

            // ── Apply transforms ──
            ctx.save();
            ctx.globalAlpha = opacity * animAlpha;

            var totalRotation = rotation + animRotation;
            if (totalRotation !== 0 || animScale !== 1) {
                ctx.translate(w / 2, reflectOn ? sy + sh / 2 : h / 2);
                if (totalRotation !== 0) ctx.rotate(totalRotation * Math.PI / 180);
                if (animScale !== 1) ctx.scale(animScale, animScale);
                ctx.translate(-w / 2, reflectOn ? -(sy + sh / 2) : -h / 2);
            }

            if (flipH || flipV) {
                var sfx = sx + sw / 2;
                var sfy = sy + sh / 2;
                ctx.translate(sfx, sfy);
                ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
                ctx.translate(-sfx, -sfy);
            }

            // ── Draw shadow layer (with spread passes) ──
            if (shadowOn && !isLine) {
                var shadowPasses = Math.max(1, Math.min(shadowSpread, 5));
                for (var sp = 0; sp < shadowPasses; sp++) {
                    ctx.save();
                    ctx.shadowColor = hexToRgba(shadowColor, shadowOpacity);
                    ctx.shadowBlur = shadowBlur;
                    ctx.shadowOffsetX = shadowX;
                    ctx.shadowOffsetY = shadowY;
                    createShapePath(ctx, shape, sx, sy, sw, sh, shapeOpts);
                    ctx.fillStyle = 'rgba(0,0,0,0.01)';
                    ctx.fill();
                    ctx.restore();
                }
            }

            // ── Draw glow layer (intensity = number of passes) ──
            if (glowOn && !isLine) {
                var glowPasses2 = Math.max(1, Math.min(glowIntensity, 5));
                for (var gp = 0; gp < glowPasses2; gp++) {
                    ctx.save();
                    ctx.shadowColor = glowColor;
                    ctx.shadowBlur = glowSize * animGlowMul;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    createShapePath(ctx, shape, sx, sy, sw, sh, shapeOpts);
                    ctx.fillStyle = glowColor;
                    ctx.fill();
                    ctx.restore();
                }
            }

            // ── Build gradient colour array ──
            var gradColors = [fillColor, gradientColor];
            if (gradientColor2) gradColors.push(gradientColor2);
            if (gradientColor3) gradColors.push(gradientColor3);

            // ── Draw main fill ──
            createShapePath(ctx, shape, sx, sy, sw, sh, shapeOpts);

            if (!isLine && fillType !== 'none') {
                if (fillType === 'gradient') {
                    ctx.fillStyle = createGradient(ctx, gradientDir, sx, sy, sw, sh, gradColors);
                } else {
                    ctx.fillStyle = fillColor;
                }
                ctx.fill();
            }

            if (!isLine && this._bgImage && this._bgImageUrl) {
                drawBackgroundImageClipped(ctx, this._bgImage, sx, sy, sw, sh, backgroundFit, shape, shapeOpts, isLine);
            }

            if (progressEnabled) {
                drawProgressClipped(ctx, shape, sx, sy, sw, sh, shapeOpts, progressPct, progressDirection, progressColor, isLine);
            }

            drawInnerShadowShape(
                ctx, shape, sx, sy, sw, sh, shapeOpts, isLine,
                innerShadowEnabled && !isLine, innerShadowColor, innerShadowBlur, innerShadowOffsetX, innerShadowOffsetY
            );

            if (!isLine && patternType && patternType !== 'none') {
                var patt = createShapePattern(ctx, patternType, patternColor, patternScaleOpt);
                if (patt) {
                    ctx.save();
                    createShapePath(ctx, shape, sx, sy, sw, sh, shapeOpts);
                    ctx.clip();
                    ctx.globalAlpha = 0.38;
                    ctx.fillStyle = patt;
                    ctx.fill();
                    ctx.restore();
                }
            }

            // ── Draw stroke ──
            if (strokeWidth > 0 || isLine) {
                var sw2 = isLine ? Math.max(strokeWidth, 2) : strokeWidth;
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = sw2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                applyStrokeDash(ctx, strokeDash, sw2);

                createShapePath(ctx, shape, sx, sy, sw, sh, shapeOpts);

                if (isLine && shadowOn) {
                    ctx.shadowColor = hexToRgba(shadowColor, 0.6);
                    ctx.shadowBlur = shadowBlur;
                    ctx.shadowOffsetX = shadowX;
                    ctx.shadowOffsetY = shadowY;
                }

                ctx.stroke();
                ctx.setLineDash([]);
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            }

            var mainDrawStr = text ? String(text) : '';
            var subDrawStr = subtitleText ? String(subtitleText) : '';
            var iconDrawStr = iconRaw ? String(iconRaw) : '';
            var hasMainTxt = !!(mainDrawStr.length);
            var hasSubTxt = !!(subDrawStr.length);
            var hasIconTxt = !!(iconDrawStr.length);

            if (hasMainTxt || hasSubTxt || hasIconTxt) {
                var fw2 = fontWeight === 'normal' ? '400' : fontWeight === 'light' ? '300' : '700';
                var maxTextW = sw * 0.85;
                var maxTextHei = sh * 0.6;
                var autoSizeMain = fontSize > 0 ? fontSize : Math.max(10, Math.min(maxTextHei, sw * 0.3));

                var mainPxDraw = autoSizeMain;
                if (hasMainTxt) {
                    mainPxDraw = fitText(ctx, mainDrawStr, maxTextW, autoSizeMain, fw2, fontStr);
                }

                var subPxDraw = subtitleSizeOpt > 0 ? subtitleSizeOpt : Math.max(
                    8,
                    Math.min(Math.round(mainPxDraw * 0.58), Math.floor(sw * 0.16))
                );
                if (hasSubTxt) {
                    subPxDraw = fitText(ctx, subDrawStr, maxTextW, subPxDraw, '400', fontStr);
                }

                var iconPxDraw = iconSizeOpt > 0 ? iconSizeOpt : Math.round(
                    Math.min(sw * 0.28, Math.max(mainPxDraw, 14) * 1.08)
                );
                var emojiFontSuffix = '\"Apple Color Emoji\",\"Segoe UI Emoji\",' + fontStr;

                var txDraw;
                if (textAlign === 'left') txDraw = sx + sw * 0.08;
                else if (textAlign === 'right') txDraw = sx + sw - sw * 0.08;
                else txDraw = sx + sw / 2;

                ctx.textBaseline = 'middle';

                var gapIco = Math.max(4, Math.min(sw, sh) * 0.03);

                function drawOutlinedMain(px, fy, lbl) {
                    ctx.font = fw2 + ' ' + px + 'px ' + fontStr;
                    ctx.textAlign = textAlign;
                    if (textStrokeEnabled) {
                        var swTx = Math.max(1, Math.min(5, textStrokeWidth));
                        ctx.lineWidth = swTx;
                        ctx.strokeStyle = textStrokeColor;
                        ctx.lineJoin = 'round';
                        ctx.miterLimit = 2;
                        ctx.strokeText(lbl, txDraw, fy);
                    }
                    ctx.fillStyle = textColor;
                    ctx.fillText(lbl, txDraw, fy);
                }

                function drawSubtitleLineLocal(fy) {
                    ctx.font = '400 ' + subPxDraw + 'px ' + fontStr;
                    ctx.textAlign = textAlign;
                    if (textStrokeEnabled) {
                        var swTxB = Math.max(1, Math.min(5, textStrokeWidth));
                        ctx.lineWidth = swTxB * 0.85;
                        ctx.strokeStyle = textStrokeColor;
                        ctx.strokeText(subDrawStr, txDraw, fy);
                    }
                    ctx.fillStyle = subtitleColor;
                    ctx.fillText(subDrawStr, txDraw, fy);
                }

                var midGapTxt = hasMainTxt && hasSubTxt ? Math.max(4, Math.round(mainPxDraw * 0.12)) : 0;

                var refFp = mainPxDraw;
                if (!hasMainTxt && hasSubTxt) {
                    refFp = subPxDraw;
                }

                var anchorY = sy + sh / 2;
                if (textPosition === 'top') {
                    anchorY = sy + refFp / 2 + 4;
                } else if (textPosition === 'bottom') {
                    anchorY = sy + sh - refFp / 2 - 4;
                } else if (textPosition === 'below') {
                    anchorY = sy + sh + refFp + 4;
                }

                var mainYLine = anchorY;
                var subYLine = anchorY;
                if (hasMainTxt && hasSubTxt) {
                    mainYLine = anchorY - (subPxDraw / 2 + midGapTxt / 2);
                    subYLine = anchorY + (mainPxDraw / 2 + midGapTxt / 2);
                } else if (!hasMainTxt && hasSubTxt) {
                    mainYLine = anchorY;
                    subYLine = anchorY;
                }

                var posIco = String(iconPosition || 'above').toLowerCase();

                ctx.font = '400 ' + iconPxDraw + 'px ' + emojiFontSuffix;
                var iconWidMeasured = hasIconTxt ? Math.max(iconPxDraw, ctx.measureText(iconDrawStr).width) : 0;

                ctx.font = fw2 + ' ' + mainPxDraw + 'px ' + fontStr;
                var mainWMeasured = hasMainTxt ? ctx.measureText(mainDrawStr).width : 0;

                ctx.font = '400 ' + subPxDraw + 'px ' + fontStr;
                var subWMeasured = hasSubTxt ? ctx.measureText(subDrawStr).width : 0;

                var textPackW = Math.min(maxTextW, Math.max(mainWMeasured, subWMeasured));
                var colH =
                    (hasMainTxt ? mainPxDraw : 0) +
                    (hasMainTxt && hasSubTxt ? midGapTxt : 0) +
                    (hasSubTxt ? subPxDraw : 0);

                var drawIconEmoji = !!hasIconTxt;
                var centerXShape = sx + sw / 2;

                function drawTextsAt(ix, iyMain, iySub, alignMode) {
                    var prev = ctx.textAlign;
                    ctx.textAlign = alignMode;
                    var lx = ix;
                    if (hasMainTxt) {
                        ctx.font = fw2 + ' ' + mainPxDraw + 'px ' + fontStr;
                        if (textStrokeEnabled) {
                            var swM = Math.max(1, Math.min(5, textStrokeWidth));
                            ctx.lineWidth = swM;
                            ctx.strokeStyle = textStrokeColor;
                            ctx.lineJoin = 'round';
                            ctx.miterLimit = 2;
                            ctx.strokeText(mainDrawStr, lx, iyMain);
                        }
                        ctx.fillStyle = textColor;
                        ctx.fillText(mainDrawStr, lx, iyMain);
                    }
                    if (hasSubTxt) {
                        ctx.font = '400 ' + subPxDraw + 'px ' + fontStr;
                        if (textStrokeEnabled) {
                            var swS = Math.max(1, Math.min(5, textStrokeWidth));
                            ctx.lineWidth = swS * 0.85;
                            ctx.strokeStyle = textStrokeColor;
                            ctx.strokeText(subDrawStr, lx, iySub);
                        }
                        ctx.fillStyle = subtitleColor;
                        ctx.fillText(subDrawStr, lx, iySub);
                    }
                    ctx.textAlign = prev;
                }

                function drawEmojiLocal(cxCy, icy) {
                    ctx.font = '400 ' + iconPxDraw + 'px ' + emojiFontSuffix;
                    ctx.textAlign = 'center';
                    ctx.fillStyle = textColor;
                    ctx.fillText(iconDrawStr, cxCy, icy);
                    ctx.textAlign = textAlign;
                }

                if (!drawIconEmoji) {
                    if (hasMainTxt) drawOutlinedMain(mainPxDraw, mainYLine, mainDrawStr);
                    if (hasSubTxt) drawSubtitleLineLocal(subYLine);
                } else if (posIco === 'left' || posIco === 'right') {
                    var bundleW = iconWidMeasured + gapIco + textPackW;
                    var packOrigin = centerXShape - bundleW / 2;
                    if (textAlign === 'left') {
                        packOrigin = sx + sw * 0.08;
                    } else if (textAlign === 'right') {
                        packOrigin = sx + sw - sw * 0.08 - bundleW;
                    }

                    var iconCenterXBlk;
                    var textAnchorXBlk;
                    var txtAlignPick = textAlign === 'center' ? 'center' :
                        textAlign === 'left' ? 'left' : 'right';

                    if (posIco === 'left') {
                        iconCenterXBlk = packOrigin + iconWidMeasured / 2;
                        textAnchorXBlk = packOrigin + iconWidMeasured + gapIco;
                        if (textAlign === 'center') {
                            textAnchorXBlk += textPackW / 2;
                            txtAlignPick = 'center';
                        }
                    } else {
                        iconCenterXBlk = packOrigin + textPackW + gapIco + iconWidMeasured / 2;
                        textAnchorXBlk = packOrigin + textPackW / 2;
                        if (textAlign !== 'center') {
                            txtAlignPick = textAlign;
                            textAnchorXBlk = packOrigin + (textAlign === 'left'
                                ? 0
                                : textPackW);
                        }
                    }

                    ctx.save();
                    if (txtAlignPick === 'left') {
                        drawTextsAt(textAnchorXBlk, mainYLine, subYLine, 'left');
                    } else if (txtAlignPick === 'right') {
                        drawTextsAt(textAnchorXBlk, mainYLine, subYLine, 'right');
                    } else {
                        drawTextsAt(textAnchorXBlk, mainYLine, subYLine, 'center');
                    }
                    ctx.restore();

                    var iconVertCenter = anchorY;
                    drawEmojiLocal(iconCenterXBlk, iconVertCenter);
                } else {
                    var iconAboveUse = !(posIco === 'below' || posIco === 'bottom');

                    var iconCyCol = iconAboveUse
                        ? anchorY - colH / 2 - gapIco - iconPxDraw / 2
                        : anchorY + colH / 2 + gapIco + iconPxDraw / 2;

                    drawEmojiLocal(txDraw, iconCyCol);

                    if (hasMainTxt) drawOutlinedMain(mainPxDraw, mainYLine, mainDrawStr);
                    if (hasSubTxt) drawSubtitleLineLocal(subYLine);
                }
            }

            ctx.restore();

            // ── Draw reflection ──
            if (reflectOn && !isLine) {
                var refY = sy + sh + reflectGap;
                var refH = sh * (reflectHeight / 100);

                ctx.save();
                ctx.globalAlpha = reflectOpacity;
                ctx.translate(0, refY + refH);
                ctx.scale(1, -1);
                ctx.translate(0, -(refY - sh + refH));

                createShapePath(ctx, shape, sx, refY - sh, sw, sh, shapeOpts);
                if (fillType === 'gradient') {
                    ctx.fillStyle = createGradient(ctx, gradientDir, sx, refY - sh, sw, sh, gradColors);
                } else {
                    ctx.fillStyle = fillColor;
                }
                ctx.fill();
                ctx.restore();

                var fadeGrad = ctx.createLinearGradient(0, refY, 0, refY + refH);
                fadeGrad.addColorStop(0, 'rgba(0,0,0,0)');
                fadeGrad.addColorStop(1, 'rgba(0,0,0,1)');

                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillStyle = fadeGrad;
                ctx.fillRect(0, refY, w, refH + 10);
                ctx.restore();
            }
        },

        reflow: function() {
            if (this._reflowTimer) return;
            var self = this;
            this._reflowTimer = setTimeout(function() {
                self._reflowTimer = null;
                self.invalidateUpdateView();
            }, 16);
        },

        destroy: function() {
            if (this._animTimer) {
                cancelAnimationFrame(this._animTimer);
                this._animTimer = null;
            }
            if (this._reflowTimer) {
                clearTimeout(this._reflowTimer);
                this._reflowTimer = null;
            }
            if (this._setupTimer) {
                clearTimeout(this._setupTimer);
                this._setupTimer = null;
            }
            if (this._placeholderObs) {
                this._placeholderObs.disconnect();
                this._placeholderObs = null;
            }
            if (this.canvas && this._onCanvasMouseMove) {
                this.canvas.removeEventListener('mousemove', this._onCanvasMouseMove);
                this.canvas.removeEventListener('mouseout', this._onCanvasMouseOut);
                this.canvas.removeEventListener('click', this._onCanvasClick);
            }
            this._onCanvasMouseMove = null;
            this._onCanvasMouseOut = null;
            this._onCanvasClick = null;
            if (this._tooltipEl && this._tooltipEl.parentNode) {
                this._tooltipEl.parentNode.removeChild(this._tooltipEl);
            }
            this._tooltipEl = null;
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
