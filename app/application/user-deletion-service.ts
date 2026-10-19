export type DeletedEvidenceMove={destination:string};

export function formatDeleteUserCompletionAudit(input:{last:string;first:string;justification:string;moved:DeletedEvidenceMove[];missingErrors:string[]}){
 const movedCount=input.moved.length,missingCount=input.missingErrors.length;
 return `DELETE USER COMPLETE: ${input.last}, ${input.first}; removed User Directory record after archiving ${movedCount} associated evidence file${movedCount===1?'':'s'}; ${missingCount} already-missing evidence reference${missingCount===1?' was':'s were'} logged without blocking deletion; missing evidence ${input.missingErrors.join(' | ')||'none'}; justification ${input.justification}; archived paths ${input.moved.map(item=>item.destination).join(', ')||'none'}`;
}
