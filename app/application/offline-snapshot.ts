import type {OrganizationStatusPayload} from '../organization-status-package';
import type {SystemRecord,UserRecord} from '../domain/tracker-models';

export function offlineSnapshotRecords(payload:OrganizationStatusPayload){
 const systemId=`offline-${payload.system.id}-${payload.organization}`;
 const system:SystemRecord={id:systemId,name:`${payload.system.name} — ${payload.organization} Snapshot`,type:payload.system.type,organization:payload.organization,archived:false};
 const users:UserRecord[]=payload.users.map((user,index)=>({id:user.id||`offline-user-${index+1}`,systemId,organization:payload.organization,affiliatedOrganizations:[],last:user.last,first:user.first,middle:user.middle,email:user.email,disabled:user.disabled,roles:user.roles,privilegedUsernames:[],privilegedTypes:user.privilegedTypes,artifacts:user.artifacts.map(artifact=>({...artifact})),exceptions:user.exceptions.map((item,itemIndex)=>({id:`offline-exception-${index+1}-${itemIndex+1}`,artifact:item.artifact,reason:item.reason,approvedBy:'Exported Snapshot',createdAt:payload.generatedAtUtc,createdBy:'Authoritative R.A.P.T.O.R. Export',expiresOn:item.expiresOn}))}));
 return{systemId,system,users};
}
