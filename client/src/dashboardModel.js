import {DateTime} from 'luxon';
const zone='Africa/Cairo';
export function periodBounds(period,from,to,now=DateTime.now()) {
  const day=now.setZone(zone).startOf('day');
  if(period==='custom')return {start:from?DateTime.fromISO(from,{zone}).startOf('day'):null,end:to?DateTime.fromISO(to,{zone}).endOf('day'):null};
  return {start:period==='week'?day.minus({days:6}):period==='month'?day.startOf('month'):day,end:day.endOf('day')};
}
export function dashboardModel(data,period='today',from='',to='',now=DateTime.now()) {
 const {start,end}=periodBounds(period,from,to,now);
 const within=(row,key)=>{const date=DateTime.fromISO(row[key]||'',{zone});return date.isValid&&(!start||date>=start)&&(!end||date<=end);};
 const sales=data.sales.filter(r=>within(r,'sold_at'));
 const printers=data.printers.filter(r=>within(r,'sold_at'));
 const delivered=data.maintenance.filter(r=>r.delivered&&within(r,'delivered_at'));
 const total=(rows,key)=>rows.reduce((sum,row)=>sum+Number(row[key]||0),0);
 const productRevenue=total(sales,'revenue_egp'),printerRevenue=printers.reduce((sum,r)=>sum+Number(r.quantity)*Number(r.unit_price),0),maintenanceRevenue=total(delivered,'repair_charge_egp');
 const unpaid=data.sales.filter(r=>!r.is_accounted);
 const count=rows=>total(rows,'units_produced');
 let chartStart=start || now.setZone(zone).minus({days:29}).startOf('day');
 let chartEnd=end || now.setZone(zone).endOf('day');
 const days=Math.max(1,Math.floor(chartEnd.startOf('day').diff(chartStart.startOf('day'),'days').days)+1);
 const bucketDays=Math.max(1,Math.ceil(days/14));
 const buckets=[];
 for(let i=0;i<days;i+=bucketDays){const date=chartStart.plus({days:i});buckets.push({date:date.toISODate(),label:date.toFormat('dd/MM'),start:date.toMillis(),end:date.plus({days:bucketDays}).toMillis(),products:0,printers:0,maintenance:0});}
 for(const [rows,key,kind,value] of [[sales,'sold_at','products',r=>Number(r.revenue_egp)],[printers,'sold_at','printers',r=>Number(r.quantity)*Number(r.unit_price)],[delivered,'delivered_at','maintenance',r=>Number(r.repair_charge_egp)]])for(const row of rows){const time=DateTime.fromISO(row[key]).toMillis();const bucket=buckets.find(b=>time>=b.start&&time<b.end);if(bucket)bucket[kind]+=value(row);}
 return {sales,printers,delivered,productRevenue,printerRevenue,maintenanceRevenue,revenue:productRevenue+printerRevenue+maintenanceRevenue,profit:total(sales,'gross_profit_egp'),units:total(sales,'units_sold'),unpaidUnits:total(unpaid,'units_sold'),unpaidAmount:unpaid.reduce((sum,r)=>sum+Number(r.units_sold)*Number(r.manufacturing_cost_per_unit??1000),0),orders:count(data.manufacturing.filter(r=>r.status==='order')),inProgress:count(data.manufacturing.filter(r=>r.status==='in_progress')),completed:count(data.manufacturing.filter(r=>r.status==='completed'||!r.status)),available:total(data.products,'finished_stock_qty'),ready:data.maintenance.filter(r=>r.status==='completed'&&!r.delivered),repairing:data.maintenance.filter(r=>r.status==='in_progress'),buckets};
}
