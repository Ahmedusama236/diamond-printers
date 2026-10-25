import {DateTime} from 'luxon';
export function newPrinterInvoice() {
  return {item_name:'',quantity:1,unit_price:'',counter:'',serial_number:'',customer_phone:'',customer_name:'',extra_items:[],
    sold_at:DateTime.now().setZone('Africa/Cairo').toFormat("yyyy-MM-dd'T'HH:mm:ss"),request_id:crypto.randomUUID()};
}
export function newPrinterExtra() {
  return {_key:crypto.randomUUID(),item_name:'',quantity:1,unit_price:''};
}
export function editPrinterInvoice(invoice) {
  return {
    id:invoice.id,item_name:invoice.item_name,quantity:invoice.quantity,unit_price:invoice.unit_price,invoice_revision:invoice.invoice_revision??0,original_total:printerInvoiceTotal(invoice),
    counter:invoice.counter??'',serial_number:invoice.serial_number??'',customer_phone:invoice.customer_phone??'',customer_name:invoice.customer_name??'',
    sold_at:DateTime.fromISO(invoice.sold_at).setZone('Africa/Cairo').toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    extra_items:(invoice.extra_items||[]).map(item=>({...item,_key:crypto.randomUUID()})),
  };
}
export function printerInvoiceTotal(invoice) {
  const lineTotal=item=>Math.round(Number(item.quantity === '' || item.quantity == null ? 1:item.quantity)*Number(item.unit_price||0)*100)/100;
  return Math.round((lineTotal(invoice)+(Array.isArray(invoice.extra_items)?invoice.extra_items:[]).reduce((sum,item)=>sum+lineTotal(item),0))*100)/100;
}
export function filterPrinterSales(rows,filters) {
  return rows.filter(row=>{
    const day=DateTime.fromISO(row.sold_at).setZone('Africa/Cairo').toISODate();
    return (!filters.from||day>=filters.from)&&(!filters.to||day<=filters.to)&&
      `${row.id} ${row.item_name} ${row.serial_number || ''} ${row.customer_name || ''} ${row.customer_phone || ''} ${(row.extra_items||[]).map(item=>item.item_name).join(' ')}`.toLowerCase().includes(filters.q.toLowerCase());
  });
}
