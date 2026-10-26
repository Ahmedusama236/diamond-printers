export function createShopInventory({selectRows,selectSingle,insertRow,updateRows,toPositiveInt,toNonNegativeNumber,toUtcIsoFromInput,nowIso,actor='مستخدم'}){
 async function items(){const [rows,purchases]=await Promise.all([selectRows('shop_items',{order:[['item_name',true]]}),selectRows('shop_purchases',{order:[['received_at',false],['id',false]]})]);return rows.map(r=>({...r,latest_price_egp:purchases.find(p=>p.shop_item_id===r.id)?.unit_price??null}));}
 async function item(id){return (await items()).find(r=>r.id===id)||null;}
 async function move(id,delta,referenceType,referenceId,reason){
  if(!delta)return;const row=await selectSingle('shop_items',{eq:[['id',id]]});if(!row)throw new Error('صنف المحل غير موجود');
  const qty=Number(row.stock_qty)+delta;if(!Number.isSafeInteger(qty)||qty<0||qty>2147483647)throw new Error(`رصيد المحل غير كافٍ للصنف ${row.item_name}. المتاح: ${row.stock_qty}`);
  await updateRows('shop_items',{stock_qty:qty,updated_at:nowIso()},[['id',id]]);
  await insertRow('shop_stock_ledger',{shop_item_id:id,delta_qty:delta,reference_type:referenceType,reference_id:referenceId,reason,reversed:reason==='edit_reversal',actor,created_at:nowIso()});
 }
 async function reverse(type,id){const rows=await selectRows('shop_stock_ledger',{eq:[['reference_type',type],['reference_id',id],['reversed',false]]});for(const row of rows){await move(row.shop_item_id,-row.delta_qty,type,id,'edit_reversal');await updateRows('shop_stock_ledger',{reversed:true},[['id',row.id]]);}}
 async function purchases(){const [rows,goods,suppliers]=await Promise.all([selectRows('shop_purchases',{order:[['received_at',false],['id',false]]}),items(),selectRows('suppliers')]);return rows.map(r=>({...r,item_name:goods.find(g=>g.id===r.shop_item_id)?.item_name||'',sell_price:goods.find(g=>g.id===r.shop_item_id)?.sell_price??'',supplier_name:suppliers.find(s=>s.id===r.supplier_id)?.name||'',total_amount:Math.round(r.quantity*r.unit_price*100)/100}));}
 async function purchase(body,id){
  const current=id?await selectSingle('shop_purchases',{eq:[['id',id]]}):null;
  if(id&&!current)throw new Error('فاتورة الشراء غير موجودة');
  if(current&&Number(body.revision)!==current.revision)throw new Error('فاتورة الشراء اتغيّرت؛ افتح التعديل من جديد');
  const quantity=toPositiveInt(body.quantity,'quantity'),unitPrice=toNonNegativeNumber(body.unit_price,'unit_price');
  if(quantity*unitPrice>999999999999)throw new Error('إجمالي الشراء أكبر من الحد المسموح');
  const supplierId=body.supplier_id?toPositiveInt(body.supplier_id,'supplier_id'):null;
  if(supplierId&&!await selectSingle('suppliers',{eq:[['id',supplierId]]}))throw new Error('المورد غير موجود');
  let itemId=current?.shop_item_id||(body.shop_item_id?toPositiveInt(body.shop_item_id,'shop_item_id'):null);
  if(!itemId){const name=String(body.item_name||'').trim();if(!name)throw new Error('أدخل اسم صنف المحل');const normalized=name.toLowerCase();if((await selectRows('shop_items')).some(i=>i.item_name_normalized===normalized))throw new Error('الصنف موجود بالفعل؛ اختاره من القائمة');itemId=(await insertRow('shop_items',{item_name:name,item_name_normalized:normalized,stock_qty:0})).id;}
  if(!await item(itemId))throw new Error('اختار صنفًا موجودًا بالمحل');
  const payload={shop_item_id:itemId,quantity,unit_price:unitPrice,supplier_id:supplierId,received_at:toUtcIsoFromInput(body.received_at,'received_at'),notes:String(body.notes||'').trim()||null,updated_at:nowIso()};
  const row=current?(await updateRows('shop_purchases',{...payload,revision:current.revision+1},[['id',id]]))[0]:await insertRow('shop_purchases',{...payload,revision:0});
  await move(itemId,quantity-(current?.quantity||0),'shop_purchase',row.id,current?'purchase_adjustment':'purchase');
  if(body.sell_price!==undefined)await updateRows('shop_items',{sell_price:body.sell_price===''||body.sell_price==null?null:toNonNegativeNumber(body.sell_price,'sell_price')},[['id',itemId]]);
  return row;
 }
 async function applyExtras(row){for(const line of row.extra_items||[])if(line.shop_item_id)await move(line.shop_item_id,-line.quantity,'printer_sale',row.id,line.is_gift?'gift':'sale');}
 return {items,item,purchases,purchase,move,reverse,applyExtras};
}
