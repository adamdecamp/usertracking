export const operatorFullNameLimit=100;

export function normalizeOperatorFullName(value:string){
 return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
}

export function validateOperatorFullName(value:string){
 const normalized=normalizeOperatorFullName(value);
 if(normalized.length<2)return{valid:false as const,value:normalized,error:'Enter your full name.'};
 if(normalized.length>operatorFullNameLimit)return{valid:false as const,value:normalized,error:`Full Name must be ${operatorFullNameLimit} characters or fewer.`};
 if(!/[\p{L}\p{M}]/u.test(normalized))return{valid:false as const,value:normalized,error:'Full Name must include letters.'};
 return{valid:true as const,value:normalized,error:''};
}

export function operatorIdentityLabel(windowsUser:string,fullName?:string){
 const alias=windowsUser.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()||'Browser Session (Unverified)',name=normalizeOperatorFullName(fullName??'');
 return name?`${name} (${alias})`:alias;
}
