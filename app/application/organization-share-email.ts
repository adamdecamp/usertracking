import type {SystemRecord,UserRecord} from '../domain/tracker-models.ts';
import {filteredDirectoryCsvRows} from '../csv-utils.ts';
import {oneLineText as oneLine} from '../error-utils.ts';
import {canonicalArtifactKind} from '../filename-utils.ts';
import {outlookDraftSubject} from '../notification-utils.ts';
import {organizationStatusPackageFormat,organizationStatusPackageVersion,type OrganizationStatusPayload} from '../organization-status-package.ts';
import {applicationVersion,complianceRuleSetVersion} from '../version.ts';

export const shareFilePart=(value:string,maxLength=80)=>oneLine(value).replace(/[<>:"/\\|?*]/g,'_').replace(/[. ]+$/g,'').slice(0,maxLength)||'Unknown';
const day=(when:Date)=>when.toISOString().slice(0,10).replaceAll('-','');

/** The compliance spreadsheet for some organizations' active users, one row per user. */
export function organizationCsv(system:SystemRecord,activeUsers:readonly UserRecord[],organizations:readonly string[],asOf:Date){
 const result=filteredDirectoryCsvRows(activeUsers.filter(user=>!user.disabled&&organizations.includes(user.organization)),system,asOf),label=organizations.length===1?`${shareFilePart(organizations[0],60)}_`:'';
 return{...result,filename:`${shareFilePart(system.name,80)}_${label}Compliance_${day(asOf)}.csv`};
}

/** Subject and message for one organization's compliance spreadsheet. */
export function organizationCsvEmail(system:SystemRecord,organization:string,asOf:Date,rowCount:number,notCompliant:number){
 return{
  subject:outlookDraftSubject('For Review',system.name,'Compliance Spreadsheet',organization).slice(0,200),
  body:`Sir/Ma'am,\n\nAttached is the R.A.P.T.O.R. compliance spreadsheet for ${organization} on ${system.name} as of ${asOf.toISOString().slice(0,10)}. It lists ${rowCount} active user${rowCount===1?'':'s'}, one per row, with Compliance first so it can be filtered in Excel; ${notCompliant} ${notCompliant===1?'is':'are'} not compliant. Disabled users and other organizations are not included.\n\nPlease review any requirement shown as missing, due, or overdue and send updated documents to the system administration team. Contact us if a record appears incorrect.`,
 };
}

/** Everything an Organization Status File holds for one organization: its active and disabled users, without evidence files or paths. */
export function organizationStatusPayload(system:SystemRecord,users:readonly UserRecord[],organization:string,generatedAt=new Date()):OrganizationStatusPayload{
 const organizationUsers=users.filter(user=>user.organization===organization);
 if(!organization||!organizationUsers.length)throw new Error('Select an organization that has User Directory records.');
 return{format:organizationStatusPackageFormat,version:organizationStatusPackageVersion,generatedAtUtc:generatedAt.toISOString(),applicationVersion,ruleSetVersion:complianceRuleSetVersion,system:{id:system.id,name:system.name,type:system.type},organization,users:organizationUsers.map(user=>({id:user.id,last:user.last,first:user.first,middle:user.middle,email:user.email,disabled:user.disabled,roles:[...user.roles],privilegedTypes:[...user.privilegedTypes],artifacts:user.artifacts.map(artifact=>({kind:canonicalArtifactKind(artifact.kind),filename:artifact.filename})),exceptions:(user.exceptions??[]).filter(item=>!item.revokedAt).map(item=>({artifact:item.artifact,reason:item.reason,expiresOn:item.expiresOn}))}))};
}

export const organizationStatusFilename=(system:SystemRecord,organization:string,when=new Date())=>`${shareFilePart(system.name,60)}_${shareFilePart(organization,60)}_RAPTOR_Status_${day(when)}.raptor-status.json`;

/** Subject and message for one organization's Status File. */
export function organizationStatusEmail(system:SystemRecord,organization:string,counts:{total:number;active:number;disabled:number},generatedAt:string,encrypted:boolean){
 const protection=encrypted?' The attachment is passphrase-encrypted; provide the passphrase through a separate approved channel.':'';
 return{
  subject:outlookDraftSubject('For Review',system.name,'User Status Snapshot',organization),
  body:`Sir/Ma'am,\n\nAttached is the R.A.P.T.O.R. user-status snapshot for ${organization} on ${system.name}. It contains ${counts.total} user records (${counts.active} active and ${counts.disabled} disabled) and was generated ${generatedAt}.\n\nOpen the attached .raptor-status.json file with the R.A.P.T.O.R. portable application, then choose Open Organization Status File (Open Organization Snapshot in older versions). The snapshot is read-only and checked for file damage when opened.${protection} It does not contain evidence documents, shared-folder paths, audit logs, or records from other organizations.\n\nPlease contact the system administration team if a record appears incorrect.`,
 };
}
