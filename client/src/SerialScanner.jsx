import {createPortal} from 'react-dom';
import {useEffect,useRef,useState} from 'react';
import {extractSerialCandidates,stopCamera,cameraErrorMessage} from './serialRecognition';
import './serialScanner.css';

function CameraIcon(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4v14H4z"/><circle cx="12" cy="12" r="4"/></svg>;}
function ImageIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg>;}

export function SerialScannerButton({Modal,onDetected,disabled=false}){
 const [session,setSession]=useState(null),fileInput=useRef(null);
 return <>
  <button type="button" className="serialCameraButton" disabled={disabled} title="قراءة السريل بالكاميرا" aria-label="قراءة السريل بالكاميرا" onClick={()=>setSession({file:null})}><CameraIcon/></button>
  <button type="button" className="serialImageButton" disabled={disabled} title="قراءة السريل من صورة" aria-label="قراءة السريل من صورة" onClick={()=>fileInput.current?.click()}><ImageIcon/></button>
  <input className="serialFileInput" ref={fileInput} type="file" accept="image/*" aria-label="اختر صورة لسريل الطابعة" tabIndex={-1} onChange={event=>{const file=event.target.files?.[0];if(file)setSession({file});event.target.value='';}}/>
  {session&&createPortal(<SerialScanner Modal={Modal} initialFile={session.file} onClose={()=>setSession(null)} onConfirm={value=>{onDetected(value);setSession(null);}}/>,document.body)}
 </>;
}

async function fileCanvas(file){
 if(file.size>20*1024*1024)throw new Error('حجم الصورة كبير. اختر صورة أصغر من 20 ميجابايت.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;await image.decode();
  return drawImage(image,image.naturalWidth,image.naturalHeight);
 }catch(error){if(error.message.includes('20 ميجابايت'))throw error;throw new Error('تعذر فتح الصورة. استخدم صورة JPG أو PNG واضحة.');}
 finally{URL.revokeObjectURL(url);}
}
function drawImage(source,width,height){
 if(!width||!height)throw new Error('الصورة غير جاهزة. حاول مرة أخرى.');
 const scale=Math.min(2200/Math.max(width,height),width<1000?2:1);
 const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
 const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
 context.drawImage(source,0,0,canvas.width,canvas.height);return canvas;
}

