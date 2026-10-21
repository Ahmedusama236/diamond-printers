// Local-only integration harness. The preview server supplies a synthetic PNG.
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SerialScanner} from '../../client/src/SerialScanner';
import '../../client/src/styles.css';
import '../../client/src/modern.css';
function TestModal({title,children,onClose}){return <div className="modalBackdrop"><div className="modalCard" role="dialog" aria-label={title}><div className="modalHeader"><h3>{title}</h3><button type="button" onClick={onClose}>إغلاق الاختبار</button></div><div className="modalBody">{children}</div></div></div>;}
function Test(){
 const [file,setFile]=useState(null),[serial,setSerial]=useState(''),[open,setOpen]=useState(true),[error,setError]=useState('');
 useEffect(()=>{fetch('/fixtures/serial-report-test.png').then(response=>{if(!response.ok)throw new Error('Missing local fixture');return response.blob();}).then(blob=>setFile(new File([blob],'report.png',{type:'image/png'}))).catch(e=>setError(e.message));},[]);
 return <main style={{padding:30}}><h1>اختبار قراءة السريل — بيانات تجريبية</h1>{error&&<p role="alert">{error}</p>}<label>السريل الناتج<input aria-label="السريل الناتج" value={serial} readOnly/></label>{file&&open&&<SerialScanner Modal={TestModal} initialFile={file} onClose={()=>setOpen(false)} onConfirm={value=>{setSerial(value);setOpen(false);}}/>}</main>;
}
createRoot(document.getElementById('root')).render(<Test/>);
