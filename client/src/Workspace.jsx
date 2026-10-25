import {useEffect,useState} from 'react';
import {paths,navigate} from './navigation';

const groups=[
  {label:['الرئيسية','Workspace'],items:[['dashboard','لوحة التحكم','Overview','grid']]},
  {label:['البيع','Sales'],items:[['sales','المبيعات والتحصيل','Sales & payments','receipt']]},
  {label:['المخزون والمشتريات','Inventory & purchasing'],items:[['components','المكونات والمخزون','Components & stock','box'],['purchases','المشتريات','Purchases','cart'],['suppliers','الموردون','Suppliers','users'],['shortage','النواقص','Shortages','alert'],['damaged','التالف','Damaged items','box']]},
  {label:['الإنتاج والخدمة','Production & service'],items:[['productsBom','المنتجات ومكوناتها','Products & materials','layers'],['manufacturing','التصنيع','Manufacturing','tool'],['maintenance','الصيانة','Maintenance','tool']]},
  {label:['الإدارة','Management'],items:[['reports','التقارير','Reports','chart'],['settings','الإعدادات','Settings','settings']]},
];
export function Icon({name='grid',size=20}) {
 const shapes={grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,receipt:<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/></>,printer:<><path d="M7 8V3h10v5M7 17H4V9h16v8h-3"/><path d="M7 14h10v7H7zM16 11h1"/></>,box:<><path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7 5l10 4"/></>,cart:<><path d="M3 3h2l3 12h10l3-9H6M9 20h.01M18 20h.01"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,users:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5"/></>,alert:<><path d="m12 3 10 18H2zM12 9v5M12 17v.1"/></>,layers:<><path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/></>,tool:<><path d="m14 7 3 3 4-4a7 7 0 0 1-9 9l-6 6-3-3 6-6a7 7 0 0 1 9-9z"/></>,chart:<><path d="M3 3v18h18M7 16v-4M12 16V7M17 16v-7"/></>,settings:<><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></>,menu:<path d="M4 6h16M4 12h16M4 18h16"/>,plus:<path d="M12 5v14M5 12h14"/>,search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,arrow:<path d="m14 6-6 6 6 6"/>,close:<path d="m6 6 12 12M6 18 18 6"/>};
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]||shapes.grid}</svg>;
}
export function WorkspaceNavigation({activeTab,language,shortageCount=0}) {
 const [open,setOpen]=useState(false),[collapsed,setCollapsed]=useState(false),[q,setQ]=useState('');
 const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width:800px)').matches);
 useEffect(()=>{const query=window.matchMedia('(max-width:800px)');const update=()=>setMobile(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 const ar=language==='ar';
 if(['printers','productSales','spareSales'].includes(activeTab))activeTab='sales';
 useEffect(()=>{setOpen(false);},[activeTab]);
 useEffect(()=>{if(!open)return;const close=e=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[open]);
 const navItem=([key,arabic,english,icon])=><a key={key} href={paths[key]} title={ar?arabic:english} aria-current={(activeTab===key||(key==='components'&&activeTab==='inventory'))?'page':undefined} className={'workspaceLink '+((activeTab===key||(key==='components'&&activeTab==='inventory'))?'selected':'')} onClick={e=>{if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();navigate(paths[key]);setOpen(false);}}}><Icon name={icon}/><span>{ar?arabic:english}</span>{key==='shortage'&&shortageCount>0&&<b>{shortageCount}</b>}</a>;
 return <>
  {open&&<div className="navigationShade" onClick={()=>setOpen(false)}/>}
  <aside inert={mobile&&!open?'':undefined} aria-hidden={mobile&&!open?true:undefined} className={'workspaceSidebar '+(open?'isOpen ':'')+(collapsed?'isCollapsed':'')} aria-label={ar?'التنقل الرئيسي':'Main navigation'}>
   <div className="sidebarBrand"><img src="/diamond-logo.png" alt="Diamond for Printer Solutions"/><button className="iconButton" onClick={()=>{setCollapsed(!collapsed);setOpen(false);}} aria-label={ar?'تصغير القائمة':'Collapse navigation'}><Icon name="menu"/></button></div>
   <div className="sidebarCaption">{ar?'إدارة أعمالك، ببساطة':'Your business, organized'}</div>
   <label className="navigationSearch"><Icon name="search"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder={ar?'ابحث عن قسم…':'Find a section…'} aria-label={ar?'ابحث عن قسم':'Find a section'}/></label>
   <nav>{groups.map(group=><div className="navigationGroup" key={group.label[1]}><h2>{group.label[ar?0:1]}</h2>{group.items.filter(item=>(ar?item[1]:item[2]).toLowerCase().includes(q.toLowerCase())).map(navItem)}</div>)}</nav>
   <div className="sidebarFooter"><span className="statusDot"/>{ar?'دايموند • مساحة العمل':'Diamond • Workspace'}</div>
  </aside>
  <nav className="mobileDock" aria-label={ar?'التنقل السريع':'Quick navigation'}>{[groups[0].items[0],groups[1].items[0],groups[3].items[2]].map(navItem)}<button className={open?'selected':''} onClick={()=>setOpen(!open)} aria-expanded={open}><Icon name="menu"/><span>{ar?'المزيد':'More'}</span></button></nav>
 </>;
}
export function PageIntro({activeTab,language,user}) {
 if(['printers','productSales','spareSales'].includes(activeTab))activeTab='sales';
 const item=groups.flatMap(g=>g.items).find(i=>i[0]===activeTab || (activeTab==='inventory'&&i[0]==='components'));
 const ar=language==='ar';
 return <div className="pageIntro"><div><p>{ar?'مساحة العمل / ':'Workspace / '}{item?.[ar?1:2]}</p><h1>{activeTab==='dashboard'?(ar?'كل أعمالك، في نظرة واحدة':'Your business at a glance'):item?.[ar?1:2]}</h1></div><div className="userPill"><span>{String(user?.username||'D').slice(0,1).toUpperCase()}</span><div><strong>{user?.username}</strong><small>{user?.role==='admin'?(ar?'مدير النظام':'Administrator'):(ar?'عضو الفريق':'Team member')}</small></div></div></div>;
}
