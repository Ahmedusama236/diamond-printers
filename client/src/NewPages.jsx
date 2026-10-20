import {useEffect,useState,useRef} from 'react';
import {DateTime} from 'luxon';
import {navigate,useLocation} from './navigation';
import {newPrinterInvoice,filterPrinterSales} from './printerInvoices';
const zone='Africa/Cairo';
const money=value=>Number(value || 0).toLocaleString('ar-EG',{maximumFractionDigits:2});

export function Dashboard({api}) {
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false,inFlight=false;
    const refresh=async()=>{
      if(inFlight) return;
      inFlight=true;
      try {
        const [shortages,sales,manufacturing,printers,products]=await Promise.all([
          api.get('/shortages'),api.get('/sales-records'),api.get('/manufacturing-records'),api.get('/printer-sales'),api.get('/products'),
        ]);
        if(!cancelled) {setData({shortages,sales,manufacturing,printers,products});setError('');}
      } catch(e) {if(!cancelled)setError(e.message);} finally {inFlight=false;}
    };
    refresh(); const timer=setInterval(refresh,15000);
    return ()=>{cancelled=true;clearInterval(timer);};
  },[api]);
  if(!data)return <section>{error || 'جارٍ تحميل لوحة التحكم…'}</section>;
  const today=DateTime.now().setZone(zone).toISODate();
  const todaySales=data.sales.filter(row=>DateTime.fromISO(row.sold_at).setZone(zone).toISODate()===today);
  const todayPrinters=data.printers.filter(row=>DateTime.fromISO(row.sold_at).setZone(zone).toISODate()===today);
  const unpaid=data.sales.filter(row=>!row.is_accounted);
  return <section><h2>لوحة التحكم</h2>{error&&<div className="error">{error}</div>}
    <div className="dashboardGrid">
      <article><a href="/shortages" onClick={link}>النواقص ↗</a><h3>{data.shortages.length} صنف ناقص</h3>
        {data.shortages.slice(0,5).map(row=><p key={row.id}>{row.item_name}: متبقي {row.stock_qty} / الحد {row.effective_minimum_stock_qty}</p>)}</article>
      <article><a href="/sales" onClick={link}>مبيعات المنتجات ↗</a><h3>مبيعات اليوم: {money(todaySales.reduce((s,r)=>s+Number(r.revenue_egp),0))} جنيه</h3>
        {data.sales.slice(0,5).map(row=><p key={row.id}>{row.product_name} — {row.units_sold} قطعة — {money(row.revenue_egp)} جنيه</p>)}</article>
      <article><a href="/manufacturing/completed" onClick={link}>التصنيع ↗</a>
        <p>تحت التصنيع: {data.manufacturing.filter(r=>r.status==='in_progress').reduce((s,r)=>s+Number(r.units_produced),0)} جهاز</p>
        <p>تم تصنيع: {data.manufacturing.filter(r=>r.status==='completed'||!r.status).reduce((s,r)=>s+Number(r.units_produced),0)} جهاز</p>
        <p>تم بيع: {data.sales.reduce((s,r)=>s+Number(r.units_sold),0)} جهاز</p>
        <p>متاح بالمخزون: {data.products.reduce((s,r)=>s+Number(r.finished_stock_qty),0)} جهاز</p></article>
      <article><a href="/sales?payment=unpaid" onClick={link}>حساب التصنيع غير المدفوع ↗</a>
        <h3>{unpaid.reduce((s,r)=>s+Number(r.units_sold),0)} قطعة</h3>
        <p>المستحق: {money(unpaid.reduce((s,r)=>s+Number(r.units_sold)*Number(r.manufacturing_cost_per_unit ?? 1000),0))} جنيه</p></article>
      <article><a href="/printers/sales" onClick={link}>مبيعات الطابعات ↗</a>
        <h3>مبيعات اليوم: {money(todayPrinters.reduce((s,r)=>s+r.quantity*Number(r.unit_price),0))} جنيه</h3>
        <p>{todayPrinters.length} فاتورة اليوم</p></article>
    </div></section>;
}
function link(event){if(!event.ctrlKey&&!event.metaKey){event.preventDefault();navigate(event.currentTarget.getAttribute('href'));}}

