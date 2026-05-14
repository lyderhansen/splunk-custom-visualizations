var { createCanvas } = require('canvas');
var fs = require('fs');
var path = require('path');

var APP_ROOT = __dirname;
var DARK_BG = '#1f2734';
var PREVIEW_BG = '#171d27';
var TEAL = '#2bbfb8';
var TEAL_DIM = 'rgba(43,191,184,0.35)';
var TEAL_FAINT = 'rgba(43,191,184,0.15)';
var WHITE = '#ffffff';
var ORANGE = '#f7931e';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function savePNG(canvas, filePath) {
    ensureDir(path.dirname(filePath));
    var buf = canvas.toBuffer('image/png');
    fs.writeFileSync(filePath, buf);
    console.log('  wrote ' + filePath);
}

// ---------------------------------------------------------------------------
// 1. App Icons
// ---------------------------------------------------------------------------

function drawAppIcon(size) {
    var c = createCanvas(size, size);
    var ctx = c.getContext('2d');
    // Background
    ctx.fillStyle = DARK_BG;
    ctx.fillRect(0, 0, size, size);
    // "SC" text
    var fontSize = Math.round(size * 0.42);
    ctx.fillStyle = TEAL;
    ctx.font = 'bold ' + fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SC', size / 2, size / 2 + 1);
    return c;
}

function generateAppIcons() {
    var staticDir = path.join(APP_ROOT, 'static');
    ensureDir(staticDir);

    var icon36 = drawAppIcon(36);
    var icon72 = drawAppIcon(72);

    savePNG(icon36, path.join(staticDir, 'appIcon.png'));
    savePNG(icon72, path.join(staticDir, 'appIcon_2x.png'));
    savePNG(icon36, path.join(staticDir, 'appIconAlt.png'));
    savePNG(icon72, path.join(staticDir, 'appIconAlt_2x.png'));
}

// ---------------------------------------------------------------------------
// 2. Preview Thumbnails  (256 x 144)
// ---------------------------------------------------------------------------

var W = 256;
var H = 144;

function newPreview() {
    var c = createCanvas(W, H);
    var ctx = c.getContext('2d');
    ctx.fillStyle = PREVIEW_BG;
    ctx.fillRect(0, 0, W, H);
    return { canvas: c, ctx: ctx };
}

// --- single_value_tile ---
function drawSingleValueTile() {
    var p = newPreview();
    var ctx = p.ctx;
    // Big number
    ctx.fillStyle = TEAL;
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('247', W / 2, H * 0.38);
    // Unit
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '14px sans-serif';
    ctx.fillText('ms', W / 2, H * 0.58);
    // Tiny sparkline bottom-right
    ctx.strokeStyle = TEAL_DIM;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var sx = W * 0.60, sy = H * 0.82;
    var pts = [0, 6, 3, 8, 2, 9, 4, 1];
    for (var i = 0; i < pts.length; i++) {
        var x = sx + i * 8;
        var y = sy - pts[i] * 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    return p.canvas;
}

// --- sparkline ---
function drawSparkline() {
    var p = newPreview();
    var ctx = p.ctx;
    var pts = [90, 75, 80, 55, 60, 40, 45, 30, 25, 20, 15];
    var step = W / (pts.length - 1);
    // Gradient fill
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(43,191,184,0.4)');
    grad.addColorStop(1, 'rgba(43,191,184,0.02)');
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var i = 0; i < pts.length; i++) {
        ctx.lineTo(i * step, H * 0.15 + pts[i]);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    // Line
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) {
        var x = j * step, y = H * 0.15 + pts[j];
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    return p.canvas;
}

// --- area_chart ---
function drawAreaChart() {
    var p = newPreview();
    var ctx = p.ctx;
    var series = [
        { color: 'rgba(43,191,184,0.45)', pts: [80, 65, 70, 50, 55, 40, 35] },
        { color: 'rgba(43,191,184,0.25)', pts: [95, 85, 90, 70, 75, 60, 50] },
        { color: 'rgba(43,191,184,0.12)', pts: [110, 100, 105, 90, 95, 80, 70] }
    ];
    for (var s = series.length - 1; s >= 0; s--) {
        var pts = series[s].pts;
        var step = W / (pts.length - 1);
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (var i = 0; i < pts.length; i++) ctx.lineTo(i * step, pts[i]);
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = series[s].color;
        ctx.fill();
    }
    // Top line for first series
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2;
    ctx.beginPath();
    var top = series[0].pts;
    var st = W / (top.length - 1);
    for (var k = 0; k < top.length; k++) {
        if (k === 0) ctx.moveTo(0, top[k]); else ctx.lineTo(k * st, top[k]);
    }
    ctx.stroke();
    return p.canvas;
}

// --- column_chart ---
function drawColumnChart() {
    var p = newPreview();
    var ctx = p.ctx;
    var bars = [0.6, 0.85, 0.45, 0.95, 0.7, 0.55];
    var gap = 8;
    var barW = (W - gap * (bars.length + 1)) / bars.length;
    var maxH = H * 0.75;
    for (var i = 0; i < bars.length; i++) {
        var bh = bars[i] * maxH;
        var x = gap + i * (barW + gap);
        var y = H - 16 - bh;
        ctx.fillStyle = TEAL;
        ctx.fillRect(x, y, barW, bh);
    }
    // Baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gap, H - 15);
    ctx.lineTo(W - gap, H - 15);
    ctx.stroke();
    return p.canvas;
}

// --- h_bar_list ---
function drawHBarList() {
    var p = newPreview();
    var ctx = p.ctx;
    var widths = [0.9, 0.75, 0.6, 0.45, 0.3];
    var barH = 16;
    var gap = 8;
    var startY = (H - widths.length * (barH + gap) + gap) / 2;
    for (var i = 0; i < widths.length; i++) {
        var y = startY + i * (barH + gap);
        var w = widths[i] * (W - 40);
        ctx.fillStyle = TEAL;
        ctx.globalAlpha = 1 - i * 0.12;
        ctx.fillRect(20, y, w, barH);
    }
    ctx.globalAlpha = 1;
    return p.canvas;
}

// --- heatmap ---
function drawHeatmap() {
    var p = newPreview();
    var ctx = p.ctx;
    var rows = 4, cols = 5;
    var cellW = 36, cellH = 24;
    var gapX = 6, gapY = 6;
    var totalW = cols * cellW + (cols - 1) * gapX;
    var totalH = rows * cellH + (rows - 1) * gapY;
    var offX = (W - totalW) / 2;
    var offY = (H - totalH) / 2;
    var opacities = [
        [0.9, 0.3, 0.6, 0.8, 0.2],
        [0.4, 0.7, 0.5, 0.3, 0.9],
        [0.6, 0.2, 0.8, 0.4, 0.7],
        [0.3, 0.5, 0.9, 0.6, 0.2]
    ];
    for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
            ctx.fillStyle = 'rgba(43,191,184,' + opacities[r][c] + ')';
            ctx.fillRect(
                offX + c * (cellW + gapX),
                offY + r * (cellH + gapY),
                cellW, cellH
            );
        }
    }
    return p.canvas;
}

