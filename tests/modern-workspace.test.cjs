const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBusiness}=require('../lib/business.cjs');
const {executeOperation,adapter}=require('../lib/operations');
const {transformSync}=require('../client/node_modules/esbuild');
const Module=require('node:module'),path=require('node:path'),fs=require('node:fs');
function dashboard(){const filename=path.resolve(__dirname,'../client/src/dashboardModel.js');const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{format:'cjs'}).code,filename);return mod.exports;}
const id='12345678-1234-1234-1234-123456789012';

test('printer invoice keeps blank phone optional, defaults quantity to one and rejects fractional units',async()=>{
 const writes=[];const service=createBusiness(async input=>{writes.push(input);return [{id:1,...input.payload}];});
 const body={item_name:'Printer',quantity:'',unit_price:5500,customer_phone:'',counter:'',sold_at:'2026-10-21T12:00',request_id:id};
 const result=await service.request('/printer-sales',{method:'POST',body:JSON.stringify(body)});
 assert.equal(result.quantity,1);assert.equal(result.customer_phone,null);assert.equal(result.counter,null);assert.equal(writes[0].table,'printer_sales');
 assert.equal(result.serial_number,null);
 await assert.rejects(service.request('/printer-sales',{method:'POST',body:JSON.stringify({...body,quantity:1.5})}),/integer/);
});

test('printer accessories save in the same invoice, strip UI keys and validate every line',async()=>{
 let saved;
 const service=createBusiness(async input=>{saved=input;return [{id:1,...input.payload}];});
 const body={item_name:'Printer',quantity:1,unit_price:5500,request_id:id,extra_items:[{_key:'ui-key',item_name:'  A4 paper  ',quantity:2,unit_price:150},{item_name:'Cable',quantity:'',unit_price:0}]};
 const result=await service.request('/printer-sales',{method:'POST',body:JSON.stringify(body)});
 assert.equal(saved.table,'printer_sales');assert.deepEqual(result.extra_items,[{item_name:'A4 paper',quantity:2,unit_price:150},{item_name:'Cable',quantity:1,unit_price:0}]);
 const previous=saved;
 for(const invalid of [[{item_name:'',quantity:1,unit_price:2}],[{item_name:'Ink',quantity:-1,unit_price:2}],[{item_name:'Ink',quantity:1.5,unit_price:2}],[{item_name:'Ink',quantity:1,unit_price:''}],[{item_name:'Ink',quantity:1,unit_price:-1}],Array(51).fill({item_name:'Ink',quantity:1,unit_price:1}),{}]){
  await assert.rejects(service.request('/printer-sales',{method:'POST',body:JSON.stringify({...body,extra_items:invalid})}));
  assert.equal(saved,previous);
 }
});

test('editing a printer invoice updates the existing row and replaces accessories without duplicating it',async()=>{
 const invoice={id:7,item_name:'Printer',quantity:1,unit_price:5500,counter:null,customer_name:null,customer_phone:null,sold_at:'2026-10-21T09:25:56.000Z',created_at:'2026-10-21T09:26:00.000Z',request_id:id,extra_items:[{item_name:'Paper',quantity:2,unit_price:150},{item_name:'Cable',quantity:1,unit_price:75}]};
 const originalDate=invoice.sold_at,writes=[];
 const service=createBusiness(async input=>{
  if(input.action==='select')return input.eq[0][1]===7?[{...invoice}]:[];
  writes.push(input);Object.assign(invoice,input.payload);return [{...invoice}];
 });
 const result=await service.request('/printer-sales/7',{method:'PUT',body:JSON.stringify({quantity:3,unit_price:5000,customer_phone:'',extra_items:[{_key:'draft',item_name:'Ink',quantity:2,unit_price:200}],request_id:'must-not-change'})});
 assert.equal(result.id,7);assert.equal(result.quantity,3);assert.equal(result.unit_price,5000);assert.equal(result.customer_phone,null);assert.equal(result.request_id,id);assert.equal(result.sold_at,originalDate);
 assert.deepEqual(result.extra_items,[{item_name:'Ink',quantity:2,unit_price:200}]);assert.equal(writes.length,1);assert.equal(writes[0].action,'update');assert.deepEqual(writes[0].eq,[['id',7]]);
 await service.request('/printer-sales/7',{method:'PUT',body:JSON.stringify({extra_items:[]})});
 assert.deepEqual(invoice.extra_items,[]);assert.equal(invoice.quantity,3);
 await assert.rejects(service.request('/printer-sales/7',{method:'PUT',body:JSON.stringify({quantity:-1})}));
 assert.equal(writes.length,2);
 await assert.rejects(service.request('/printer-sales/999',{method:'PUT',body:'{}'}),error=>error.status===404);
 assert.equal(writes.length,2);
});

