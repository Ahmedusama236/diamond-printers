const {test}=require('node:test'),assert=require('node:assert/strict');
const {createBusiness}=require('../lib/business.cjs');
function database(seed={}){
 let data=structuredClone({products:[{id:1,name:'Pump'}],components:[{id:1,item_name:'Part',stock_qty:10}],bom_items:[{id:1,product_id:1,component_id:1,qty_per_unit:1}],finished_stock:[{id:1,product_id:1,stock_qty:10}],component_price_history:[],printer_sales:[],sales_records:[],maintenance_tickets:[],maintenance_parts:[],inventory_ledger:[],sales_invoice_meta:[],sales_payments:[],sales_returns:[],sales_events:[],...seed});
 async function adapter(input){const rows=data[input.table]||[];data[input.table]=rows;let found=rows.filter(row=>(input.eq||[]).every(([k,v])=>row[k]===v));
  if(input.action==='select'){found=structuredClone(found);if(input.order)found.sort((a,b)=>{for(const [k,asc]of input.order){if(a[k]!==b[k])return(a[k]>b[k]?1:-1)*(asc?1:-1);}return 0;});return input.limit?found.slice(0,input.limit):found;}
  if(input.action==='insert'){const row={id:Math.max(0,...rows.map(r=>r.id||0))+1,created_at:new Date().toISOString(),...structuredClone(input.payload)};rows.push(row);return [structuredClone(row)];}
  if(input.action==='update'){found.forEach(r=>Object.assign(r,structuredClone(input.payload)));return structuredClone(found);}
  throw new Error('Unexpected mutation');
 }
 return {get data(){return data;},async request(path,method='GET',body={}){const snapshot=structuredClone(data);try{return await createBusiness(adapter,{actor:'tester'}).request(path,{method,body:JSON.stringify(body)});}catch(e){data=snapshot;throw e;}}};
}
const printer=(extra={})=>({item_name:'HP',unit_price:5000,quantity:1,request_id:crypto.randomUUID(),sold_at:'2026-10-20T10:00:00Z',...extra});
test('legacy invoices are unified once, retain optional fields and never invent receipts',async()=>{
 const db=database({printer_sales:[{id:1,...printer({serial_number:'CN53RBC1HM',extra_items:[{item_name:'Paper',quantity:2,unit_price:100}]})}],sales_records:[{id:1,product_id:1,units_sold:2,unit_sell_price_egp:100,revenue_egp:200,sold_at:'2026-10-20T10:00:00Z'}],maintenance_tickets:[{id:1,status:'in_progress',repair_charge_egp:500,opened_at:'2026-10-20T10:00:00Z'},{id:2,status:'completed',customer_name:'Repair client',repair_charge_egp:600,completed_at:'2026-10-20T10:00:00Z'}]});
 const rows=await db.request('/sales-hub');assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.key)).size,3);assert.equal(rows.find(r=>r.kind==='printer').net,5200);assert.ok(rows.every(r=>r.paid===null&&r.balance===null&&r.payment_state==='unknown'));assert.equal(db.data.sales_payments.length,0);
});
test('new invoice and initial collection commit together and insufficient customer data rolls back',async()=>{
 const db=database();await assert.rejects(db.request('/printer-sales','POST',printer({payment_amount:1000,payment_method:'cash'})),/اسم العميل/);assert.equal(db.data.printer_sales.length,0);assert.equal(db.data.sales_invoice_meta.length,0);
 const result=await db.request('/printer-sales','POST',printer({payment_amount:1000,payment_method:'cash',customer_name:'Client'}));const [row]=await db.request('/sales-hub');assert.equal(result.id,1);assert.equal(row.paid,1000);assert.equal(row.balance,4000);assert.equal(row.payment_state,'partial');assert.equal(db.data.sales_events.length,2);
});
test('collections reject overpayment, stale revisions and future dates without partial writes',async()=>{
 const db=database();await db.request('/printer-sales','POST',printer({payment_amount:0,payment_method:'cash',customer_name:'Client'}));
 const path='/sales-hub/printer/1/payment';const body={revision:1,amount:2000,method:'transfer',paid_at:'2026-10-20T10:00:00Z'};
 let row=await db.request(path,'POST',body);assert.equal(row.balance,3000);assert.equal(row.meta.revision,2);
 await assert.rejects(db.request(path,'POST',body),/اتغيّرت/);
 await assert.rejects(db.request(path,'POST',{...body,revision:2,amount:3000.01}),/أكبر/);
 await assert.rejects(db.request(path,'POST',{...body,revision:2,paid_at:'2099-01-01T00:00:00Z'}),/المستقبل/);
 assert.equal(db.data.sales_payments.length,1);row=await db.request(path,'POST',{...body,revision:2,amount:3000});assert.equal(row.payment_state,'paid');
});
test('product partial return then cancellation restores only remaining stock and requires separate refund',async()=>{
 const db=database();await db.request('/sales-records','POST',{product_id:1,units_sold:3,unit_sell_price_egp:5500,manufacturing_cost_per_unit:1000,payment_amount:16500,payment_method:'cash'});
 assert.equal(db.data.finished_stock[0].stock_qty,7);assert.equal(db.data.sales_records[0].cost_complete,false);
 let row=await db.request('/sales-hub/product/1/return','POST',{revision:1,line_index:0,quantity:1,reason:'Returned one'});
 assert.equal(row.net,11000);assert.equal(row.balance,-5500);assert.equal(row.state,'partial_return');assert.equal(db.data.finished_stock[0].stock_qty,8);
 await assert.rejects(db.request('/sales-hub/product/1/return','POST',{revision:2,line_index:0,quantity:3,reason:'Too many'}),/كمية/);assert.equal(db.data.finished_stock[0].stock_qty,8);
 row=await db.request('/sales-hub/product/1/cancel','POST',{revision:2,reason:'Cancelled remainder'});assert.equal(row.net,0);assert.equal(row.balance,-16500);assert.equal(db.data.finished_stock[0].stock_qty,10);
 await assert.rejects(db.request('/sales-hub/product/1/cancel','POST',{revision:3,reason:'Again'}),/بالفعل/);assert.equal(db.data.finished_stock[0].stock_qty,10);
 row=await db.request('/sales-hub/product/1/payment','POST',{revision:3,direction:'refund',amount:16500,method:'cash'});assert.equal(row.balance,0);assert.equal(row.paid,0);assert.equal(db.data.inventory_ledger.length,3);assert.ok(db.data.inventory_ledger.every(r=>r.item_type==='finished'));
});
test('printer accessories return independently, money rounds and main serial stays sold',async()=>{
 const db=database();await db.request('/printer-sales','POST',printer({serial_number:'CN53RBC1HM',extra_items:[{item_name:'Paper',quantity:3,unit_price:0.1}],payment_amount:5000.3,payment_method:'card'}));
 const row=await db.request('/sales-hub/printer/1/return','POST',{revision:1,line_index:1,quantity:3,reason:'Paper returned'});assert.equal(row.net,5000);assert.equal(row.balance,-0.3);assert.equal(row.state,'partial_return');assert.equal(row.lines[0].returned,0);
 await assert.rejects(db.request('/printer-sales','POST',printer({serial_number:'cn53rbc1hm'})),/P-1/);assert.equal(db.data.printer_sales.length,1);
});
test('review requires customer for debt, blocks second baseline and writes named audit events',async()=>{
 const db=database({printer_sales:[{id:1,...printer()}]});
 await assert.rejects(db.request('/sales-hub/printer/1/review','POST',{revision:0,amount:0,method:'cash'}),/اسم العميل/);
 let row=await db.request('/sales-hub/printer/1/review','POST',{revision:0,amount:1000,method:'cash',customer_name:'Client'});assert.equal(row.balance,4000);assert.equal(row.customer_name,'Client');
 await assert.rejects(db.request('/sales-hub/printer/1/review','POST',{revision:1,amount:5000,method:'cash'}),/بالفعل/);assert.equal(db.data.sales_payments.length,1);assert.equal(db.data.sales_events[0].actor,'tester');
});
test('edits retain payments, record before and after, reject stale forms and cannot mutate returned invoices',async()=>{
 const db=database();await db.request('/printer-sales','POST',printer({payment_amount:5000,payment_method:'cash'}));
 await db.request('/printer-sales/1','PUT',{invoice_revision:1,unit_price:4000});let [row]=await db.request('/sales-hub');assert.equal(row.balance,-1000);assert.equal(db.data.sales_payments.length,1);
 assert.equal(db.data.sales_events.at(-1).details.before.unit_price,5000);assert.equal(db.data.sales_events.at(-1).details.after.unit_price,4000);
 await assert.rejects(db.request('/printer-sales/1','PUT',{invoice_revision:1,unit_price:3000}),/اتغيّرت/);
 await db.request('/sales-hub/printer/1/return','POST',{revision:2,line_index:0,quantity:1,reason:'Return'});
 await assert.rejects(db.request('/printer-sales/1','PUT',{invoice_revision:3,unit_price:3000}),/مرتجع/);assert.equal(db.data.printer_sales[0].unit_price,4000);
 await assert.rejects(db.request('/sales-records/1','DELETE'),/إلغاء/);
});
test('maintenance cancellation retains consumed parts cost and completed records cannot be deleted',async()=>{
 const db=database({maintenance_tickets:[{id:1,status:'completed',customer_name:'Client',repair_charge_egp:1000,delivered:true,delivered_at:'2026-10-20T10:00:00Z',completed_at:'2026-10-20T10:00:00Z'}],maintenance_parts:[{id:1,ticket_id:1,component_id:1,total_price_egp:100}]});
 await db.request('/sales-hub/maintenance/1/review','POST',{revision:0,amount:1000,method:'cash'});
 const row=await db.request('/sales-hub/maintenance/1/cancel','POST',{revision:1,reason:'Service fee waived'});assert.equal(row.net,0);assert.equal(db.data.maintenance_parts.length,1);assert.equal(db.data.components[0].stock_qty,10);
 await assert.rejects(db.request('/maintenance-tickets/1','DELETE'),/إلغاء/);
 const report=await db.request('/reports/sales?period=date_range&start_date=2026-10-20&end_date=2026-10-20');assert.equal(report.summary.maintenance_revenue_egp,0);assert.equal(report.summary.maintenance_profit_egp,-100);
});
test('money and quantity validation rejects empty, non-finite, negative and fractional values',async()=>{
 const db=database();for(const unit_price of ['',null,-1,'Infinity'])await assert.rejects(db.request('/printer-sales','POST',printer({unit_price})));
 for(const quantity of [-1,0,1.5])await assert.rejects(db.request('/printer-sales','POST',printer({quantity})));
 assert.equal(db.data.printer_sales.length,0);
});
test('sales filters share Cairo dates and totals separate unknown debt, refunds and recorded receipts',async()=>{
 const model=await import('../client/src/salesModel.js');const db=database({printer_sales:[{id:1,...printer({sold_at:'2026-10-20T22:30:00Z',serial_number:'CN53RBC1HM'})}]});
 let rows=await db.request('/sales-hub');assert.equal(model.filterInvoices(rows,{from:'2026-10-21',to:'2026-10-21',q:'cn53rbc1hm'}).length,1);assert.equal(model.salesTotals(rows).unknown,1);assert.equal(model.salesTotals(rows).due,0);
 await db.request('/sales-hub/printer/1/review','POST',{revision:0,amount:1000,method:'cash',customer_name:'Client'});rows=await db.request('/sales-hub');assert.equal(model.filterInvoices(rows,{payment:'due'}).length,1);assert.deepEqual(model.salesTotals(rows),{count:1,sales:5000,collected:1000,due:4000,refund:0,unknown:0});
});
test('reports and dashboard use net sales after product and printer returns',async()=>{
 const db=database();await db.request('/sales-records','POST',{product_id:1,units_sold:2,unit_sell_price_egp:5500,manufacturing_cost_per_unit:1000,sold_at:'2026-10-20T10:00:00Z',payment_amount:0,payment_method:'cash',customer_name:'Client'});
 await db.request('/sales-hub/product/1/return','POST',{revision:1,line_index:0,quantity:1,reason:'Return'});
 const report=await db.request('/reports/sales?period=date_range&start_date=2026-10-20&end_date=2026-10-20');assert.equal(report.summary.revenue_egp,5500);assert.equal(report.summary.purchase_cost_egp,1000);assert.equal(report.summary.unified_sales_egp,5500);
 const {dashboardModel}=await import('../client/src/dashboardModel.js');const {DateTime}=require('../client/node_modules/luxon');const data=await db.request('/dashboard');const m=dashboardModel(data,'custom','2026-10-20','2026-10-20',DateTime.fromISO('2026-10-20'));assert.equal(m.productRevenue,5500);assert.equal(m.units,1);
});
test('historical collections must be reviewed before financial corrections, and empty edits cannot bypass a return lock',async()=>{
 const db=database({printer_sales:[{id:1,...printer()}]});
 await assert.rejects(db.request('/sales-hub/printer/1/return','POST',{revision:0,line_index:0,quantity:1,reason:'Return'}),/راجع التحصيل/);
 await assert.rejects(db.request('/printer-sales/1','PUT',{invoice_revision:0,unit_price:4000}),/راجع التحصيل/);
 assert.equal(db.data.printer_sales[0].unit_price,5000);
 await db.request('/sales-hub/printer/1/review','POST',{revision:0,amount:5000,method:'cash'});
 const row=await db.request('/sales-hub/printer/1/cancel','POST',{revision:1,reason:'Cancelled'});assert.equal(row.balance,-5000);
 await assert.rejects(db.request('/printer-sales/1','PUT',{}),/ملغاة/);
});
test('maintenance type persists through editing/completion and legacy tickets stay unclassified',async()=>{
 const db=database({maintenance_tickets:[{id:10,status:'in_progress',customer_name:'Legacy',device_issue:'Old issue',opened_at:'2026-10-20T10:00:00Z',repair_charge_egp:0}]});
 for(const device_type of ['printer','device']){
  const ticket=await db.request('/maintenance-tickets','POST',{device_type,customer_name:'Client',phone:'',device_issue:'Test issue'});
  assert.equal(ticket.device_type,device_type);assert.equal(ticket.phone,null);
  const done=await db.request(`/maintenance-tickets/${ticket.id}`,'PUT',{status:'completed',repair_charge_egp:100,maintenance_description:'Repair done'});
  assert.equal(done.device_type,device_type);const invoice=await db.request(`/sales-hub/maintenance/${ticket.id}`);assert.equal(invoice.repair_type,device_type);
 }
 const old=(await db.request('/maintenance-tickets')).find(t=>t.id===10);assert.equal(old.device_type,undefined);
 await assert.rejects(db.request('/maintenance-tickets','POST',{device_type:'invalid',customer_name:'Client',device_issue:'Test'}),/اختر صيانة/);
 const changed=await db.request('/maintenance-tickets/10','PUT',{device_type:'device'});assert.equal(changed.device_type,'device');
});
test('multi-line spare invoice deducts component stock atomically, snapshots cost and records collection',async()=>{
 const db=database({components:[{id:1,item_name:'Cable',stock_qty:10},{id:2,item_name:'Sensor',stock_qty:4}],component_price_history:[{id:1,component_id:1,is_active:true,price_egp:30,effective_at:'2026-10-01T10:00:00Z'}]});
 const row=await db.request('/spare-sales','POST',{items:[{component_id:1,quantity:2,unit_price:50,unit_cost_egp:0,_key:'ignore'},{component_id:2,quantity:1,unit_price:100}],customer_name:'Client',payment_amount:50,payment_method:'cash',sold_at:'2026-10-20T10:00:00Z'});
 assert.equal(row.total_amount,200);assert.equal(row.items[0].unit_cost_egp,30);assert.equal(row.items[0]._key,undefined);assert.equal(row.items[1].cost_complete,false);assert.equal(db.data.components[0].stock_qty,8);assert.equal(db.data.components[1].stock_qty,3);
 const invoice=await db.request('/sales-hub/spare/1');assert.equal(invoice.number,'S-1');assert.equal(invoice.balance,150);assert.equal(invoice.lines.length,2);
 const report=await db.request('/reports/sales?period=date_range&start_date=2026-10-20&end_date=2026-10-20');assert.equal(report.summary.spare_revenue_egp,200);assert.equal(report.summary.spare_cost_egp,60);assert.equal(report.summary.spare_profit_egp,140);assert.equal(report.summary.unified_sales_egp,200);assert.equal(report.summary.spare_incomplete_cost_invoices,1);
});
test('spare edits replace quantity, preserve historical purchase cost and reject stale or excessive changes',async()=>{
 const db=database({component_price_history:[{id:1,component_id:1,is_active:true,price_egp:20,effective_at:'2026-10-01T10:00:00Z'}]});
 await db.request('/spare-sales','POST',{items:[{component_id:1,quantity:2,unit_price:50}],payment_amount:100,payment_method:'cash'});
 db.data.component_price_history[0].price_egp=99;
 const row=await db.request('/spare-sales/1','PUT',{invoice_revision:1,items:[{component_id:1,quantity:4,unit_price:25}]});assert.equal(row.items[0].quantity,4);assert.equal(row.items[0].unit_cost_egp,20);assert.equal(db.data.components[0].stock_qty,6);
 await assert.rejects(db.request('/spare-sales/1','PUT',{invoice_revision:1,items:[{component_id:1,quantity:1,unit_price:100}]}),/اتغيّرت/);
 await assert.rejects(db.request('/spare-sales/1','PUT',{invoice_revision:2,items:[{component_id:1,quantity:11,unit_price:100}]}),/غير كاف/);assert.equal(db.data.components[0].stock_qty,6);assert.equal(db.data.spare_sales[0].items[0].quantity,4);
});
test('spare partial return and cancellation restore each component exactly once and preserve refund credit',async()=>{
 const db=database({components:[{id:1,item_name:'Cable',stock_qty:10},{id:2,item_name:'Sensor',stock_qty:4}]});
 await db.request('/spare-sales','POST',{items:[{component_id:1,quantity:3,unit_price:50},{component_id:2,quantity:2,unit_price:100}],payment_amount:350,payment_method:'cash'});
 let row=await db.request('/sales-hub/spare/1/return','POST',{revision:1,line_index:1,quantity:1,reason:'One sensor returned'});assert.equal(row.net,250);assert.equal(row.balance,-100);assert.equal(db.data.components[1].stock_qty,3);
 row=await db.request('/sales-hub/spare/1/cancel','POST',{revision:2,reason:'Cancel remainder'});assert.equal(row.balance,-350);assert.equal(db.data.components[0].stock_qty,10);assert.equal(db.data.components[1].stock_qty,4);
 await assert.rejects(db.request('/sales-hub/spare/1/cancel','POST',{revision:3,reason:'Again'}),/بالفعل/);assert.equal(db.data.components[1].stock_qty,4);
 await assert.rejects(db.request('/spare-sales/1','PUT',{invoice_revision:3,items:[{component_id:1,quantity:1,unit_price:100}]}),/ملغاة/);
 const refunded=await db.request('/sales-hub/spare/1/payment','POST',{revision:3,direction:'refund',amount:350,method:'cash'});assert.equal(refunded.balance,0);
});
test('invalid spare lines, duplicate parts and payment failure leave inventory unchanged',async()=>{
 const db=database();for(const items of [[],[{component_id:1,quantity:1.5,unit_price:50}],[{component_id:1,quantity:11,unit_price:50}],[{component_id:999,quantity:1,unit_price:50}],[{component_id:1,quantity:1,unit_price:''}],[{component_id:1,quantity:1,unit_price:50},{component_id:1,quantity:1,unit_price:50}]])await assert.rejects(db.request('/spare-sales','POST',{items}));
 await assert.rejects(db.request('/spare-sales','POST',{items:[{component_id:1,quantity:2,unit_price:50}],payment_amount:0,payment_method:'cash'}),/اسم العميل/);
 assert.equal(db.data.components[0].stock_qty,10);assert.equal(db.data.spare_sales?.length||0,0);assert.equal(db.data.inventory_ledger.length,0);
});
test('spare invoices and repair subtypes filter independently and dashboard includes spare revenue',async()=>{
 const db=database();await db.request('/spare-sales','POST',{items:[{component_id:1,quantity:1,unit_price:50}],sold_at:'2026-10-20T10:00:00Z'});
 for(const device_type of ['printer','device']){const ticket=await db.request('/maintenance-tickets','POST',{device_type,customer_name:'Client',device_issue:'Repair'});await db.request(`/maintenance-tickets/${ticket.id}`,'PUT',{status:'completed',repair_charge_egp:100});}
 const {filterInvoices}=await import('../client/src/salesModel.js'),rows=await db.request('/sales-hub');assert.equal(filterInvoices(rows,{kind:'spare'}).length,1);assert.equal(filterInvoices(rows,{kind:'maintenance',repair_type:'printer'}).length,1);assert.equal(filterInvoices(rows,{kind:'maintenance',repair_type:'device'}).length,1);
 const {dashboardModel}=await import('../client/src/dashboardModel.js'),{DateTime}=require('../client/node_modules/luxon');const m=dashboardModel(await db.request('/dashboard'),'custom','2026-10-20','2026-10-20',DateTime.fromISO('2026-10-20'));assert.equal(m.spareRevenue,50);assert.equal(m.revenue,50);assert.equal(m.buckets[0].spares,50);
});
const buyShop=(db,extra={})=>db.request('/shop-purchases','POST',{item_name:'A4 paper',quantity:10,unit_price:30,sell_price:50,received_at:'2026-10-20T10:00:00Z',...extra});
test('shop purchases create independent stock that never appears in components or manufacturing BOM',async()=>{
 const db=database();const before=structuredClone(db.data.components);const purchase=await buyShop(db);
 assert.equal(purchase.shop_item_id,1);const [item]=await db.request('/shop-items');assert.equal(item.stock_qty,10);assert.equal(item.latest_price_egp,30);assert.equal(item.sell_price,50);
 assert.deepEqual(db.data.components,before);assert.equal((await db.request('/components')).some(i=>i.item_name==='A4 paper'),false);assert.equal((await db.request('/products/1/bom')).some(i=>i.item_name==='A4 paper'),false);
 assert.equal(db.data.shop_stock_ledger[0].actor,'tester');
});
test('shop buying adds stock, editing replaces receipt quantity and rejects reduction of consumed stock',async()=>{
 const db=database();await buyShop(db);await buyShop(db,{shop_item_id:1,quantity:5,unit_price:35,received_at:'2026-10-21T10:00:00Z'});assert.equal(db.data.shop_items[0].stock_qty,15);
 await db.request('/shop-purchases/1','PUT',{revision:0,quantity:8,unit_price:30,received_at:'2026-10-20T10:00:00Z'});assert.equal(db.data.shop_items[0].stock_qty,13);assert.equal((await db.request('/shop-items'))[0].latest_price_egp,35);
 await db.request('/spare-sales','POST',{items:[{shop_item_id:1,quantity:12,unit_price:50}],payment_amount:600,payment_method:'cash'});assert.equal(db.data.shop_items[0].stock_qty,1);
 await assert.rejects(db.request('/shop-purchases/1','PUT',{revision:1,quantity:1,unit_price:30}),/رصيد المحل/);assert.equal(db.data.shop_items[0].stock_qty,1);assert.equal(db.data.shop_purchases[0].quantity,8);
 await assert.rejects(db.request('/shop-purchases/1','PUT',{revision:0,quantity:8,unit_price:30}),/اتغيّرت/);
});
test('printer gifts force zero sale price, retain real shop cost and deduct stock with saved delivery',async()=>{
 const db=database();await buyShop(db);const row=await db.request('/printer-sales','POST',printer({delivery_method:'damietta',extra_items:[{shop_item_id:1,item_name:'A4 paper',quantity:2,unit_price:999,is_gift:true,unit_cost_egp:0}],payment_amount:5000,payment_method:'cash'}));
 assert.equal(row.extra_items[0].unit_price,0);assert.equal(row.extra_items[0].unit_cost_egp,30);assert.equal(row.extra_items[0].is_gift,true);assert.equal(db.data.shop_items[0].stock_qty,8);assert.equal(db.data.components[0].stock_qty,10);
 const invoice=await db.request('/sales-hub/printer/1');assert.equal(invoice.net,5000);assert.equal(invoice.lines[1].is_gift,true);assert.equal(invoice.delivery_method,'damietta');assert.equal(invoice.balance,0);
});
test('printer shop extras edit by replacement, reject overselling and preserve initial cost snapshot',async()=>{
 const db=database();await buyShop(db);await db.request('/printer-sales','POST',printer({extra_items:[{shop_item_id:1,item_name:'Paper',quantity:2,unit_price:50}],payment_amount:5100,payment_method:'cash'}));
 await db.request('/shop-purchases','POST',{shop_item_id:1,quantity:1,unit_price:100});
 const row=await db.request('/printer-sales/1','PUT',{invoice_revision:1,extra_items:[{shop_item_id:1,item_name:'Paper',quantity:4,unit_price:25}],delivery_method:'shipping'});assert.equal(db.data.shop_items[0].stock_qty,7);assert.equal(row.extra_items[0].unit_cost_egp,30);
 await assert.rejects(db.request('/printer-sales/1','PUT',{invoice_revision:2,extra_items:[{shop_item_id:1,item_name:'Paper',quantity:12,unit_price:25}]}),/رصيد المحل/);assert.equal(db.data.shop_items[0].stock_qty,7);assert.equal(db.data.printer_sales[0].extra_items[0].quantity,4);
});
test('returning a gifted printer accessory restores stock with no cash credit; cancellation restores the remainder once',async()=>{
 const db=database();await buyShop(db);await db.request('/printer-sales','POST',printer({extra_items:[{shop_item_id:1,item_name:'Paper',quantity:3,is_gift:true,unit_price:''}],payment_amount:5000,payment_method:'cash'}));
 let row=await db.request('/sales-hub/printer/1/return','POST',{revision:1,line_index:1,quantity:1,reason:'Gift returned'});assert.equal(row.balance,0);assert.equal(row.net,5000);assert.equal(row.returns[0].amount,0);assert.equal(db.data.shop_items[0].stock_qty,8);
 row=await db.request('/sales-hub/printer/1/cancel','POST',{revision:2,reason:'Cancel invoice'});assert.equal(db.data.shop_items[0].stock_qty,10);assert.equal(row.balance,-5000);
 await assert.rejects(db.request('/sales-hub/printer/1/cancel','POST',{revision:3,reason:'Again'}),/بالفعل/);assert.equal(db.data.shop_items[0].stock_qty,10);
});
test('standalone sales can mix shop gifts and component parts without confusing identical IDs',async()=>{
 const db=database();await buyShop(db);const row=await db.request('/spare-sales','POST',{delivery_method:'mansoura',items:[{shop_item_id:1,quantity:2,is_gift:true,unit_price:900},{component_id:1,quantity:3,unit_price:50}],payment_amount:150,payment_method:'cash'});
 assert.equal(row.total_amount,150);assert.equal(row.items[0].unit_price,0);assert.equal(db.data.shop_items[0].stock_qty,8);assert.equal(db.data.components[0].stock_qty,7);
 const returned=await db.request('/sales-hub/spare/1/return','POST',{revision:1,line_index:0,quantity:2,reason:'Shop gift return'});assert.equal(db.data.shop_items[0].stock_qty,10);assert.equal(db.data.components[0].stock_qty,7);assert.equal(returned.balance,0);
});
test('gift device has zero revenue but keeps manufacturing cost and stock movement',async()=>{
 const db=database();const row=await db.request('/sales-records','POST',{product_id:1,units_sold:1,unit_sell_price_egp:5500,is_gift:true,manufacturing_cost_per_unit:1000,payment_amount:0,payment_method:'cash',delivery_method:'shipping'});
 assert.equal(row.unit_sell_price_egp,0);assert.equal(row.revenue_egp,0);assert.equal(row.total_purchase_cost_egp,1000);assert.equal(row.gross_profit_egp,-1000);assert.equal(row.is_gift,true);assert.equal(db.data.finished_stock[0].stock_qty,9);
});
test('delivery filters, unknown legacy delivery and input checks preserve original data',async()=>{
 const db=database();for(const delivery_method of ['damietta','mansoura','shipping'])await db.request('/printer-sales','POST',printer({delivery_method}));await db.request('/printer-sales','POST',printer());
 const {filterInvoices}=await import('../client/src/salesModel.js');assert.equal(filterInvoices(await db.request('/sales-hub'),{delivery_method:'shipping'}).length,1);assert.equal((await db.request('/sales-hub/printer/4')).delivery_method,null);
 await assert.rejects(db.request('/printer-sales','POST',printer({delivery_method:'invalid'})),/طريقة تسليم/);await assert.rejects(db.request('/printer-sales','POST',printer({is_gift:'true'})),/الهدية/);assert.equal(db.data.printer_sales.length,4);
});
test('gift toggle restores entered price and client totals ignore any price on gifted lines',async()=>{
 const {toggleGift}=await import('../client/src/invoiceOptions.js'),{printerInvoiceTotal}=await import('../client/src/printerInvoices.js');
 const line={unit_price:75,is_gift:false},gift=toggleGift(line);assert.equal(gift.unit_price,0);assert.equal(gift.is_gift,true);assert.equal(toggleGift(gift).unit_price,75);
 const device=toggleGift({unit_sell_price_egp:5500},'unit_sell_price_egp');assert.equal(device.unit_sell_price_egp,0);assert.equal(toggleGift(device,'unit_sell_price_egp').unit_sell_price_egp,5500);
 assert.equal(printerInvoiceTotal({quantity:1,unit_price:5000,extra_items:[{quantity:2,unit_price:999,is_gift:true}]}),5000);
});
