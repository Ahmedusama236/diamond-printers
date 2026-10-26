import {invoiceSource,decorateInvoice,cash} from './salesModel.js';
export function createInvoiceLedger({selectRows,selectSingle,insertRow,updateRows,updateFinishedStock,updateComponentStock,moveShopStock,insertLedger,actor='مستخدم',nowIso,toUtcIsoFromInput}){
 const sourceTables={product:'sales_records',printer:'printer_sales',spare:'spare_sales',maintenance:'maintenance_tickets'};
 const eq=(kind,id)=>[['kind',kind],['source_id',id]];
 const positive=(value,label)=>{const n=Number(value);if(value===''||value==null||!Number.isFinite(n)||n<=0)throw new Error(`أدخل ${label} أكبر من صفر`);return n;};
 const amount=(v)=>{const n=Number(v);if(!['string','number'].includes(typeof v)||String(v).trim()===''||!Number.isFinite(n)||n<0||n>999999999999)throw new Error('أدخل مبلغًا صحيحًا غير سالب');return cash(n);};
 async function audit(meta,event,details){await insertRow('sales_events',{invoice_id:meta.id,actor,event,details,created_at:nowIso()});}
 async function list(){
  const [products,printers,repairs,names,metas,payments,returns,spares]=await Promise.all([selectRows('sales_records'),selectRows('printer_sales'),selectRows('maintenance_tickets'),selectRows('products'),selectRows('sales_invoice_meta'),selectRows('sales_payments'),selectRows('sales_returns'),selectRows('spare_sales')]);
  const bases=[...products.map(r=>invoiceSource('product',{...r,product_name:names.find(p=>p.id===r.product_id)?.name||''})),...printers.map(r=>invoiceSource('printer',r)),...spares.map(r=>invoiceSource('spare',r)),...repairs.filter(r=>r.status==='completed').map(r=>invoiceSource('maintenance',r))];
  return bases.map(base=>{const meta=metas.find(m=>m.kind===base.kind&&m.source_id===base.source_id);return decorateInvoice(base,meta,payments.filter(p=>p.invoice_id===meta?.id),returns.filter(r=>r.invoice_id===meta?.id));}).sort((a,b)=>b.date.localeCompare(a.date));
 }
 async function get(kind,id){const row=(await list()).find(r=>r.kind===kind&&r.source_id===id);if(!row)throw new Error('الفاتورة غير موجودة');return row;}
 async function metaFor(kind,id){let meta=await selectSingle('sales_invoice_meta',{eq:eq(kind,id)});if(!meta)meta=await insertRow('sales_invoice_meta',{kind,source_id:id,payment_reviewed:false,revision:0,cancelled:false});return meta;}
 async function touch(meta){await updateRows('sales_invoice_meta',{revision:meta.revision+1},[['id',meta.id]]);}
 async function restore(row,qty,referenceId,referenceType='sales_return',index=0){if(!qty)return;const line=row.lines[index];if(line.shop_item_id&&['printer','spare'].includes(row.kind)){await moveShopStock(line.shop_item_id,qty,referenceType,referenceId,'return');return;}if(row.kind==='product'){await updateFinishedStock(row.source.product_id,qty);await insertLedger({itemType:'finished',itemId:row.source.product_id,deltaQty:qty,reason:'adjustment',referenceType,referenceId});}if(row.kind==='spare'&&line.component_id){const componentId=line.component_id;await updateComponentStock(componentId,qty);await insertLedger({itemType:'component',itemId:componentId,deltaQty:qty,reason:'adjustment',referenceType,referenceId});}}
 async function mutate(kind,id,action,body){
  let row=await get(kind,id);const meta=await metaFor(kind,id);
  if(Number(body.revision)!==meta.revision)throw new Error('الفاتورة اتغيّرت؛ حدّث البيانات وراجعها قبل الحفظ');
  if(action==='review'){
   if(meta.payment_reviewed)throw new Error('التحصيل مُراجع بالفعل؛ سجّل دفعة أو رد مبلغ');
   const paid=amount(body.amount);if(paid>row.net)throw new Error('المدفوع أكبر من صافي الفاتورة');
   const name=String(body.customer_name||row.customer_name||'').trim();if(paid<row.net&&!name)throw new Error('أدخل اسم العميل لحفظ مبلغ مستحق عليه');
   await updateRows('sales_invoice_meta',{payment_reviewed:true,customer_name:name||null,customer_phone:String(body.customer_phone||row.phone||'').trim()||null},[['id',meta.id]]);
   if(paid)await insertRow('sales_payments',{invoice_id:meta.id,direction:'receipt',amount:paid,method:paymentMethod(body.method),paid_at:toUtcIsoFromInput(body.paid_at,'paid_at'),note:'رصيد محصّل عند بدء المتابعة'});
   await audit(meta,'review',{amount:paid,customer_name:name});
  }else if(action==='payment'){
   if(!meta.payment_reviewed)throw new Error('راجع التحصيل السابق أولًا');
   const n=amount(body.amount);positive(n,'المبلغ');const refund=body.direction==='refund';
   if(refund?n>Math.max(0,-row.balance):n>Math.max(0,row.balance))throw new Error(refund?'المبلغ أكبر من المبلغ الواجب رده':'المبلغ أكبر من المتبقي على العميل');
   const date=toUtcIsoFromInput(body.paid_at,'paid_at');if(Date.parse(date)>Date.now()+60000)throw new Error('تاريخ التحصيل لا يمكن أن يكون في المستقبل');
   await insertRow('sales_payments',{invoice_id:meta.id,direction:refund?'refund':'receipt',amount:n,method:paymentMethod(body.method),paid_at:date,note:String(body.note||'').trim()||null});
   await audit(meta,refund?'refund':'payment',{amount:n,method:body.method,paid_at:date});
  }else if(action==='return'){
   if(!meta.payment_reviewed)throw new Error('راجع التحصيل السابق قبل تسجيل مرتجع حتى يظهر المبلغ الواجب رده بشكل صحيح');
   if(meta.cancelled)throw new Error('الفاتورة ملغاة');if(kind==='maintenance')throw new Error('للصيانة استخدم إلغاء الفاتورة مع توضيح السبب');
   const index=Number(body.line_index),line=row.lines.find(l=>l.index===index),qty=positive(body.quantity,'العدد');
   if(!Number.isSafeInteger(qty)||!line||qty>line.quantity-line.returned)throw new Error('كمية المرتجع أكبر من الكمية المتاحة أو غير صحيحة');
   const reason=String(body.reason||'').trim();if(!reason)throw new Error('اكتب سبب المرتجع');
   const result=await insertRow('sales_returns',{invoice_id:meta.id,line_index:index,quantity:qty,amount:cash(qty*line.unit_price),reason});
   await restore(row,qty,result.id,'sales_return',index);await audit(meta,'return',{item:line.item_name,quantity:qty,amount:result.amount,reason});
  }else if(action==='cancel'){
   if(!meta.payment_reviewed)throw new Error('راجع التحصيل السابق قبل إلغاء الفاتورة حتى يظهر المبلغ الواجب رده بشكل صحيح');
   if(meta.cancelled)throw new Error('الفاتورة ملغاة بالفعل');const reason=String(body.reason||'').trim();if(!reason)throw new Error('اكتب سبب الإلغاء');
   await updateRows('sales_invoice_meta',{cancelled:true,cancel_reason:reason},[['id',meta.id]]);
   for(const line of row.lines)await restore(row,line.quantity-line.returned,meta.id,'sales_cancellation',line.index);
   await audit(meta,'cancel',{reason,previous_net:row.net});
  }else throw new Error('إجراء غير معروف');
  await touch(meta);return get(kind,id);
 }
 function paymentMethod(value){if(!['cash','transfer','card','other'].includes(value))throw new Error('اختر طريقة الدفع');return value;}
 async function before(kind,id,body){
  const meta=await selectSingle('sales_invoice_meta',{eq:eq(kind,id)});
  if(meta?.cancelled||(meta&&(await selectRows('sales_returns',{eq:[['invoice_id',meta.id]]})).length))throw new Error('الفاتورة ملغاة أو عليها مرتجع؛ لا يمكن تغيير أصنافها');
  if(body.invoice_revision==null||Number(body.invoice_revision)!==(meta?.revision||0))throw new Error('الفاتورة اتغيّرت؛ افتح التعديل من جديد');
  return meta;
 }
 async function edited(kind,id,beforeRow,afterRow){
  const meta=await metaFor(kind,id);
  if(!meta.payment_reviewed&&invoiceSource(kind,beforeRow).total!==invoiceSource(kind,afterRow).total)throw new Error('راجع التحصيل السابق من المبيعات قبل تغيير قيمة الفاتورة');
  if(beforeRow.customer_name!==afterRow.customer_name||beforeRow.customer_phone!==afterRow.customer_phone||beforeRow.phone!==afterRow.phone)await updateRows('sales_invoice_meta',{customer_name:afterRow.customer_name||null,customer_phone:afterRow.customer_phone||afterRow.phone||null},[['id',meta.id]]);
  const updated=await get(kind,id);if(meta.payment_reviewed&&updated.balance>0&&!updated.customer_name)throw new Error('أدخل اسم العميل لحفظ مبلغ مستحق عليه');
  await audit(meta,'edit',{before:beforeRow,after:afterRow});await touch(meta);
 }
 async function created(kind,row,body){
  const meta=await metaFor(kind,row.id);await audit(meta,'create',{invoice:row});
  if(body.payment_amount!==undefined)await mutate(kind,row.id,'review',{...body,amount:body.payment_amount,revision:0,method:body.payment_method||'cash'});
 }
 return {list,get,mutate,before,edited,created,audit,metaFor,sourceTables};
}
