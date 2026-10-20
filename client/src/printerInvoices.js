import {DateTime} from 'luxon';
export function newPrinterInvoice() {
  return {item_name:'',quantity:1,unit_price:'',counter:'',customer_phone:'',customer_name:'',
    sold_at:DateTime.now().setZone('Africa/Cairo').toFormat("yyyy-MM-dd'T'HH:mm:ss"),request_id:crypto.randomUUID()};
}
export function filterPrinterSales(rows,filters) {
  return rows.filter(row=>{
    const day=DateTime.fromISO(row.sold_at).setZone('Africa/Cairo').toISODate();
    return (!filters.from||day>=filters.from)&&(!filters.to||day<=filters.to)&&
      `${row.id} ${row.item_name} ${row.customer_name || ''} ${row.customer_phone}`.toLowerCase().includes(filters.q.toLowerCase());
  });
}
