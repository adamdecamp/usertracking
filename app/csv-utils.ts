import type {SystemRecord,UserRecord} from './domain/tracker-models';
import {oneLineText as oneLine} from './error-utils';
import {artifactKinds} from './filename-utils';
import {daysOverdueFor,daysUntilDueFor,directoryStatusFor,exceptionFor,newestArtifactFor,requiredKinds,statusFor} from './user-status-utils';
import {requirementStatusLabel} from './user-requirements';

function safeCsv(value:string){const clean=oneLine(String(value));return /^[=+\-@\t]/.test(clean)?`'${clean}`:clean}
const render=(rows:string[][])=>rows.map(row=>row.map(value=>`"${safeCsv(value).replaceAll('"','""')}"`).join(',')).join('\n');

export function csvRows(users:UserRecord[],systems:SystemRecord[],kinds:string[]=artifactKinds,state='all'){
 const asOf=new Date(),systemsById=new Map(systems.map(system=>[system.id,system])),rows=[['Last name','First name','Email','Organization','Information system','System status','User status','Roles','Privileged username','Privileged user type','Artifact','Status','Filename','Active exception','Exception through','Exception approver','Exception reason']];
 users.forEach(user=>requiredKinds(user).filter(kind=>kinds.includes(kind)).forEach(kind=>{const rawStatus=statusFor(user,kind);if(state!=='all'&&rawStatus!==state)return;const system=systemsById.get(user.systemId),exception=user.disabled?undefined:exceptionFor(user,kind,asOf);rows.push([user.last,user.first,user.email,user.organization,system?.name||'',system?.archived?'Archived':'Active',user.disabled?'Disabled':'Active',user.roles.join('; '),user.privilegedUsernames.join('; '),user.privilegedTypes.join('; '),kind,requirementStatusLabel(kind,rawStatus),newestArtifactFor(user,kind)?.filename||'',exception?'Yes':'No',exception?.expiresOn??'',exception?.approvedBy??'',exception?.reason??''])}));
 return render(rows);
}

export function filteredDirectoryCsvRows(users:UserRecord[],system:SystemRecord,artifactFilter:string,statusFilter:string,asOf:Date){
 const rows=[['Last name','First name','Official email','Organization','Information system','User status','Roles','Privileged username','Privileged user type','Artifact','Status','Days overdue','Days until due','Filename','Active exception','Exception through','Exception approver','Exception reason']];
 for(const user of users){const kinds=artifactFilter==='All artifacts'?requiredKinds(user):requiredKinds(user).includes(artifactFilter)?[artifactFilter]:[];for(const kind of kinds){const filterStatus=directoryStatusFor(user,kind,asOf);if(statusFilter!=='All statuses'&&filterStatus!==statusFilter)continue;const overdueDays=filterStatus==='Overdue'?daysOverdueFor(user,kind,asOf):0,dueDays=filterStatus==='Due Within 30 Days'?daysUntilDueFor(user,kind,asOf)??0:0,status=filterStatus==='Overdue'?`Overdue ${overdueDays} Day${overdueDays===1?'':'s'}`:filterStatus==='Due Within 30 Days'?`Due in ${dueDays} Day${dueDays===1?'':'s'}`:requirementStatusLabel(kind,filterStatus),exception=user.disabled?undefined:exceptionFor(user,kind,asOf);rows.push([user.last,user.first,user.email,user.organization,system.name,user.disabled?'Disabled':'Active',user.roles.join('; '),user.privilegedUsernames.join('; '),user.privilegedTypes.join('; '),kind,status,String(overdueDays||''),String(dueDays||''),newestArtifactFor(user,kind)?.filename||'',exception?'Yes':'No',exception?.expiresOn??'',exception?.approvedBy??'',exception?.reason??''])}}
 return{rowCount:rows.length-1,csv:render(rows)};
}
