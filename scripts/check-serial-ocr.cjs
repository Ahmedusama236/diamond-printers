// Actual OCR smoke check on a locally generated test image, not a production photo.
const path=require('node:path'),fs=require('node:fs'),Module=require('node:module'),assert=require('node:assert/strict');
const {createWorker}=require('../client/node_modules/tesseract.js');
const {transformSync}=require('../client/node_modules/esbuild');
const filename=path.resolve(__dirname,'../client/src/serialRecognition.js');
const mod=new Module(filename,module);mod.filename=filename;mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{format:'cjs'}).code,filename);
(async()=>{
 const worker=await createWorker('eng',1,{langPath:path.resolve(__dirname,'../client/dist/ocr/lang'),cacheMethod:'none'});
 try{
  const image=process.argv[2]||path.resolve(__dirname,'../artifacts/serial-report-test.png');
  const {data}=await worker.recognize(image);
  const found=mod.exports.extractSerialCandidates(data.text);
  assert.equal(found[0],'CN53RBC1HM');
  console.log('Actual OCR passed: detected the labeled serial CN53RBC1HM, not product number or PIN.');
 }finally{await worker.terminate();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
