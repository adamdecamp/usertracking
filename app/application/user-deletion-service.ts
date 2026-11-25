export type DeletedEvidenceMove={destination:string};

/**
 * The audit line for a finished deletion. With `queued`, the record was removed
 * and its files wait for Session Commit, which writes its own line when it
 * archives them; otherwise it describes files that were already archived.
 */
export function formatDeleteUserCompletionAudit(input:{last:string;first:string;justification:string;moved:DeletedEvidenceMove[];missingErrors:string[];queued?:number}){
 if(input.queued!==undefined)return `DELETE USER COMPLETE: ${input.last}, ${input.first}; removed User Directory record; ${input.queued} associated evidence record${input.queued===1?'':'s'} and any other active files for this user queued for the organization Archive at the next Session Commit; justification ${input.justification}`;
 const movedCount=input.moved.length,missingCount=input.missingErrors.length;
 return `DELETE USER COMPLETE: ${input.last}, ${input.first}; removed User Directory record after archiving ${movedCount} associated evidence file${movedCount===1?'':'s'}; ${missingCount} already-missing evidence reference${missingCount===1?' was':'s were'} logged without blocking deletion; missing evidence ${input.missingErrors.join(' | ')||'none'}; justification ${input.justification}; archived paths ${input.moved.map(item=>item.destination).join(', ')||'none'}`;
}
