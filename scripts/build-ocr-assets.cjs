// Self-host the OCR worker, WASM engines and English model; no photo upload/CDN.
const fs=require('node:fs'),path=require('node:path');
const client=path.resolve(__dirname,'../client');
const target=path.join(client,process.argv.includes('--dev')?'public':'dist','ocr');
fs.mkdirSync(path.join(target,'core'),{recursive:true});
fs.mkdirSync(path.join(target,'lang'),{recursive:true});
fs.copyFileSync(path.join(client,'node_modules/tesseract.js/dist/worker.min.js'),path.join(target,'worker.min.js'));
const core=path.join(client,'node_modules/tesseract.js-core');
for(const name of fs.readdirSync(core))if(/\.wasm(?:\.js)?$/.test(name))fs.copyFileSync(path.join(core,name),path.join(target,'core',name));
fs.copyFileSync(path.join(client,'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),path.join(target,'lang/eng.traineddata.gz'));
for(const [directory,name] of [['tesseract.js','LICENSE'],['tesseract.js-core','LICENSE']]){
 const file=path.join(client,'node_modules',directory,name);
 if(fs.existsSync(file))fs.copyFileSync(file,path.join(target,directory+'-LICENSE'));
}