// --- ring_gauge ---
function drawRingGauge() {
    var p = newPreview();
    var ctx = p.ctx;
    var cx = W / 2, cy = H / 2 + 4;
    var r = 44;
    var lineW = 10;
    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.75 * Math.PI, 0.25 * Math.PI);
    ctx.strokeStyle = 'rgba(43,191,184,0.15)';
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.stroke();
    // Filled arc (62% of 270 degrees)
    var startAngle = 0.75 * Math.PI;
    var totalAngle = 1.5 * Math.PI; // 270 degrees
    var fillAngle = startAngle + totalAngle * 0.62;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, fillAngle);
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.stroke();
    // Center text "62"
    ctx.fillStyle = WHITE;
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('62', cx, cy);
    return p.canvas;
}

// --- donut ---
function drawDonut() {
    var p = newPreview();
    var ctx = p.ctx;
    var cx = W / 2, cy = H / 2;
    var r = 44;
    var lineW = 18;
    var segments = [0.35, 0.25, 0.22, 0.18];
    var colors = [TEAL, 'rgba(43,191,184,0.65)', 'rgba(43,191,184,0.4)', 'rgba(43,191,184,0.2)'];
    var angle = -0.5 * Math.PI;
    for (var i = 0; i < segments.length; i++) {
        var sweep = segments[i] * 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, r, angle + 0.02, angle + sweep - 0.02);
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = lineW;
        ctx.lineCap = 'butt';
        ctx.stroke();
        angle += sweep;
    }
    return p.canvas;
}

// --- funnel ---
function drawFunnel() {
    var p = newPreview();
    var ctx = p.ctx;
    var widths = [0.95, 0.75, 0.55, 0.38, 0.22];
    var barH = 18;
    var gap = 5;
    var startY = (H - widths.length * (barH + gap) + gap) / 2;
    for (var i = 0; i < widths.length; i++) {
        var w = widths[i] * (W - 40);
        var x = (W - w) / 2;
        var y = startY + i * (barH + gap);
        ctx.fillStyle = 'rgba(43,191,184,' + (1 - i * 0.15) + ')';
        ctx.fillRect(x, y, w, barH);
    }
    return p.canvas;
}

