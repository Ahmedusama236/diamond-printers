const path=require('node:path');
require('../client/node_modules/esbuild').buildSync({
 entryPoints:[path.resolve(__dirname,'../tests/fixtures/serial-browser-test.jsx')],
 outfile:path.resolve(__dirname,'../artifacts/serial-browser-test.js'),
 bundle:true,platform:'browser',format:'esm',target:'es2020',jsx:'automatic',
 nodePaths:[path.resolve(__dirname,'../client/node_modules')],external:['/diamond-logo.png'],
 define:{'process.env.NODE_ENV':'"production"'},
});