export function SerialScanner({Modal,initialFile,onClose,onConfirm}){
 const [ready,setReady]=useState(false),[starting,setStarting]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[stage,setStage]=useState('');
 const [error,setError]=useState(''),[preview,setPreview]=useState(''),[candidates,setCandidates]=useState([]),[result,setResult]=useState(''),[readDone,setReadDone]=useState(false);
 const video=useRef(null),stream=useRef(null),worker=useRef(null),pendingWorker=useRef(null),life=useRef(0),cameraRequest=useRef(0),operation=useRef(false),upload=useRef(null),lastImage=useRef(null);
 const active=id=>life.current===id;
 const stop=()=>{cameraRequest.current++;stopCamera(stream.current);stream.current=null;};
 async function camera(id=life.current){
  if(operation.current||starting)return;
  stop();const request=cameraRequest.current;lastImage.current=null;setReady(false);setPreview('');setResult('');setCandidates([]);setReadDone(false);setError('');setStarting(true);
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
   const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
   if(!active(id)||cameraRequest.current!==request){stopCamera(media);return;}
   stream.current=media;if(video.current){video.current.srcObject=media;await video.current.play();}
   if(active(id)&&cameraRequest.current===request)setReady(true);
  }catch(e){if(active(id)&&cameraRequest.current===request){stopCamera(stream.current);stream.current=null;setError(cameraErrorMessage(e));}}
  finally{if(active(id)&&cameraRequest.current===request)setStarting(false);}
 }
 async function recognize(image,id){
  lastImage.current=image;setPreview(image.toDataURL('image/jpeg',.92));stop();setReady(false);setStage('جارٍ تجهيز قارئ النصوص…');
  if(!worker.current){
   const {createWorker}=await import('tesseract.js');
   if(!active(id))return;
   const initializing=createWorker('eng',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core',langPath:'/ocr/lang',workerBlobURL:false,logger:message=>{
    if(!active(id))return;
    if(message.status==='recognizing text'){setStage('جارٍ قراءة سطر السريل…');setProgress(Math.round((message.progress||0)*100));}
   },errorHandler:()=>{}});
   pendingWorker.current=initializing;
   const engine=await initializing;
   if(!active(id)){await engine.terminate();return;}
   worker.current=engine;pendingWorker.current=null;
  }
  await worker.current.setParameters({tessedit_pageseg_mode:'3',preserve_interword_spaces:'1',user_defined_dpi:'300'});
  const first=await worker.current.recognize(image);
  if(!active(id))return;
  let found=extractSerialCandidates(first.data.text);
  if(!found.length){
   await worker.current.setParameters({tessedit_pageseg_mode:'6'});
   const second=await worker.current.recognize(image);
   if(!active(id))return;
   found=extractSerialCandidates(second.data.text);
  }
  setCandidates(found);setResult(found[0]||'');setReadDone(true);setProgress(100);
  if(!found.length)setError('لم أجد سريل واضحًا. صوّر سطر Serial Number عن قرب وبإضاءة جيدة، أو اكتبه يدويًا.');
 }
 async function scan(source,id=life.current){
  if(operation.current)return;operation.current=true;stop();setReady(false);setStarting(false);setBusy(true);setError('');setProgress(0);setReadDone(false);setResult('');setCandidates([]);
  try{const image=source instanceof File?await fileCanvas(source):source;if(active(id))await recognize(image,id);}
  catch(e){if(active(id)){worker.current?.terminate().catch(()=>{});worker.current=null;pendingWorker.current=null;setError(e.message?.includes('الصورة')||e.message?.includes('ميجابايت')?e.message:'تعذرت قراءة الصورة. أعد المحاولة أو أدخل السريل يدويًا.');}}
  finally{if(active(id)){operation.current=false;setBusy(false);}}
 }
 useEffect(()=>{
  const id=++life.current;
  if(initialFile)scan(initialFile,id);else camera(id);
  return()=>{
   life.current++;operation.current=false;stop();
   worker.current?.terminate().catch(()=>{});worker.current=null;
   pendingWorker.current?.then(engine=>engine.terminate()).catch(()=>{});pendingWorker.current=null;
  };
 },[]);
 return <Modal title="قراءة سريل الطابعة" onClose={onClose}>
  <div className="serialScanner">
   <p className="serialInstructions">وجّه الكاميرا إلى سطر <b dir="ltr">Serial Number</b> بالكامل، ثم اضغط «التقاط وقراءة».</p>
   <p className="serialPrivacy">الصورة تُقرأ على جهازك، ولا تُرفع أو تُحفظ مع الفاتورة.</p>
   <div className="serialViewfinder">
    {preview?<img src={preview} alt="الصورة المستخدمة لقراءة السريل"/>:<><video ref={video} autoPlay muted playsInline aria-label="معاينة كاميرا السريل"/>{ready&&<div className="serialGuide" aria-hidden="true"><span>Serial Number</span></div>}{!ready&&<div className="serialCameraPlaceholder"><CameraIcon/><span>{starting?'جارٍ فتح الكاميرا…':'اختر صورة أو شغّل الكاميرا'}</span></div>}</>}
   </div>
   {busy&&<div className="serialProgress" role="status"><span>{stage||'جارٍ تجهيز الصورة…'}</span><progress max="100" value={progress} aria-label="تقدم قراءة السريل"/></div>}
   {error&&<div className="error" role="alert">{error}</div>}
   <div className="serialScanActions">
    {ready&&<button type="button" className="primaryButton" disabled={busy} onClick={()=>{try{const source=video.current;if(!source)throw new Error('الكاميرا غير جاهزة. حاول مرة أخرى.');scan(drawImage(source,source.videoWidth,source.videoHeight));}catch(e){setError(e.message);}}}>التقاط وقراءة</button>}
    {!ready&&<button type="button" disabled={busy||starting} onClick={()=>camera()}>{preview?'إعادة التصوير':'تشغيل الكاميرا'}</button>}
    <button type="button" disabled={busy} onClick={()=>upload.current?.click()}>اختيار صورة من الجهاز</button>
    {lastImage.current&&!busy&&error&&<button type="button" onClick={()=>scan(lastImage.current)}>إعادة القراءة</button>}
    <input ref={upload} className="serialFileInput" type="file" accept="image/*" aria-label="اختيار صورة أخرى للسريل" onChange={event=>{const file=event.target.files?.[0];if(file)scan(file);event.target.value='';}}/>
   </div>
   {readDone&&!busy&&<div className="serialDetected"><h4>{candidates.length?'السريل المقروء':'إدخال السريل يدويًا'}</h4><p>راجع الحروف والأرقام قبل اعتمادها، خصوصًا 0 وO أو 1 وI.</p>
    {candidates.length>1&&<div className="serialCandidates">{candidates.map(value=><button type="button" key={value} onClick={()=>setResult(value)} dir="ltr">{value}</button>)}</div>}
    <label>السريل نامبر<input type="text" dir="ltr" value={result} onChange={event=>setResult(event.target.value)} autoComplete="off" spellCheck={false} autoFocus/></label>
    <button type="button" className="primaryButton" data-form-action="serial" disabled={!result.trim()} onClick={()=>onConfirm(result.trim())}>استخدام هذا السريل</button>
   </div>}
  </div>
 </Modal>;
}
