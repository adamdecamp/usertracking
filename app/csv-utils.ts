import type {SystemRecord,UserRecord} from './domain/tracker-models.ts';
import {oneLineText as oneLine} from './error-utils.ts';
import {artifactKinds} from './filename-utils.ts';
import {daysOverdueFor,daysUntilDueFor,directoryStatusFor,exceptionFor,newestArtifactFor,requiredKinds,statusFor} from './user-status-utils.ts';
import {requirementStatusLabel} from './user-requirements.ts';
import {complianceLabels,userComplianceLabel} from './application/user-compliance.ts';

function safeCsv(value:string){const clean=oneLine(String(value));return /^[=+\-@\t]/.test(clean)?`'${clean}`:clean}
const render=(rows:string[][])=>rows.map(row=>row.map(value=>`"${safeCsv(value).replaceAll('"','""')}"`).join(',')).join('\n');
const source=(user:UserRecord,key:'identity'|'organization'|'officialEmail'|'accountType')=>user.extractionProvenance?.[key]?.source??'';

export function csvRows(users:UserRecord[],systems:SystemRecord[],kinds:string[]=artifactKinds,state='all'){
 const asOf=new Date(),systemsById=new Map(systems.map(system=>[system.id,system])),rows=[['Last name','First name','Email','Storage organization','Affiliated organizations','Information system','System status','User status','Roles','Privileged username','Privileged user type','Identity source','Organization source','Official email source','Account type source','Artifact','Status','Filename','Active exception','Exception through','Exception approver','Exception reason']];
 users.forEach(user=>requiredKinds(user).filter(kind=>kinds.includes(kind)).forEach(kind=>{const rawStatus=statusFor(user,kind);if(state!=='all'&&rawStatus!==state)return;const system=systemsById.get(user.systemId),exception=user.disabled?undefined:exceptionFor(user,kind,asOf);rows.push([user.last,user.first,user.email,user.organization,user.affiliatedOrganizations.join('; '),system?.name||'',system?.archived?'Archived':'Active',user.disabled?'Disabled':'Active',user.roles.join('; '),user.privilegedUsernames.join('; '),user.privilegedTypes.join('; '),source(user,'identity'),source(user,'organization'),source(user,'officialEmail'),source(user,'accountType'),kind,requirementStatusLabel(kind,rawStatus),newestArtifactFor(user,kind)?.filename||'',exception?'Yes':'No',exception?.expiresOn??'',exception?.approvedBy??'',exception?.reason??''])}));
 return render(rows);
}

export {complianceLabels as csvCompliance} from './application/user-compliance.ts';

/** One requirement's plain-language status for the directory export, and whether it counts as met. */
function requirementCell(user:UserRecord,kind:string,asOf:Date){
 const status=directoryStatusFor(user,kind,asOf),exception=user.disabled?undefined:exceptionFor(user,kind,asOf);
 const overdueDays=status==='Overdue'?daysOverdueFor(user,kind,asOf):0,dueDays=status==='Due Within 30 Days'?daysUntilDueFor(user,kind,asOf)??0:0;
 const text=status==='Overdue'?`Overdue ${overdueDays} Day${overdueDays===1?'':'s'}`:status==='Due Within 30 Days'?(dueDays===0?'Due Today':`Due in ${dueDays} Day${dueDays===1?'':'s'}`):requirementStatusLabel(kind,status);
 // Matches the dashboard: a requirement is met while its evidence is current. An exception is shown but does not make it met.
 const met=status==='Current'||status==='Due Within 30 Days';
 return{met,text:exception&&status!=='Current'&&status!=='Due Within 30 Days'?`${text} (Exception through ${exception.expiresOn})`:text};
}

/**
 * The User Directory export: one row per user, with Compliance first so it can
 * be filtered in Excel, the requirements that need action, and one column per
 * requirement. The rows are the users already shown by the directory filters.
 */
export function filteredDirectoryCsvRows(users:UserRecord[],system:SystemRecord,asOf:Date){
 const columns=artifactKinds.filter(kind=>users.some(user=>requiredKinds(user).includes(kind)));
 const rows=[['Compliance','Last name','First name','Official email','Storage organization','Affiliated organizations','Information system','User status','Roles','Privileged user type','Requirements not met','Action needed',...columns,'Privileged username','Identity source','Organization source','Official email source','Account type source']];
 let notCompliant=0;
 for(const user of users){
  const required=requiredKinds(user),cells=new Map(required.map(kind=>[kind,requirementCell(user,kind,asOf)])),unmet=required.filter(kind=>!cells.get(kind)!.met);
  const compliance=userComplianceLabel(user,asOf);if(compliance===complianceLabels.notCompliant)notCompliant++;
  rows.push([compliance,user.last,user.first,user.email,user.organization,user.affiliatedOrganizations.join('; '),system.name,user.disabled?'Disabled':'Active',user.roles.join('; '),user.privilegedTypes.join('; '),String(unmet.length),unmet.map(kind=>`${kind}: ${cells.get(kind)!.text}`).join('; '),...columns.map(kind=>cells.get(kind)?.text??'Not required'),user.privilegedUsernames.join('; '),source(user,'identity'),source(user,'organization'),source(user,'officialEmail'),source(user,'accountType')]);
 }
 // The byte-order mark lets Excel open names with accents correctly.
 return{rowCount:rows.length-1,notCompliant,csv:'﻿'+render(rows)};
}
