import {DateTime} from 'luxon';
import {printerInvoiceTotal} from './printerInvoices.js';
export const invoiceKinds={product:'بيع جهاز',printer:'بيع طابعة',spare:'بيع قطع غيار ومستلزمات',maintenance:'صيانة'};
export const repairTypes={printer:'صيانة طابعة',device:'صيانة جهاز'};
export const paymentStates={unknown:'غير مُراجع',due:'عليه مبلغ مستحق',unpaid:'غير مدفوع',partial:'مدفوع جزئيًا',paid:'مدفوع'};
export const invoiceStates={active:'سارية',partial_return:'مرتجع جزئي',returned:'مرتجعة بالكامل',cancelled:'ملغاة'};
export const cash=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
export function invoiceSource(kind,row){
 const lines=kind==='spare'?row.items:kind==='printer'?[{item_name:row.item_name,quantity:row.quantity,unit_price:row.unit_price,is_gift:row.is_gift||false},...(row.extra_items||[])]:kind==='product'?[{item_name:row.product_name||'جهاز مصنّع',quantity:row.units_sold,unit_price:row.unit_sell_price_egp,is_gift:row.is_gift||false}]:[{item_name:row.maintenance_description||row.device_issue||'صيانة',quantity:1,unit_price:row.repair_charge_egp}];
 return {key:`${kind}:${row.id}`,kind,source_id:row.id,number:`${{product:'M',printer:'P',spare:'S',maintenance:'R'}[kind]}-${row.id}`,date:kind==='maintenance'?(row.completed_at||row.opened_at):row.sold_at,repair_type:row.device_type||null,
  name:kind==='maintenance'?`${repairTypes[row.device_type]||'صيانة'} — ${lines[0].item_name}`:lines[0].item_name,customer_name:row.customer_name||'',phone:row.customer_phone||row.phone||'',serial:row.serial_number||'',counter:row.counter??null,
  lines:lines.map((line,index)=>({...line,index,quantity:Number(line.quantity),unit_price:line.is_gift?0:Number(line.unit_price)})),delivery_method:row.delivery_method||null,
  total:cash(kind==='spare'?row.total_amount:kind==='printer'?printerInvoiceTotal(row):kind==='product'?row.revenue_egp:row.repair_charge_egp),source:row};
}
export function decorateInvoice(base,meta,payments=[],returns=[]){
 const returned=returns.reduce((sum,r)=>sum+Number(r.amount),0);
 const net=meta?.cancelled?0:cash(base.total-returned);
 const known=Boolean(meta?.payment_reviewed),recordedPaid=cash(payments.reduce((s,p)=>s+(p.direction==='refund'?-1:1)*Number(p.amount),0)),paid=Math.max(0,Math.min(recordedPaid,net));
 const balance=known?Math.max(0,cash(net-paid)):null;
 const lines=base.lines.map(line=>({...line,returned:returns.filter(r=>r.line_index===line.index).reduce((s,r)=>s+Number(r.quantity),0)}));
 const state=meta?.cancelled?'cancelled':returns.length?(lines.every(l=>l.returned>=l.quantity)?'returned':'partial_return'):'active';
 return {...base,lines,meta:meta||null,payments,returns,net,paid:known?paid:null,recordedPaid:known?recordedPaid:null,balance,returned:cash(returned),state,payment_state:!known?'unknown':balance===0?'paid':paid===0?'unpaid':'partial',customer_name:meta?.customer_name||base.customer_name,phone:meta?.customer_phone||base.phone};
}
export function filterInvoices(rows,f={}){
 const q=String(f.q||'').trim().toLowerCase();
 return rows.filter(r=>{
  const day=DateTime.fromISO(r.date||'').setZone('Africa/Cairo').toISODate();
  return (!f.from||day>=f.from)&&(!f.to||day<=f.to)&&(!f.kind||r.kind===f.kind)&&(!f.delivery_method||r.delivery_method===f.delivery_method)&&(!f.repair_type||(r.kind==='maintenance'&&r.repair_type===f.repair_type))&&(!f.state||r.state===f.state)&&(!f.payment||(f.payment==='due'?r.balance>0:r.payment_state===f.payment))&&(!f.manufacturing||r.kind==='product'&&!r.source.is_accounted)&&(!q||[r.number,r.name,r.customer_name,r.phone,r.serial,repairTypes[r.repair_type]||'',...r.lines.map(l=>l.item_name)].join(' ').toLowerCase().includes(q));
 });
}
export function salesTotals(rows){return rows.reduce((s,r)=>({count:s.count+1,sales:cash(s.sales+r.net),collected:cash(s.collected+(r.paid??0)),due:cash(s.due+(r.balance??0)),refund:0,unknown:s.unknown+(r.paid==null?1:0)}),{count:0,sales:0,collected:0,due:0,refund:0,unknown:0});}
export function accountingProduct(invoice){
 const original=invoice.source,units=invoice.state==='cancelled'?0:invoice.lines[0].quantity-invoice.lines[0].returned;
 const cost=cash(Number(original.unit_purchase_cost_egp||0)*units),profit=cash(invoice.net-cost);
 return {...original,units_sold:units,revenue_egp:invoice.net,total_purchase_cost_egp:cost,gross_profit_egp:profit,margin_pct:invoice.net?cash(profit/invoice.net*100):0};
}
export function accountingSpare(invoice){
 const cost=invoice.state==='cancelled'?0:cash(invoice.lines.reduce((sum,line)=>sum+(line.quantity-line.returned)*Number(line.unit_cost_egp||0),0));
 return {revenue:invoice.net,cost,profit:cash(invoice.net-cost),complete:invoice.state==='cancelled'||invoice.lines.every(line=>line.cost_complete||line.quantity===line.returned)};
}
