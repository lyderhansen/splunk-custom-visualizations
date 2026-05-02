/*
 * SUPER CO Design System — Theme Tokens
 * Shared across all visualizations in the super_co_viz app.
 */

function hexToRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return { r: r, g: g, b: b };
}

function lerpColor(a, b, t) {
    var ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
    var br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
    var r = Math.round(ar + (br - ar) * t);
    var g = Math.round(ag + (bg - ag) * t);
    var bl = Math.round(ab + (bb - ab) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

function rgba(hex, alpha) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
}

function getTheme(name) {
    var dark = name === 'dark';
    return {
        bg:         dark ? '#171d27' : '#f4f6f9',
        panel:      dark ? '#1f2734' : '#ffffff',
        panelHi:    dark ? '#2a3342' : '#f7f9fc',
        edge:       dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,30,55,0.10)',
        edgeStrong: dark ? 'rgba(255,255,255,0.18)' : 'rgba(15,30,55,0.22)',
        grid:       dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,30,55,0.06)',
        text:       dark ? '#e5eaf2' : '#171d27',
        textDim:    dark ? 'rgba(229,234,242,0.66)' : 'rgba(23,29,39,0.64)',
        textFaint:  dark ? 'rgba(229,234,242,0.42)' : 'rgba(23,29,39,0.42)',
        s1:         dark ? '#1a91a8' : '#006d75',
        s2:         dark ? '#2bbfb8' : '#0a8f88',
        s3:         dark ? '#5ce1e6' : '#2bbfb8',
        s4:         dark ? '#7eb1ff' : '#3b76e0',
        s5:         dark ? '#a78bfa' : '#7c5cd1',
        orange:     dark ? '#ff6600' : '#e85d04',
        pink:       dark ? '#f73873' : '#d92465',
        success:    '#118832',
        warn:       dark ? '#cba700' : '#a87a00',
        danger:     '#d41f1f'
    };
}

var SERIES_KEYS = ['s1', 's2', 's3', 's4', 's5'];

module.exports = {
    getTheme: getTheme,
    hexToRgb: hexToRgb,
    lerpColor: lerpColor,
    rgba: rgba,
    SERIES_KEYS: SERIES_KEYS,
    fonts: {
        primary: '"Inter", sans-serif',
        mono: '"IBM Plex Mono", monospace'
    }
};
