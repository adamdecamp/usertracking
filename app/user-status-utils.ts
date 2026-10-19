import type {ComplianceStatus} from './compliance-report';
import {evidenceDaysOverdue,evidenceDaysUntilDue,evidenceStatusAt} from './compliance-rules';
import {acceptsEvidenceExtension} from './evidence-validation';
import {canonicalArtifactKind,disabledSaarFilename,filenameIdentityMatches,filenameMatchesKind,parseDate} from './filename-utils';
import type {UserRecord} from './domain/tracker-models';
import {requiredKindsForUser} from './user-requirements';
import {activeComplianceException} from './workflow-utils';

export function newestMatch<T>(items:T[],kind:string,nameOf:(item:T)=>string){let match:T|undefined,newest=-Infinity;for(const item of items){const name=nameOf(item);if(!filenameMatchesKind(name,kind))continue;const time=parseDate(name)?.getTime();if(time!==undefined&&time>newest){match=item;newest=time}}return match}
export function newestArtifactFor(user:UserRecord,kind:string){return newestMatch(user.artifacts.filter(artifact=>canonicalArtifactKind(artifact.kind)===kind&&acceptsEvidenceExtension(artifact.filename)&&(kind!=='SAAR'||user.disabled||!disabledSaarFilename(artifact.filename))&&(user.disabled||kind==='SAAR'||filenameIdentityMatches(artifact.filename,user))),kind,artifact=>artifact.filename)}
export function statusFor(user:UserRecord,kind:string,asOf=new Date()):ComplianceStatus{const artifact=newestArtifactFor(user,kind),date=artifact&&parseDate(artifact.filename);return date?evidenceStatusAt(kind,date,asOf):'Missing'}
export function daysOverdueFor(user:UserRecord,kind:string,asOf:Date){const artifact=newestArtifactFor(user,kind),date=artifact&&parseDate(artifact.filename);return date?evidenceDaysOverdue(kind,date,asOf):0}
export function daysUntilDueFor(user:UserRecord,kind:string,asOf:Date){const artifact=newestArtifactFor(user,kind),date=artifact&&parseDate(artifact.filename);return date?evidenceDaysUntilDue(kind,date,asOf):undefined}
export function isDueWithin30Days(user:UserRecord,kind:string,asOf=new Date()){return statusFor(user,kind,asOf)==='Current'&&daysUntilDueFor(user,kind,asOf)!==undefined}
export function directoryStatusFor(user:UserRecord,kind:string,asOf:Date){return isDueWithin30Days(user,kind,asOf)?'Due Within 30 Days':statusFor(user,kind,asOf)}
export const exceptionFor=(user:UserRecord,kind:string,asOf=new Date())=>activeComplianceException(user.exceptions,kind,asOf);
export const needsElevatedRole=(roles:string[])=>roles.includes('Privileged');
export const requiredKinds=(user:UserRecord)=>requiredKindsForUser(user);
