import {canonicalArtifactKind} from './filename-utils.ts';
import {dayNumberOfUtcDate,fallbackTimeZone,localDayNumber} from './compliance-time-zone.ts';

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

/** The calendar due date (stored as UTC midnight) one year after the evidence date. */
export function requirementDueDate(kind:string,evidenceDate:Date){
 if(!isAnnualRevalidationRequirement(kind))return;
 const due=new Date(evidenceDate);
 due.setUTCFullYear(due.getUTCFullYear()+1);
 return due;
}

/**
 * Days from today to the due date in the system's time zone: 0 on the due
 * date, negative once overdue. Undefined for evidence that never expires.
 */
function daysToDue(kind:string,evidenceDate:Date,asOf:Date,timeZone:string){
 const due=requirementDueDate(kind,evidenceDate);
 return due?dayNumberOfUtcDate(due)-localDayNumber(asOf,timeZone):undefined;
}

/** Evidence stays Current through its due date and is Overdue from the next local day. */
export function evidenceStatusAt(kind:string,evidenceDate:Date,asOf:Date,timeZone=fallbackTimeZone()):'Current'|'Overdue'{
 const days=daysToDue(kind,evidenceDate,asOf,timeZone);
 return days!==undefined&&days<0?'Overdue':'Current';
}

export function evidenceDaysOverdue(kind:string,evidenceDate:Date,asOf:Date,timeZone=fallbackTimeZone()){
 const days=daysToDue(kind,evidenceDate,asOf,timeZone);
 return days!==undefined&&days<0?-days:0;
}

/** Days until due when within 30 days (0 means due today); otherwise undefined. */
export function evidenceDaysUntilDue(kind:string,evidenceDate:Date,asOf:Date,timeZone=fallbackTimeZone()){
 const days=daysToDue(kind,evidenceDate,asOf,timeZone);
 return days!==undefined&&days>=0&&days<=30?days:undefined;
}
