const code = value => {
  const text=String(value||'').normalize('NFKC').toUpperCase().replace(/[\s:：]+/g,'').replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g,'');
  return /^[A-Z0-9][A-Z0-9-]{5,29}$/.test(text)&&/[A-Z]/.test(text)&&/[0-9]/.test(text)?text:null;
};
const hpCodes=text=>Array.from(text.toUpperCase().matchAll(/\bCN(?:[ \t]*[A-Z0-9]){8}\b/g),m=>m[0].replace(/[ \t]/g,''));

export function extractSerialCandidates(rawText) {
  const text=String(rawText||'').normalize('NFKC').replace(/\r/g,'');
  const lines=text.split('\n'),found=[];
  const add=value=>{if(value&&!found.includes(value))found.push(value);};
  for(let i=0;i<lines.length;i++){
    const match=lines[i].match(/\b(?:serial\s*(?:number|nurnber|numher|no\.?|#)|s\s*\/\s*n)\s*[:：#=.-]?\s*(.*)$/i);
    if(!match)continue;
    let fragment=match[1].trim();
    if(!fragment)fragment=(lines[i+1]||'').trim();
    if(/^\d+\.\s*(?:product|service|model|printer|firmware)/i.test(fragment))continue;
    const specific=hpCodes(fragment);
    if(specific.length)specific.forEach(add);
    else{
      const tokens=fragment.split(/[\s,;|]+/).map(code).filter(Boolean);
      // Avoid guessing a product/firmware number from another report field.
      if(tokens.length===1)add(tokens[0]);
    }
  }
  if(found.length)return found.slice(0,5);
  hpCodes(text).forEach(add);
  if(!found.length&&/^[A-Z0-9-]{6,30}$/i.test(text.trim()))add(code(text));
  return found.slice(0,5);
}

export function stopCamera(stream) {
  stream?.getTracks?.().forEach(track=>track.stop());
}

export function cameraErrorMessage(error) {
  if(['NotAllowedError','PermissionDeniedError'].includes(error?.name))return 'السماح بالكاميرا مرفوض. اسمح بها من إعدادات المتصفح، أو اختر صورة من الجهاز.';
  if(error?.name==='NotFoundError')return 'لم يتم العثور على كاميرا. يمكنك اختيار صورة من الجهاز.';
  if(error?.name==='NotReadableError')return 'الكاميرا مستخدمة في تطبيق آخر. أغلقه وحاول مجددًا، أو اختر صورة.';
  return 'تعذر تشغيل الكاميرا. يمكنك اختيار صورة واضحة لسطر Serial Number من الجهاز.';
}
