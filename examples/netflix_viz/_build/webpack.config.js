var path = require('path');
var fs = require('fs');

var VIZ_BASE = path.resolve(__dirname, '../appserver/static/visualizations');
var SHARED = path.resolve(__dirname, '../shared');

var vizDirs = fs.readdirSync(VIZ_BASE).filter(function(d) {
    return fs.existsSync(path.join(VIZ_BASE, d, 'src', 'visualization_source.js'));
});

var entry = {};
vizDirs.forEach(function(name) {
    entry[name] = path.join(VIZ_BASE, name, 'src', 'visualization_source.js');
});

module.exports = {
    target: ['web', 'es5'],
    entry: entry,
    output: {
        filename: function(pathData) {
            return path.join('..', 'appserver', 'static', 'visualizations',
                pathData.chunk.name, 'visualization.js');
        },
        path: path.resolve(__dirname),
        libraryTarget: 'amd',
        environment: {
            arrowFunction: false,
            bigIntLiteral: false,
            const: false,
            destructuring: false,
            forOf: false,
            dynamicImport: false,
            module: false
        }
    },
    resolve: {
        alias: {
            'shared/theme': SHARED + '/theme.js',
            '../../shared/theme': SHARED + '/theme.js'
        }
    },
    externals: [
        'api/SplunkVisualizationBase'
    ]
};
