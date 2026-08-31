const clean=(value:string,max=500)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

export function errorDetail(error:unknown,fallback='An unexpected error occurred.'){
 if(error instanceof Error)return clean(`${error.name&&error.name!=='Error'?`${error.name}: `:''}${error.message||fallback}`)||fallback;
 if(typeof error==='string')return clean(error)||fallback;
 return fallback;
}

export function errorAuditAction(context:string,detail:string){return`ERROR: ${clean(context,160)}; details ${clean(detail,300)}`}

export function detailedErrorMessage(context:string,detail:string,audit:'recorded'|'unavailable'|'failed',auditDetail=''){
 const auditText=audit==='recorded'?'Recorded in the mapped system audit log.':audit==='failed'?`The audit entry could not be written or verified; stop making changes and verify storage.${auditDetail?` Audit failure details: ${clean(auditDetail,300)}`:''}`:'No mapped system audit log was available.';
 return`${context}\n\nDetails: ${detail}\n\nAudit: ${auditText}`;
}
