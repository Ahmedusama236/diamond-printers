import {useEffect,useRef,useState} from 'react';
import {DateTime} from 'luxon';
import {navigate,useLocation} from './navigation';
import {PaymentFields,InvoiceChecks,paymentPayload,DeliveryField,GiftButton} from './InvoiceFields';
import {toggleGift} from './invoiceOptions';
const money=n=>Number(n||0).toLocaleString('ar-EG',{maximumFractionDigits:2});
const freshLine=()=>({_key:crypto.randomUUID(),inventory_source:'manual',component_id:'',shop_item_id:'',item_name:'',quantity:1,unit_price:'',is_gift:false});
const fresh=()=>({items:[freshLine()],customer_name:'',customer_phone:'',sold_at:DateTime.now().setZone('Africa/Cairo').toFormat("yyyy-MM-dd'T'HH:mm:ss")});
export function SpareSales({api,Modal}){
 const location=useLocation(),[components,setComponents]=useState([]),[shopItems,setShopItems]=useState([]),[form,setForm]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true),lock=useRef(false);
 useEffect(()=>{let alive=true;const p=new URLSearchParams(location.split('?')[1]||'');setLoading(true);
  Promise.all([api.get('/components'),p.get('edit')?api.get('/spare-sales'):Promise.resolve([]),api.get('/shop-items')]).then(([parts,rows,goods])=>{if(!alive)return;setComponents(parts);setShopItems(goods);if(p.get('edit')){const row=rows.find(r=>String(r.id)===p.get('edit'));if(!row)throw new Error('الفاتورة غير موجودة');setForm({...row,original_total:row.total_amount,customer_name:row.customer_name||'',customer_phone:row.customer_phone||'',sold_at:DateTime.fromISO(row.sold_at).setZone('Africa/Cairo').toFormat("yyyy-MM-dd'T'HH:mm:ss"),items:row.items.map(i=>({...i,inventory_source:i.shop_item_id?'shop':i.component_id?'component':'manual',_key:crypto.randomUUID()}))});}else setForm(fresh());setError('');}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};
 },[location,api]);
 const change=(key,value)=>setForm(s=>({...s,[key]:value}));
 const lineChange=(key,field,value)=>setForm(s=>({...s,items:s.items.map(i=>i._key===key?{...i,[field]:value}:i)}));
 const total=Math.round((form?.items||[]).reduce((sum,i)=>sum+(i.is_gift?0:Math.round(Number(i.quantity||1)*Number(i.unit_price||0)*100)/100),0)*100)/100;
 async function save(e){e.preventDefault();if(lock.current)return;lock.current=true;setSaving(true);setError('');try{
  if(form.items.some(i=>i.inventory_source!=='manual'&&!i.component_id&&!i.shop_item_id))throw new Error('اختار الأصناف المرتبطة بالمخزون من الاقتراحات، أو اختر صنف بدون مخزون');
  const body={...form,...paymentPayload(form,total)};if(form.id)await api.put(`/spare-sales/${form.id}`,body);else await api.post('/spare-sales',body);navigate('/sales?kind=spare');
 }catch(e){setError(e.message);}finally{lock.current=false;setSaving(false);}}
 return <section><h2>بيع قطع غيار</h2><p>اكتب صنفًا بدون مخزون، أو اربطه بمخزون المحل أو المكونات ليُخصم عند الحفظ.</p><button onClick={()=>navigate('/sales?kind=spare')}>عرض كل فواتير قطع الغيار</button>{error&&!form&&<div className="error">{error}</div>}{loading&&<p role="status">جارٍ تحميل المخزون…</p>}
  {form&&!loading&&<Modal title={form.id?`تعديل فاتورة قطع غيار S-${form.id}`:'فاتورة بيع قطع غيار'} wide onClose={()=>{if(!saving)navigate('/sales?kind=spare');}}>
   <form className="gridForm" onSubmit={save}>
    {error&&<div className="error" role="alert">{error}</div>}
    <fieldset className="printerExtras" disabled={saving}><div className="printerExtrasHeader"><div><h4>قطع الغيار</h4><p>الصنف اليدوي لا يُخصم من المخزون؛ اختر مصدر مخزون للصنف المسجّل فقط.</p></div><button type="button" disabled={form.items.length>=50} onClick={()=>change('items',[...form.items,freshLine()])}>＋ إضافة قطعة</button></div>
    {form.items.map((line,index)=>{const isShop=line.inventory_source==='shop',isManual=line.inventory_source==='manual',catalog=isManual?[]:isShop?shopItems:components,idField=isShop?'shop_item_id':'component_id',component=catalog.find(c=>c.id===Number(line[idField]));
     return <article className="printerExtraLine" key={line._key}><div className="printerExtraLineHeader"><strong>صنف {index+1}</strong><div className="extraLineActions"><GiftButton gift={line.is_gift} onClick={()=>change('items',form.items.map(i=>i._key===line._key?toggleGift(i):i))}/><button type="button" className="removePrinterExtra" disabled={form.items.length===1} aria-label={`إزالة القطعة ${index+1}`} onClick={()=>change('items',form.items.filter(i=>i._key!==line._key))}>×</button></div></div>
      <label className="shopExtraPicker">مصدر الصنف<select value={line.inventory_source} onChange={e=>change('items',form.items.map(i=>i._key===line._key?{...i,inventory_source:e.target.value,component_id:'',shop_item_id:'',item_name:'',unit_price:i.is_gift?0:''}:i))}><option value="manual">صنف بدون مخزون — كتابة الاسم يدويًا</option><option value="shop">مستلزمات المحل — ورق، حبر، كابلات</option><option value="component">قطع غيار من مخزون المكونات</option></select></label>
      <div className="printerExtraFields"><label>اسم الصنف<input required list={isManual?undefined:`spare-${line._key}`} value={line.item_name} placeholder={isManual?'اكتب اسم الصنف…':'ابحث باسم الصنف…'} onChange={e=>{const value=e.target.value,part=catalog.find(c=>c.item_name===value);setForm(s=>({...s,items:s.items.map(i=>i._key===line._key?{...i,item_name:value,component_id:isShop?'':part?.id||'',shop_item_id:isShop?part?.id||'':'',unit_price:i.is_gift?0:part?.sell_price??i.unit_price}:i)}));}}/>{!isManual&&<datalist id={`spare-${line._key}`}>{catalog.filter(c=>!form.items.some(i=>i._key!==line._key&&Number(i[idField])===c.id)).map(c=><option key={c.id} value={c.item_name}>متاح {c.stock_qty} قطعة</option>)}</datalist>}</label><label>العدد<input required type="number" min="1" step="1" value={line.quantity} onChange={e=>lineChange(line._key,'quantity',e.target.value)} onBlur={()=>{if(line.quantity==='')lineChange(line._key,'quantity',1);}}/></label><label>سعر بيع القطعة<input required type="number" min="0" step="0.01" disabled={Boolean(line.is_gift)} value={line.unit_price} onChange={e=>lineChange(line._key,'unit_price',e.target.value)}/></label></div>
      <p className="printerExtraSubtotal">{isManual?'بدون خصم من المخزون • ':component?`المتاح حاليًا: ${component.stock_qty} قطعة • آخر سعر شراء: ${component.latest_price_egp==null?'غير مسجّل':money(component.latest_price_egp)+' جنيه'} • `:''}إجمالي السطر: {money(Number(line.quantity||1)*Number(line.unit_price||0))} جنيه</p></article>;
    })}</fieldset>
    <label>اسم العميل {form.payment_mode&&form.payment_mode!=='paid'?'(مطلوب للمبلغ المتبقي)':'(اختياري)'}<input required={form.payment_mode&&form.payment_mode!=='paid'} value={form.customer_name} onChange={e=>change('customer_name',e.target.value)}/></label><label>الهاتف (اختياري)<input type="tel" value={form.customer_phone} onChange={e=>change('customer_phone',e.target.value)}/></label><label>التاريخ والوقت — القاهرة<input required type="datetime-local" step="1" value={form.sold_at} onChange={e=>change('sold_at',e.target.value)}/></label>
    <DeliveryField form={form} change={change}/>
    {!form.id&&<PaymentFields form={form} change={change} total={total}/>}
    <InvoiceChecks form={form} total={total} originalTotal={form.original_total}/><div className="printerInvoiceTotal"><span>إجمالي الفاتورة</span><strong>{money(total)} جنيه</strong></div><button className="primaryButton printerInvoiceSave" disabled={saving}>{saving?'جارٍ الحفظ…':form.id?'حفظ التعديلات':'حفظ الفاتورة'}</button>
   </form>
  </Modal>}
 </section>;
}
