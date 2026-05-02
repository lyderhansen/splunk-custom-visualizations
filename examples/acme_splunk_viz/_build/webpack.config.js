var path = require('path');
var fs = require('fs');

// Multi-entry build — one bundle per visualization.
// Each viz lives at ../appserver/static/visualizations/<name>/ and has
// src/visualization_source.js as its entry. The output visualization.js
// is written next to its src/ folder so Splunk picks it up directly.

var VIZ_ROOT = path.resolve(__dirname, '..', 'appserver', 'static', 'visualizations');

var vizNames = fs.readdirSync(VIZ_ROOT).filter(function (n) {
    var p = path.join(VIZ_ROOT, n);
    return fs.statSync(p).isDirectory() &&
           fs.existsSync(path.join(p, 'src', 'visualization_source.js'));
});

var entries = {};
vizNames.forEach(function (name) {
    entries[name] = path.join(VIZ_ROOT, name, 'src', 'visualization_source.js');
});

module.exports = {
    entry: entries,
    output: {
        filename: '[name]/visualization.js',
        path: VIZ_ROOT,
        libraryTarget: 'amd'
    },
    externals: [
        'api/SplunkVisualizationBase',
        'api/SplunkVisualizationUtils'
    ],
    resolve: {
        modules: [path.resolve(__dirname, 'node_modules')]
    }
};
