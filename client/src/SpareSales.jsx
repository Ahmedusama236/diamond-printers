import {useEffect,useRef,useState} from 'react';
import {DateTime} from 'luxon';
import {navigate,useLocation} from './navigation';
import {PaymentFields,InvoiceChecks,paymentPayload} from './InvoiceFields';
const money=n=>Number(n||0).toLocaleString('ar-EG',{maximumFractionDigits:2});
const freshLine=()=>({_key:crypto.randomUUID(),component_id:'',item_name:'',quantity:1,unit_price:''});
const fresh=()=>({items:[freshLine()],customer_name:'',customer_phone:'',sold_at:DateTime.now().setZone('Africa/Cairo').toFormat("yyyy-MM-dd'T'HH:mm:ss")});
export function SpareSales({api,Modal}){
 const location=useLocation(),[components,setComponents]=useState([]),[form,setForm]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true),lock=useRef(false);
 useEffect(()=>{let alive=true;const p=new URLSearchParams(location.split('?')[1]||'');setLoading(true);
  Promise.all([api.get('/components'),p.get('edit')?api.get('/spare-sales'):Promise.resolve([])]).then(([parts,rows])=>{if(!alive)return;setComponents(parts);if(p.get('edit')){const row=rows.find(r=>String(r.id)===p.get('edit'));if(!row)throw new Error('الفاتورة غير موجودة');setForm({...row,original_total:row.total_amount,customer_name:row.customer_name||'',customer_phone:row.customer_phone||'',sold_at:DateTime.fromISO(row.sold_at).setZone('Africa/Cairo').toFormat("yyyy-MM-dd'T'HH:mm:ss"),items:row.items.map(i=>({...i,_key:crypto.randomUUID()}))});}else setForm(fresh());setError('');}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};
 },[location,api]);
 const change=(key,value)=>setForm(s=>({...s,[key]:value}));
 const lineChange=(key,field,value)=>setForm(s=>({...s,items:s.items.map(i=>i._key===key?{...i,[field]:value}:i)}));
 const total=Math.round((form?.items||[]).reduce((sum,i)=>sum+Math.round(Number(i.quantity||1)*Number(i.unit_price||0)*100)/100,0)*100)/100;
 async function save(e){e.preventDefault();if(lock.current)return;lock.current=true;setSaving(true);setError('');try{
  if(form.items.some(i=>!i.component_id))throw new Error('اختار كل قطعة بالاسم من اقتراحات المخزون');
  const body={...form,...paymentPayload(form,total)};if(form.id)await api.put(`/spare-sales/${form.id}`,body);else await api.post('/spare-sales',body);navigate('/sales?kind=spare');
 }catch(e){setError(e.message);}finally{lock.current=false;setSaving(false);}}
 return <section><h2>بيع قطع غيار</h2><p>اختار القطع من المخزون، وحدد الكمية وسعر البيع. الخصم يتم عند حفظ الفاتورة.</p><button onClick={()=>navigate('/sales?kind=spare')}>عرض كل فواتير قطع الغيار</button>{error&&!form&&<div className="error">{error}</div>}{loading&&<p role="status">جارٍ تحميل المخزون…</p>}
  {form&&!loading&&<Modal title={form.id?`تعديل فاتورة قطع غيار S-${form.id}`:'فاتورة بيع قطع غيار'} wide onClose={()=>{if(!saving)navigate('/sales?kind=spare');}}>
   <form className="gridForm" onSubmit={save}>
    {error&&<div className="error" role="alert">{error}</div>}
    <fieldset className="printerExtras" disabled={saving}><div className="printerExtrasHeader"><div><h4>قطع الغيار</h4><p>اكتب جزءًا من الاسم، واختار القطعة من القائمة.</p></div><button type="button" disabled={form.items.length>=50} onClick={()=>change('items',[...form.items,freshLine()])}>＋ إضافة قطعة</button></div>
    {form.items.map((line,index)=>{const component=components.find(c=>c.id===Number(line.component_id));
     return <article className="printerExtraLine" key={line._key}><div className="printerExtraLineHeader"><strong>قطعة {index+1}</strong><button type="button" className="removePrinterExtra" disabled={form.items.length===1} aria-label={`إزالة القطعة ${index+1}`} onClick={()=>change('items',form.items.filter(i=>i._key!==line._key))}>×</button></div>
      <div className="printerExtraFields"><label>قطعة الغيار<input required list={`spare-${line._key}`} value={line.item_name} placeholder="ابحث باسم القطعة…" onChange={e=>{const value=e.target.value,part=components.find(c=>c.item_name===value);setForm(s=>({...s,items:s.items.map(i=>i._key===line._key?{...i,item_name:value,component_id:part?.id||''}:i)}));}}/><datalist id={`spare-${line._key}`}>{components.filter(c=>!form.items.some(i=>i._key!==line._key&&Number(i.component_id)===c.id)).map(c=><option key={c.id} value={c.item_name}>متاح {c.stock_qty} قطعة</option>)}</datalist></label><label>العدد<input required type="number" min="1" step="1" value={line.quantity} onChange={e=>lineChange(line._key,'quantity',e.target.value)} onBlur={()=>{if(line.quantity==='')lineChange(line._key,'quantity',1);}}/></label><label>سعر بيع القطعة<input required type="number" min="0" step="0.01" value={line.unit_price} onChange={e=>lineChange(line._key,'unit_price',e.target.value)}/></label></div>
      <p className="printerExtraSubtotal">{component?`المتاح حاليًا: ${component.stock_qty} قطعة • آخر سعر شراء: ${component.latest_price_egp==null?'غير مسجّل':money(component.latest_price_egp)+' جنيه'} • `:''}إجمالي السطر: {money(Number(line.quantity||1)*Number(line.unit_price||0))} جنيه</p></article>;
    })}</fieldset>
    <label>اسم العميل {form.payment_mode&&form.payment_mode!=='paid'?'(مطلوب للمبلغ المتبقي)':'(اختياري)'}<input required={form.payment_mode&&form.payment_mode!=='paid'} value={form.customer_name} onChange={e=>change('customer_name',e.target.value)}/></label><label>الهاتف (اختياري)<input type="tel" value={form.customer_phone} onChange={e=>change('customer_phone',e.target.value)}/></label><label>التاريخ والوقت — القاهرة<input required type="datetime-local" step="1" value={form.sold_at} onChange={e=>change('sold_at',e.target.value)}/></label>
    {!form.id&&<PaymentFields form={form} change={change} total={total}/>}
    <InvoiceChecks form={form} total={total} originalTotal={form.original_total}/><div className="printerInvoiceTotal"><span>إجمالي الفاتورة</span><strong>{money(total)} جنيه</strong></div><button className="primaryButton printerInvoiceSave" disabled={saving}>{saving?'جارٍ الحفظ…':form.id?'حفظ التعديلات':'حفظ الفاتورة'}</button>
   </form>
  </Modal>}
 </section>;
}