// --- status_chip ---
function drawStatusChip() {
    var p = newPreview();
    var ctx = p.ctx;
    var chipW = 140, chipH = 36;
    var cx = W / 2, cy = H / 2;
    var rx = cx - chipW / 2, ry = cy - chipH / 2;
    var radius = chipH / 2;
    // Rounded rect
    ctx.beginPath();
    ctx.moveTo(rx + radius, ry);
    ctx.lineTo(rx + chipW - radius, ry);
    ctx.arc(rx + chipW - radius, ry + radius, radius, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(rx + radius, ry + chipH);
    ctx.arc(rx + radius, ry + radius, radius, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(43,191,184,0.18)';
    ctx.fill();
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Dot
    ctx.beginPath();
    ctx.arc(rx + 22, cy, 5, 0, 2 * Math.PI);
    ctx.fillStyle = TEAL;
    ctx.fill();
    // Text
    ctx.fillStyle = WHITE;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Healthy', rx + 36, cy + 1);
    return p.canvas;
}

// --- data_table ---
function drawDataTable() {
    var p = newPreview();
    var ctx = p.ctx;
    var rows = 5; // 1 header + 4 body
    var cols = 4;
    var tableW = W - 32, tableH = H - 24;
    var offX = 16, offY = 12;
    var rowH = tableH / rows;
    var colW = tableW / cols;
    // Header background
    ctx.fillStyle = 'rgba(43,191,184,0.2)';
    ctx.fillRect(offX, offY, tableW, rowH);
    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (var r = 0; r <= rows; r++) {
        var y = offY + r * rowH;
        ctx.beginPath();
        ctx.moveTo(offX, y);
        ctx.lineTo(offX + tableW, y);
        ctx.stroke();
    }
    for (var c = 0; c <= cols; c++) {
        var x = offX + c * colW;
        ctx.beginPath();
        ctx.moveTo(x, offY);
        ctx.lineTo(x, offY + tableH);
        ctx.stroke();
    }
    // Fake header text
    ctx.fillStyle = TEAL;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var headers = ['Host', 'Status', 'Count', 'Avg'];
    for (var h = 0; h < headers.length; h++) {
        ctx.fillText(headers[h], offX + h * colW + 6, offY + rowH / 2);
    }
    // Fake body cells
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '8px sans-serif';
    for (var br = 1; br < rows; br++) {
        for (var bc = 0; bc < cols; bc++) {
            ctx.fillRect(offX + bc * colW + 6, offY + br * rowH + rowH / 2 - 2, 28 + Math.random() * 12, 4);
        }
    }
    return p.canvas;
}

// --- pop_grid ---
function drawPopGrid() {
    var p = newPreview();
    var ctx = p.ctx;
    var gridCols = 4, gridRows = 4;
    var cardW = 48, cardH = 24;
    var gapX = 8, gapY = 8;
    var totalW = gridCols * cardW + (gridCols - 1) * gapX;
    var totalH = gridRows * cardH + (gridRows - 1) * gapY;
    var offX = (W - totalW) / 2;
    var offY = (H - totalH) / 2;
    for (var r = 0; r < gridRows; r++) {
        for (var c = 0; c < gridCols; c++) {
            var x = offX + c * (cardW + gapX);
            var y = offY + r * (cardH + gapY);
            ctx.fillStyle = 'rgba(43,191,184,0.12)';
            ctx.fillRect(x, y, cardW, cardH);
            ctx.strokeStyle = 'rgba(43,191,184,0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, cardW, cardH);
            // Tiny number
            ctx.fillStyle = TEAL;
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(Math.floor(Math.random() * 90 + 10)), x + cardW / 2, y + cardH / 2);
        }
    }
    return p.canvas;
}

// --- wordmark ---
function drawWordmark() {
    var p = newPreview();
    var ctx = p.ctx;
    // Orange chevron
    ctx.fillStyle = ORANGE;
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('>', W / 2 - 42, H / 2);
    // "splunk" text in white
    ctx.fillStyle = WHITE;
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('splunk', W / 2 - 36, H / 2);
    return p.canvas;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Generating app icons...');
generateAppIcons();

var vizDir = path.join(APP_ROOT, 'appserver', 'static', 'visualizations');

var previews = {
    single_value_tile: drawSingleValueTile,
    sparkline: drawSparkline,
    area_chart: drawAreaChart,
    column_chart: drawColumnChart,
    h_bar_list: drawHBarList,
    heatmap: drawHeatmap,
    ring_gauge: drawRingGauge,
    donut: drawDonut,
    funnel: drawFunnel,
    status_chip: drawStatusChip,
    data_table: drawDataTable,
    pop_grid: drawPopGrid,
    wordmark: drawWordmark
};

console.log('\nGenerating preview thumbnails...');
var names = Object.keys(previews);
for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var canvas = previews[name]();
    var outPath = path.join(vizDir, name, 'preview.png');
    savePNG(canvas, outPath);
}

console.log('\nDone! Generated ' + (4 + names.length) + ' PNG files.');
