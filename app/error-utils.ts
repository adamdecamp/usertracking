const clean=(value:string,max=500)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

export const oneLineText=(value:string)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,500);
export const errorReportText=(value:string)=>value.replace(/\u0000/g,' ').replace(/\r\n?/g,'\n').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').trim().slice(0,64*1024);

export function errorReportDetail(error:unknown,fallback='An unexpected error occurred.'){
 if(error instanceof Error){const summary=`${error.name||'Error'}: ${error.message||fallback}`,stack=error.stack&&!error.stack.startsWith(summary)?error.stack:'';return errorReportText([summary,stack].filter(Boolean).join('\n'))||fallback}
 if(typeof error==='string')return errorReportText(error)||fallback;
 try{return errorReportText(JSON.stringify(error,null,2))||fallback}catch{return fallback}
}

export function errorDetail(error:unknown,fallback='An unexpected error occurred.'){
 if(error instanceof Error)return clean(`${error.name&&error.name!=='Error'?`${error.name}: `:''}${error.message||fallback}`)||fallback;
 if(typeof error==='string')return clean(error)||fallback;
 return fallback;
}

export function isMissingEvidenceError(error:unknown){
 const detail=errorDetail(error,'').toLowerCase();
 return /(?:filenotfoundexception|notfounderror|no longer exists|does not exist|could not be located|cannot find (?:the )?(?:file|path)|could not find (?:the )?(?:file|path|a part of the path)|path not found|file not found)/.test(detail);
}

export function errorAuditAction(context:string,detail:string){return`ERROR: ${clean(context,160)}; details ${clean(detail,300)}`}

export function detailedErrorMessage(context:string,detail:string,audit:'recorded'|'unavailable'|'failed',auditDetail=''){
 const auditText=audit==='recorded'?'Recorded in the mapped system audit log.':audit==='failed'?`The audit entry could not be written or verified; stop making changes and verify storage.${auditDetail?` Audit failure details: ${clean(auditDetail,300)}`:''}`:'No mapped system audit log was available.';
 return`${context}\n\nDetails: ${detail}\n\nAudit: ${auditText}`;
}
