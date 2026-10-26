export const deliveryMethods={damietta:'تسليم من محل دمياط الجديدة',mansoura:'تسليم من مكتب المنصورة',shipping:'شحن'};
export function deliveryValue(value,current=null){const chosen=value===undefined?current:value;if(chosen==null||chosen==='')return null;if(!Object.hasOwn(deliveryMethods,chosen))throw new Error('اختار طريقة تسليم صحيحة');return chosen;}
export function giftValue(value){if(value===undefined||value===null)return false;if(typeof value!=='boolean')throw new Error('اختيار الهدية غير صحيح');return value;}
export function toggleGift(line,field='unit_price'){return line.is_gift?{...line,is_gift:false,[field]:line._paid_price??''}:{...line,is_gift:true,_paid_price:line[field]??'',[field]:0};}