test('printer serial is optional, preserves leading zeros, survives partial edits and can be cleared',async()=>{
 let invoice;
 const service=createBusiness(async input=>{
  if(input.action==='select')return invoice?[{...invoice}]:[];
  if(input.action==='insert')invoice={id:3,...input.payload};
  else Object.assign(invoice,input.payload);
  return [{...invoice}];
 });
 await service.request('/printer-sales',{method:'POST',body:JSON.stringify({item_name:'HP',quantity:1,unit_price:4500,counter:0,serial_number:'  00HP-001  ',request_id:id})});
 assert.equal(invoice.serial_number,'00HP-001');assert.equal(invoice.counter,0);
 await service.request('/printer-sales/3',{method:'PUT',body:JSON.stringify({unit_price:4600})});
 assert.equal(invoice.serial_number,'00HP-001');assert.equal(invoice.counter,0);
 await service.request('/printer-sales/3',{method:'PUT',body:JSON.stringify({serial_number:'   ',counter:''})});
 assert.equal(invoice.serial_number,null);assert.equal(invoice.counter,null);
});

test('stock adjustment replaces quantity and empty minimum remains automatic',async()=>{
 const component={id:1,item_name:'Sensor',stock_qty:10,minimum_stock_qty:4};const ledger=[];
 const service=createBusiness(async input=>{
  if(input.action==='select')return input.table==='components'?[{...component}]:[];
  if(input.table==='components')Object.assign(component,input.payload);
  if(input.table==='inventory_ledger')ledger.push(input.payload);
  return [{...component}];
 });
 await service.request('/components/1',{method:'PUT',body:JSON.stringify({stock_qty:6,minimum_stock_qty:''})});
 assert.equal(component.stock_qty,6);assert.equal(component.minimum_stock_qty,null);assert.equal(ledger[0].delta_qty,-4);
});

test('unpriced BOM costs zero, manufacturing is included and stock is decremented once',async()=>{
 const stock={id:1,product_id:1,stock_qty:2},sales=[],ledger=[];
 const service=createBusiness(async input=>{
  if(input.action==='select'){
   if(input.table==='products')return [{id:1,name:'Pump'}];
   if(input.table==='finished_stock')return [{...stock}];
   if(input.table==='components')return [{id:1,item_name:'Part',stock_qty:10}];
   if(input.table==='bom_items')return [{id:1,product_id:1,component_id:1,qty_per_unit:3}];
   return [];
  }
  if(input.table==='sales_records'){const row={id:1,...input.payload};sales.push(row);return [row];}
  if(input.table==='finished_stock')Object.assign(stock,input.payload);
  if(input.table==='inventory_ledger')ledger.push(input.payload);
  return [input.payload];
 });
 const result=await service.request('/sales-records',{method:'POST',body:JSON.stringify({product_id:1,units_sold:1,unit_sell_price_egp:5500,manufacturing_cost_per_unit:1000})});
 assert.equal(result.total_purchase_cost_egp,1000);assert.equal(result.gross_profit_egp,4500);assert.equal(stock.stock_qty,1);assert.equal(ledger.length,1);
 await assert.rejects(service.request('/sales-records',{method:'POST',body:JSON.stringify({product_id:1,units_sold:2,unit_sell_price_egp:5500})}),/Insufficient/);
 assert.equal(sales.length,1);
});

