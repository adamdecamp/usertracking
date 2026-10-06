import {canonicalArtifactKind} from './filename-utils.ts';

export const annualRevalidationKinds=[
 'DoD Cyber Cert',
 'User Agreement',
 '8140 Cert Memo',
 'Privileged User Training Cert',
 'DTA Training',
] as const;

const annualRevalidationKindSet=new Set<string>(annualRevalidationKinds);

export function isAnnualRevalidationRequirement(kind:string){
 return annualRevalidationKindSet.has(canonicalArtifactKind(kind));
}

export function requirementDueDate(kind:string,evidenceDate:Date){
 if(!isAnnualRevalidationRequirement(kind))return;
 const due=new Date(evidenceDate);
 due.setUTCFullYear(due.getUTCFullYear()+1);
 return due;
}

export function evidenceStatusAt(kind:string,evidenceDate:Date,asOf:Date):'Current'|'Overdue'{
 const due=requirementDueDate(kind,evidenceDate);
 return due&&due<asOf?'Overdue':'Current';
}

export function evidenceDaysOverdue(kind:string,evidenceDate:Date,asOf:Date){
 const due=requirementDueDate(kind,evidenceDate);
 return due&&due<asOf?Math.max(1,Math.ceil((asOf.getTime()-due.getTime())/86400000)):0;
}

export function evidenceDaysUntilDue(kind:string,evidenceDate:Date,asOf:Date){
 const due=requirementDueDate(kind,evidenceDate);
 if(!due||due<asOf)return;
 const days=Math.ceil((due.getTime()-asOf.getTime())/86400000);
 return days<=30?days:undefined;
}
