import type {ComplianceStatus} from './compliance-report.ts';
import {evidenceDaysOverdue,evidenceDaysUntilDue,evidenceStatusAt} from './compliance-rules.ts';
import {complianceTimeZoneFor} from './compliance-time-zone.ts';
import {acceptsEvidenceExtension} from './evidence-validation.ts';
import {canonicalArtifactKind,disabledSaarFilename,evidenceDateIsInFuture,filenameMatchesKind,parseDate} from './filename-utils.ts';
import type {UserRecord} from './domain/tracker-models.ts';
import {requiredKindsForUser} from './user-requirements.ts';
import {activeComplianceException} from './workflow-utils.ts';

/** Newest evidence of `kind` by filename date. Future-dated files (typos such as 2099) never count. */
export function newestMatch<T>(items:T[],kind:string,nameOf:(item:T)=>string,now=new Date()){let match:T|undefined,newest=-Infinity;for(const item of items){const name=nameOf(item);if(!filenameMatchesKind(name,kind))continue;const date=parseDate(name),time=date?.getTime();if(date&&time!==undefined&&!evidenceDateIsInFuture(date,now)&&time>newest){match=item;newest=time}}return match}
export function newestArtifactFor(user:UserRecord,kind:string){return newestMatch(user.artifacts.filter(artifact=>canonicalArtifactKind(artifact.kind)===kind&&acceptsEvidenceExtension(artifact.filename)&&(kind!=='SAAR'||user.disabled||!disabledSaarFilename(artifact.filename))),kind,artifact=>artifact.filename)}
/** Due dates follow the time zone recorded on the user's information system. */
const zoneFor=(user:UserRecord)=>complianceTimeZoneFor(user.systemId);
export function statusFor(user:UserRecord,kind:string,asOf=new Date()):ComplianceStatus{const artifact=newestArtifactFor(user,kind),date=artifact&&parseDate(artifact.filename);return date?evidenceStatusAt(kind,date,asOf,zoneFor(user)):'Missing'}
export function daysOverdueFor(user:UserRecord,kind:string,asOf:Date){const artifact=newestArtifactFor(user,kind),date=artifact&&parseDate(artifact.filename);return date?evidenceDaysOverdue(kind,date,asOf,zoneFor(user)):0}
export function daysUntilDueFor(user:UserRecord,kind:string,asOf:Date){const artifact=newestArtifactFor(user,kind),date=artifact&&parseDate(artifact.filename);return date?evidenceDaysUntilDue(kind,date,asOf,zoneFor(user)):undefined}
export function isDueWithin30Days(user:UserRecord,kind:string,asOf=new Date()){return statusFor(user,kind,asOf)==='Current'&&daysUntilDueFor(user,kind,asOf)!==undefined}
export function directoryStatusFor(user:UserRecord,kind:string,asOf:Date){return isDueWithin30Days(user,kind,asOf)?'Due Within 30 Days':statusFor(user,kind,asOf)}
export const exceptionFor=(user:UserRecord,kind:string,asOf=new Date())=>activeComplianceException(user.exceptions,kind,asOf,zoneFor(user));
export const needsElevatedRole=(roles:string[])=>roles.includes('Privileged');
export const requiredKinds=(user:UserRecord)=>requiredKindsForUser(user);
