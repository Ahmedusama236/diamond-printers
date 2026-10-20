const path=require('node:path');
require('../client/node_modules/esbuild').buildSync({
  entryPoints:[path.resolve(__dirname,'../client/src/business.js')],
  outfile:path.resolve(__dirname,'../lib/business.cjs'),
  bundle:true,platform:'node',format:'cjs',target:'node20',minify:true,
  define:{'import.meta.env':'{}'},
});