function fakePool(query){const calls=[];return {calls,async connect(){return {async query(sql,params){calls.push(sql);return await query(sql,params)||{rows:[],fields:[]};},release(){calls.push('RELEASE');}};}};}
test('failed business operation rolls back and never commits or stores a retry result',async()=>{
 const pool=fakePool(sql=>{
  if(sql.startsWith('SELECT * FROM "products"'))return {rows:[{id:1,name:'Pump'}],fields:[]};
 });
 await assert.rejects(executeOperation('',{id:1},{method:'POST',path:'/sales-records',request_id:id,body:{product_id:1,units_sold:1,unit_sell_price_egp:5500}},pool),/Insufficient/);
 assert.ok(pool.calls.includes('ROLLBACK'));assert.ok(pool.calls.includes('RELEASE'));assert.ok(!pool.calls.includes('COMMIT'));assert.ok(!pool.calls.some(q=>q.startsWith('INSERT INTO app_operation_requests')));
});
test('retry of the same operation returns saved result without running business writes',async()=>{
 const crypto=require('node:crypto'),body={product_id:1,units_sold:1},method='POST',route='/sales-records';
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({method,path:route,body})).digest('hex');
 const pool=fakePool(sql=>sql.startsWith('SELECT result')?{rows:[{result:{id:44},fingerprint}],fields:[]}:undefined);
 const result=await executeOperation('',{id:1},{method,path:route,body,request_id:id},pool);
 assert.equal(result.id,44);assert.ok(pool.calls.includes('SELECT pg_advisory_xact_lock(781353)'));assert.ok(pool.calls.includes('COMMIT'));assert.ok(!pool.calls.some(q=>q.includes('"sales_records"')));
});
test('reusing operation ID with a different payload is rejected',async()=>{
 const pool=fakePool(sql=>sql.startsWith('SELECT result')?{rows:[{result:{id:44},fingerprint:'different'}],fields:[]}:undefined);
 await assert.rejects(executeOperation('',{id:1},{method:'POST',path:'/sales-records',body:{},request_id:id},pool),/already used/);
 assert.ok(pool.calls.includes('ROLLBACK'));
});
test('read-only operations use a consistent snapshot and always release their connection',async()=>{
 const pool=fakePool(()=>undefined);
 assert.deepEqual(await executeOperation('',{id:1},{method:'GET',path:'/printer-sales'},pool),[]);
 assert.equal(pool.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.ok(pool.calls.includes('COMMIT'));assert.ok(pool.calls.includes('RELEASE'));
});
test('database adapter binds filter and update values correctly and rejects account tables',async()=>{
 let sql,params;const db=adapter({query:async(q,p)=>{sql=q;params=p;return {rows:[],fields:[]};}});
 await db({action:'update',table:'components',eq:[['id',4]],payload:{stock_qty:6}});
 assert.match(sql,/"stock_qty" = \$2 WHERE "id" = \$1/);assert.deepEqual(params,[4,6]);
 await assert.rejects(db({action:'select',table:'app_users'}),/not allowed/);
 const extra_items=[{item_name:'Paper',quantity:2,unit_price:150}];
 await db({action:'insert',table:'printer_sales',payload:{item_name:'Printer',extra_items}});
 assert.equal(params[1],JSON.stringify(extra_items));assert.match(sql,/ON CONFLICT\(request_id\)/);
 await db({action:'insert',table:'spare_sales',payload:{items:[{component_id:1,quantity:2,unit_price:50}]}});
 assert.equal(params[0],JSON.stringify([{component_id:1,quantity:2,unit_price:50}]));
});
test('dashboard periods respect Cairo, delivered repairs, revenue vs profit and all-time dues',()=>{
 const {DateTime}=require('../client/node_modules/luxon');const {dashboardModel}=dashboard();
 const data={sales:[{units_sold:2,revenue_egp:11000,gross_profit_egp:4000,is_accounted:false,manufacturing_cost_per_unit:800,sold_at:'2026-10-20T22:00:00Z'},{units_sold:1,revenue_egp:5500,gross_profit_egp:1000,is_accounted:false,manufacturing_cost_per_unit:1000,sold_at:'2026-10-01T10:00:00Z'}],printers:[{quantity:1,unit_price:5000,extra_items:[{item_name:'Paper',quantity:2,unit_price:150}],sold_at:'2026-10-21T09:00:00Z'}],maintenance:[{delivered:true,repair_charge_egp:600,delivered_at:'2026-10-21T10:00:00Z'},{status:'completed',delivered:false,repair_charge_egp:900,completed_at:'2026-10-21T10:00:00Z'}],manufacturing:[],products:[]};
 const result=dashboardModel(data,'today','','',DateTime.fromISO('2026-10-21T12:00:00Z'));
 assert.equal(result.revenue,16900);assert.equal(result.printerRevenue,5300);assert.equal(result.buckets[0].printers,5300);assert.equal(result.profit,4000);assert.equal(result.unpaidAmount,2600);assert.equal(result.unpaidUnits,3);assert.equal(result.ready.length,1);assert.equal(result.units,2);
});
