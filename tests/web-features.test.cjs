const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const {hashPassword,verifyPassword,currentUser,setCookie} = require('../lib/auth');

function handlerWithDatabase(file, sql) {
  if(!sql.transaction)sql.transaction=async queries=>Promise.all(queries);
  const original = Module._load;
  Module._load = function(name,...args) {
    if(name==='@neondatabase/serverless') return {neon:()=>sql};
    return original.call(this,name,...args);
  };
  try { delete require.cache[require.resolve(file)]; return require(file); }
  finally {Module._load=original;}
}
function response() {return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
function loadClientModule(name) {
  const filename=path.resolve(__dirname,'../client/src',name);
  const {transformSync}=require('../client/node_modules/esbuild');
  const transformed=transformSync(fs.readFileSync(filename,'utf8'),{format:'cjs'}).code;
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod._compile(transformed,filename);return mod.exports;
}

test('password hashes use unique salts and reject incorrect passwords', async()=>{
  const a=await hashPassword('example-password'),b=await hashPassword('example-password');
  assert.notEqual(a,b); assert.equal(await verifyPassword('example-password',a),true);
  assert.equal(await verifyPassword('wrong',a),false);
  await assert.rejects(hashPassword('short'));
});
test('session cookie is HttpOnly, Strict and Secure on HTTPS',()=>{
  const res=response();setCookie(res,'test',{headers:{'x-forwarded-proto':'https'}});
  assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);
  assert.match(res.headers['Set-Cookie'],/; Secure/);
});
test('missing session does not authenticate',async()=>{
  assert.equal(await currentUser({query(){throw new Error('Should not query');}},{headers:{}}),null);
});
test('session lookup enforces expiry and active accounts',async()=>{
  let statement,params;
  const user=await currentUser({query:async(q,p)=>{statement=q;params=p;return [{id:1,role:'user'}];}},{headers:{cookie:'diamond_session=secret'}});
  assert.equal(user.id,1);assert.match(statement,/expires_at>now\(\)/);assert.match(statement,/u.active=true/);
  assert.notEqual(params[0],'secret');assert.equal(params[0].length,64);
});
test('data API rejects missing server session regardless of client flags',async()=>{
  process.env.DATABASE_URL='postgres://test';
  const handler=handlerWithDatabase('../api/data',{query:async()=>[]});
  const res=response();await handler({method:'POST',headers:{},body:{action:'select',table:'components'}},res);
  assert.equal(res.code,401);
});
test('regular account cannot create accounts',async()=>{
  const handler=handlerWithDatabase('../api/auth',{query:async(q)=>q.includes('JOIN app_users')?[{id:1,role:'user'}]:[]});
  const res=response();await handler({method:'POST',headers:{cookie:'diamond_session=x'},body:{action:'create',username:'another'}},res);
  assert.equal(res.code,403);
});
test('data API disallows querying account credential tables',async()=>{
  const handler=handlerWithDatabase('../api/data',{query:async(q)=>q.includes('JOIN app_users')?[{id:1,role:'admin'}]:[]});
  const res=response();await handler({method:'POST',headers:{cookie:'diamond_session=x'},body:{action:'select',table:'app_users'}},res);
  assert.equal(res.code,400);assert.match(res.body.error,/not allowed/);
});
test('legacy generic writes require a refreshed client instead of bypassing atomic operations',async()=>{
  let inserted='',values=[];
  const sql={query:async(q,p,options)=>{
    if(q.includes('JOIN app_users'))return [{id:1,role:'user'}];
    if(options?.fullResults){inserted=q;values=p;return {rows:[{id:10}],fields:[]};}
    return [];
  }};
  const handler=handlerWithDatabase('../api/data',sql);
  const req={method:'POST',headers:{cookie:'diamond_session=x'},body:{action:'insert',table:'printer_sales',payload:{item_name:'Printer',quantity:2,unit_price:100,counter:null,customer_phone:'01000000000',customer_name:null,sold_at:'2026-10-21T10:00:00Z',request_id:'12345678-1234-1234-1234-123456789012'}}};
  const res=response();await handler(req,res);assert.equal(res.code,409);
  assert.equal(inserted,'');
});
test('Cairo date range includes the entire last day across UTC boundary',()=>{
  const {filterPrinterSales}=loadClientModule('printerInvoices.js');
  const rows=[{id:1,sold_at:'2026-10-21T20:59:59Z',item_name:'Printer'},
    {id:2,sold_at:'2026-10-21T21:00:00Z',item_name:'Printer'}];
  assert.deepEqual(filterPrinterSales(rows,{from:'2026-10-21',to:'2026-10-21',q:''}).map(r=>r.id),[1]);
});
test('new invoices initialize optional fields blank, current Cairo seconds and unique request IDs',()=>{
  const {newPrinterInvoice}=loadClientModule('printerInvoices.js');
  const {DateTime}=require('../client/node_modules/luxon');
  const invoice=newPrinterInvoice();
  assert.equal(invoice.customer_name,'');assert.equal(invoice.counter,'');assert.equal(invoice.quantity,1);
  assert.match(invoice.sold_at,/T\d{2}:\d{2}:\d{2}$/);
  assert.ok(Math.abs(DateTime.fromISO(invoice.sold_at,{zone:'Africa/Cairo'}).toMillis()-Date.now())<2000);
  assert.notEqual(invoice.request_id,newPrinterInvoice().request_id);
});
test('routes preserve manufacturing, maintenance, printer and settings subsections',()=>{
  const {tabForLocation}=loadClientModule('navigation.js');
  assert.equal(tabForLocation('/manufacturing/completed'),'manufacturing');
  assert.equal(tabForLocation('/maintenance/in-progress'),'maintenance');
  assert.equal(tabForLocation('/printers/sales'),'printers');
  assert.equal(tabForLocation('/components/inventory'),'inventory');
  assert.equal(tabForLocation('/settings/accounts'),'settings');
  assert.equal(tabForLocation('/sales?payment=unpaid'),'sales');
});
test('Vercel SPA rewrite leaves API and asset URLs intact',()=>{
  const config=require('../vercel.json');const rule=new RegExp(`^${config.rewrites[0].source}$`);
  assert.equal(rule.test('/printers/sales'),true);assert.equal(rule.test('/manufacturing/orders'),true);
  assert.equal(rule.test('/api/data'),false);assert.equal(rule.test('/assets/index.js'),false);
  assert.equal(rule.test('/diamond-logo.png'),false);
});
test('last active administrator cannot be disabled',async()=>{
  const sql={query:async(q)=>q.includes('JOIN app_users')?[{id:1,role:'admin'}]:[],transaction:async()=>[[],[]]};
  const handler=handlerWithDatabase('../api/auth',sql);const res=response();
  await handler({method:'POST',headers:{cookie:'diamond_session=x'},body:{action:'update',id:1,username:'admin',role:'user',active:false}},res);
  assert.equal(res.code,400);assert.match(res.body.error,/آخر مدير/);
});
test('parallel initialization shares one locked migration and persists a version marker',async()=>{
  const {runMigration}=require('../lib/migrations');
  let calls=0;const statements=[];
  const sql={query:q=>{statements.push(q);return q;},transaction:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));}};
  await Promise.all(Array.from({length:15},()=>runMigration(sql,'parallel_test_v1',['CREATE TABLE IF NOT EXISTS example(id integer)'])));
  assert.equal(calls,1);
  assert.match(statements[0],/pg_advisory_xact_lock/);
  assert.match(statements.join('\n'),/IF NOT EXISTS \(SELECT 1 FROM app_schema_migrations/);
  await runMigration(sql,'parallel_test_v1',[]);assert.equal(calls,1);
});
test('failed schema initialization can be retried instead of caching failure',async()=>{
  const {runMigration}=require('../lib/migrations');let calls=0;
  const sql={query:q=>q,transaction:async()=>{calls++;if(calls===1)throw new Error('temporary failure');}};
  await assert.rejects(runMigration(sql,'retry_test_v1',[]));
  await runMigration(sql,'retry_test_v1',[]);assert.equal(calls,2);
});
