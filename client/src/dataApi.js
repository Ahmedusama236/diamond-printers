const inFlight = new Map();
const reads = new Map();
const requestIds = new Map();
let generation = 0;
let writeQueue = Promise.resolve();

function failure(status, message) {
  const error = new Error(message); error.status = status; return error;
}
async function send(url, payload) {
  const response = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result = await response.json().catch(()=>({}));
  if (!response.ok) {
    if(response.status===401)window.dispatchEvent(new Event('diamond:session-expired'));
    let message=result.error || 'تعذر إتمام الطلب، حاول مرة أخرى';
    if(document.documentElement.lang==='ar'){
      const translations={'Insufficient finished product stock. Available:':'رصيد المنتج غير كافٍ. المتاح:','Insufficient component stock. Available:':'رصيد المكون غير كافٍ. المتاح:','Insufficient stock for component:':'المخزون غير كافٍ للمكون:','Insufficient component stock':'مخزون المكون غير كافٍ','Product does not have BOM items':'أضف مكونات المنتج قبل إتمام العملية','Component stock must be zero before deletion':'يجب أن يكون مخزون المكون صفرًا قبل حذفه','Finished stock must be zero before deleting product':'يجب أن يكون مخزون المنتج صفرًا قبل حذفه'};
      for(const [source,target] of Object.entries(translations))message=message.replace(source,target);
    }
    throw failure(response.status,message);
  }
  return result;
}
async function execute(path, options, requestId) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  if (path.startsWith('/auth/')) {
    const result = await send('/api/auth',{...body,action:path.split('/')[2]});
    if(path!=='/auth/status'){reads.clear();generation++;}
    return result;
  }
  if (path.startsWith('/accounts')) {
    const result=await send('/api/auth',{...body,action:method==='GET'?'list':method==='PUT'?'update':'create',id:path.split('/')[2]});
    return method==='GET'?result.users:result;
  }
  return (await send('/api/data',{action:'business',path,method,body,request_id:requestId})).data;
}
export function request(path, options = {}) {
  const method=(options.method || 'GET').toUpperCase();
  if(method!=='GET') {
    const key=method+path+(options.body||'');
    if(inFlight.has(key))return inFlight.get(key);
    if(!requestIds.has(key))requestIds.set(key,crypto.randomUUID());
    const requestId=requestIds.get(key);
    const operation=writeQueue.then(async()=>{
      generation++;reads.clear();
      try{const result=await execute(path,options,requestId);requestIds.delete(key);return result;}
      finally{generation++;reads.clear();window.dispatchEvent(new Event('diamond:data-changed'));}
    });
    writeQueue=operation.catch(()=>{});
    inFlight.set(key,operation);
    operation.finally(()=>inFlight.delete(key)).catch(()=>{});
    return operation;
  }
  const existing=reads.get(path);
  if(existing && existing.generation===generation && Date.now()-existing.at<2000)return existing.promise;
  const promise=execute(path,options);
  const entry={promise,at:Date.now(),generation};reads.set(path,entry);
  promise.catch(()=>{if(reads.get(path)===entry)reads.delete(path);});
  return promise;
}