export function PrintersPage({api,Modal,DataTable}) {
  const location=useLocation();
  const history=location.startsWith('/printers/sales');
  const [rows,setRows]=useState([]),[form,setForm]=useState(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const lock=useRef(false);
  useEffect(()=>{if(new URLSearchParams(location.split('?')[1]||'').get('new')==='1'){setForm(newPrinterInvoice());navigate('/printers/sell');}},[location]);
  const [filters,setFilters]=useState({from:'',to:'',q:''});
  const load=async()=>{setRows(await api.get('/printer-sales'));};
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  const change=(key,value)=>setForm(s=>({...s,[key]:value}));
  const filtered=filterPrinterSales(rows,filters);
  return <section><h2>الطابعات</h2><div className="subTabs">
    <button className={!history?'active':''} onClick={()=>navigate('/printers/sell')}>بيع</button>
    <button className={history?'active':''} onClick={()=>navigate('/printers/sales')}>المبيعات</button></div>
    {error&&<div className="error">{error}</div>}
    {!history?<button className="primaryButton" onClick={()=>{setError('');setForm(newPrinterInvoice());}}>＋ إنشاء فاتورة</button>:<>
      <div className="filterBar"><label>من <input type="date" value={filters.from} onChange={e=>setFilters(s=>({...s,from:e.target.value}))}/></label>
        <label>إلى <input type="date" value={filters.to} onChange={e=>setFilters(s=>({...s,to:e.target.value}))}/></label>
        <input placeholder="بحث بالصنف أو العميل أو رقم الفاتورة" value={filters.q} onChange={e=>setFilters(s=>({...s,q:e.target.value}))}/></div>
      <p>{filtered.length} فاتورة — {filtered.reduce((s,r)=>s+Number(r.quantity),0)} طابعة — إجمالي {money(filtered.reduce((s,r)=>s+r.quantity*Number(r.unit_price),0))} جنيه</p>
      <DataTable searchable={false} columns={['الفاتورة','التاريخ','الصنف','العدد','سعر الوحدة','الإجمالي','العداد','العميل','الهاتف']} rows={filtered} secondaryColumns={[6,8]} emptyText="لا توجد فواتير" renderRow={r=><><td>#{r.id}</td><td>{DateTime.fromISO(r.sold_at).setZone(zone).toFormat('yyyy-MM-dd HH:mm:ss')}</td><td>{r.item_name}</td><td>{r.quantity}</td><td>{money(r.unit_price)}</td><td>{money(r.quantity*r.unit_price)}</td><td>{r.counter ?? '—'}</td><td>{r.customer_name || '—'}</td><td>{r.customer_phone || '—'}</td></>}/></>}
    {form&&<Modal title="فاتورة بيع طابعات" onClose={()=>{if(!saving)setForm(null);}}>
      <form className="gridForm" onSubmit={async e=>{
        e.preventDefault();if(lock.current)return;lock.current=true;setSaving(true);setError('');
        try{await api.post('/printer-sales',form);setForm(null);await load();navigate('/printers/sales');}
        catch(err){setError(err.message);}finally{lock.current=false;setSaving(false);}
      }}>
        {error&&<div className="error">{error}</div>}
        <label>الصنف<input required value={form.item_name} onChange={e=>change('item_name',e.target.value)}/></label>
        <label>العدد<input type="number" min="1" step="1" placeholder="1" value={form.quantity} onChange={e=>change('quantity',e.target.value)} onBlur={()=>{if(form.quantity==='')change('quantity',1);}}/></label>
        <label>سعر الوحدة<input type="number" required min="0" step="0.01" value={form.unit_price} onChange={e=>change('unit_price',e.target.value)}/></label>
        <label>العداد (اختياري)<input type="number" min="0" step="1" value={form.counter} onChange={e=>change('counter',e.target.value)}/></label>
        <label>هاتف العميل (اختياري)<input type="tel" value={form.customer_phone} onChange={e=>change('customer_phone',e.target.value)}/></label>
        <label>اسم العميل (اختياري)<input value={form.customer_name} onChange={e=>change('customer_name',e.target.value)}/></label>
        <label>التاريخ والوقت — القاهرة<input type="datetime-local" required step="1" value={form.sold_at} onChange={e=>change('sold_at',e.target.value)}/></label>
        <p>الإجمالي: {money((form.quantity === '' ? 1 : form.quantity)*form.unit_price)} جنيه</p>
        <button disabled={saving} className="primaryButton">{saving?'جارٍ الحفظ…':'حفظ'}</button><button disabled={saving} type="button" onClick={()=>setForm(null)}>إلغاء</button>
      </form></Modal>}
  </section>;
}

export function AccountsPage({api,Modal,user,DataTable}) {
  const [rows,setRows]=useState([]),[form,setForm]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const load=()=>api.get('/accounts').then(setRows);
  useEffect(()=>{if(user?.role==='admin')load().catch(e=>setError(e.message));},[user?.role]);
  if(user?.role!=='admin')return <p>إدارة الحسابات متاحة للمدير فقط.</p>;
  return <div><div className="sectionHeader"><h3>إدارة الحسابات</h3><button className="primaryButton" onClick={()=>{setError('');setForm({username:'',password:'',role:'user',active:true});}}>إنشاء حساب</button></div>
    {error&&<div className="error">{error}</div>}
    <DataTable columns={['اسم المستخدم','الصلاحية','الحالة','إجراءات']} rows={rows} emptyText="لا توجد حسابات" renderRow={r=><><td>{r.username}</td><td>{r.role==='admin'?'مدير':'مستخدم'}</td><td><span className={r.active?'statusActive':'statusInactive'}>{r.active?'فعال':'معطل'}</span></td><td><button onClick={()=>{setError('');setForm({...r,password:''});}}>تعديل</button></td></>}/>
    {form&&<Modal title={form.id?'تعديل الحساب':'إنشاء حساب'} onClose={()=>{if(!saving)setForm(null);}}><form className="gridForm" onSubmit={async e=>{
      e.preventDefault();if(saving)return;setSaving(true);setError('');
      try{if(form.id)await api.put(`/accounts/${form.id}`,form);else await api.post('/accounts',form);
        if(form.id && String(form.id)===String(user.id)) {window.location.assign('/login');return;}
        setForm(null);await load();}
      catch(err){setError(err.message);}finally{setSaving(false);}
    }}>{error&&<div className="error">{error}</div>}
      <label>اسم المستخدم<input required autoComplete="off" value={form.username} onChange={e=>setForm(s=>({...s,username:e.target.value}))}/></label>
      <label>كلمة المرور {form.id?'(اتركها فارغة للإبقاء عليها)':''}<input type="password" minLength="8" required={!form.id} autoComplete="new-password" value={form.password} onChange={e=>setForm(s=>({...s,password:e.target.value}))}/></label>
      <select value={form.role} onChange={e=>setForm(s=>({...s,role:e.target.value}))}><option value="user">مستخدم</option><option value="admin">مدير</option></select>
      <label><input type="checkbox" checked={form.active} onChange={e=>setForm(s=>({...s,active:e.target.checked}))}/> حساب فعال</label>
      <button disabled={saving} className="primaryButton">حفظ</button></form></Modal>}
  </div>;
}
