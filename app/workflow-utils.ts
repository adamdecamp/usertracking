import {filenameIdentityMatches,filenameMatchesKind,identityKey,organizationFrom,parseDate,validateNewUserSaarFilename} from './filename-utils.ts';

export type ComplianceException={id:string;artifact:string;reason:string;approvedBy:string;createdAt:string;createdBy:string;expiresOn:string;revokedAt?:string;revokedBy?:string};
export type ReconciliationUser={id:string;last:string;first:string;email:string;organization:string;artifacts:{kind:string;filename:string;sha256?:string}[]};
export type ReconciliationEvidence={filename:string;path:string;sha256?:string;folderOrganization?:string};
export type ReconciliationRejection={filename:string;reason:string;path?:string};
export type ReconciliationIssue={id:string;category:'Missing File'|'Content Changed'|'Orphan Evidence'|'Duplicate Identity'|'Duplicate Email'|'Organization Conflict'|'Rejected Evidence';severity:'High'|'Medium';summary:string;detail:string;path?:string;userId?:string};
export type SyncProvenanceArtifact={kind:string;filename:string;sha256?:string;path?:string;storedAt?:string;storedBy?:string;source?:string};
export type SyncProvenanceUser={id:string;last:string;first:string;artifacts:SyncProvenanceArtifact[]};
export type HashedEvidence={filename:string;path:string;sha256:string};
export type DuplicateContentGroup={sha256:string;files:{filename:string;path:string}[]};
export type CertificateRecoveryUser={last:string;first:string;organization:string;roles:string[];privilegedTypes:string[]};

export function certificateRecoveryUsers(existing:CertificateRecoveryUser[],filenames:string[]){
 const byIdentity=new Map<string,CertificateRecoveryUser>(existing.map(user=>[identityKey(user.last,user.first),user] as const));
 const groups=new Map<string,{last:string;first:string;organization:string;role:'General'|'Privileged';privilegedTypes:string[]}[]>();
 for(const filename of filenames){const validation=validateNewUserSaarFilename(filename);if(!validation.valid)continue;const key=identityKey(validation.identity.last,validation.identity.first),items=groups.get(key)??[];items.push({last:validation.identity.last,first:validation.identity.first,organization:validation.organization,role:validation.role,privilegedTypes:validation.privilegedTypes});groups.set(key,items)}
 for(const[key,items]of groups){if(byIdentity.has(key))continue;const signatures=new Set(items.map(item=>`${item.organization.toUpperCase()}\0${item.role}\0${item.privilegedTypes.map(type=>type.toUpperCase()).sort().join(',')}`));if(signatures.size!==1)continue;const item=items[0];byIdentity.set(key,{last:item.last,first:item.first,organization:item.organization,roles:[item.role],privilegedTypes:item.privilegedTypes})}
 return Array.from(byIdentity.values());
}

export function duplicateContentGroups(items:HashedEvidence[]):DuplicateContentGroup[]{
 const groups=new Map<string,{filename:string;path:string}[]>();
 for(const item of items){const hash=item.sha256.trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(hash))continue;const files=groups.get(hash)??[];if(!files.some(file=>file.path.toUpperCase()===item.path.toUpperCase()))files.push({filename:item.filename,path:item.path});groups.set(hash,files)}
 return Array.from(groups.entries()).filter(([,files])=>files.length>1).map(([sha256,files])=>({sha256,files:files.sort((left,right)=>left.path.localeCompare(right.path))})).sort((left,right)=>left.files[0].path.localeCompare(right.files[0].path));
}

export function proposedNewUserArtifacts(filenames:string[],user:{last:string;first:string;organization?:string},kinds:string[],saarSource:string){
 const organization=user.organization?.trim().toUpperCase(),sameOrganization=(filename:string)=>!organization||organizationFrom(filename)?.trim().toUpperCase()===organization;
 const identityFiles=filenames.filter(filename=>filenameIdentityMatches(filename,user)&&sameOrganization(filename));
 return kinds.map(kind=>{
  if(kind==='SAAR')return filenameIdentityMatches(saarSource,user)&&sameOrganization(saarSource)&&filenameMatchesKind(saarSource,'SAAR')?{kind,filename:saarSource}:undefined;
  const filename=identityFiles.filter(item=>filenameMatchesKind(item,kind)&&!!parseDate(item)).sort((left,right)=>(parseDate(right)!.getTime()-parseDate(left)!.getTime())||left.localeCompare(right))[0];
  return filename?{kind,filename}:undefined;
 }).filter((artifact):artifact is{kind:string;filename:string}=>!!artifact);
}

export function activeComplianceException(exceptions:ComplianceException[]|undefined,artifact:string,asOf=new Date()){
 const endOfDay=(value:string)=>Date.parse(`${value}T23:59:59.999Z`);
 return exceptions?.filter(item=>item.artifact===artifact&&!item.revokedAt&&Number.isFinite(endOfDay(item.expiresOn))&&endOfDay(item.expiresOn)>=asOf.getTime()).sort((a,b)=>b.expiresOn.localeCompare(a.expiresOn))[0];
}

export function reworkRetentionDisposition(filename:string,asOf=new Date()):'Archive'|'Superseded'|undefined{
 if(/SAAR/i.test(filename)||filenameMatchesKind(filename,'SAAR'))return;
 const parsed=parseDate(filename),years=parsed?[]:Array.from(filename.matchAll(/(?:^|[^0-9])((?:19|20)[0-9]{2})(?![0-9])/g),match=>Number(match[1])).filter(year=>year>=1900&&year<=2099),evidenceDate=parsed??(years.length?new Date(Date.UTC(years.at(-1)!,11,31)):undefined);if(!evidenceDate)return;
 const oneYearCutoff=new Date(asOf);oneYearCutoff.setUTCHours(0,0,0,0);oneYearCutoff.setUTCFullYear(oneYearCutoff.getUTCFullYear()-1);
 if(evidenceDate>=oneYearCutoff)return;
 const fiveYearCutoff=new Date(asOf);fiveYearCutoff.setUTCHours(0,0,0,0);fiveYearCutoff.setUTCFullYear(fiveYearCutoff.getUTCFullYear()-5);
 return evidenceDate<fiveYearCutoff?'Superseded':'Archive';
}

export function notificationRecipientBatches(values:string[],maxRecipients=40,maxEncodedCharacters=1500){
 const unique=Array.from(new Set(values.map(value=>value.trim().toLowerCase()).filter(Boolean))),batches:string[][]=[];let current:string[]=[];
 for(const value of unique){const candidate=[...current,value],length=encodeURIComponent(candidate.join(';')).length;if(current.length&&(candidate.length>maxRecipients||length>maxEncodedCharacters)){batches.push(current);current=[value]}else current=candidate}
 if(current.length)batches.push(current);return batches;
}

export function committedRecordWithExceptions<T extends{exceptions?:ComplianceException[]}>(record:T,exceptions:ComplianceException[]){return{...record,exceptions}}

export function applySyncArtifactProvenance<T extends SyncProvenanceUser>(users:T[],touchedKeys:Set<string>,evidence:ReconciliationEvidence[],storedAt:string,storedBy:string){
 return users.map(user=>({...user,artifacts:user.artifacts.map(artifact=>{if(!touchedKeys.has(`${user.id}:${artifact.kind}`))return artifact;const match=evidence.find(item=>item.filename.toUpperCase()===artifact.filename.toUpperCase()&&filenameIdentityMatches(item.filename,user));if(!match?.sha256)throw new Error(`Provenance could not be recorded for ${artifact.filename}.`);return{...artifact,sha256:match.sha256,path:match.path,storedAt,storedBy,source:'Sync'}})})) as T[];
}

export function reconcileEvidence(users:ReconciliationUser[],evidence:ReconciliationEvidence[],rejected:ReconciliationRejection[]){
 const issues:ReconciliationIssue[]=[];
 const groups=(keyOf:(user:ReconciliationUser)=>string)=>{const map=new Map<string,ReconciliationUser[]>();for(const user of users){const key=keyOf(user);if(!key)continue;map.set(key,[...(map.get(key)??[]),user])}return map};
 for(const group of groups(user=>identityKey(user.last,user.first)).values())if(group.length>1)issues.push({id:`identity:${group.map(user=>user.id).sort().join(':')}`,category:'Duplicate Identity',severity:'High',summary:`${group[0].last}, ${group[0].first} appears ${group.length} times`,detail:group.map(user=>user.email).join(', ')});
 for(const[email,group]of groups(user=>user.email.trim().toUpperCase()).entries())if(group.length>1)issues.push({id:`email:${email}`,category:'Duplicate Email',severity:'High',summary:`${group.length} users share ${group[0].email}`,detail:group.map(user=>`${user.last}, ${user.first}`).join('; ')});
 for(const user of users)for(const artifact of user.artifacts){const match=evidence.find(item=>item.filename.toUpperCase()===artifact.filename.toUpperCase());if(!match)issues.push({id:`missing:${user.id}:${artifact.kind}:${artifact.filename}`,category:'Missing File',severity:'High',summary:`${user.last}, ${user.first}: ${artifact.kind} file is missing`,detail:artifact.filename,userId:user.id});else if(artifact.sha256&&match.sha256&&artifact.sha256.toLowerCase()!==match.sha256.toLowerCase())issues.push({id:`changed:${user.id}:${artifact.kind}:${match.path}`,category:'Content Changed',severity:'High',summary:`${user.last}, ${user.first}: ${artifact.kind} content changed`,detail:'The stored filename is unchanged, but its current SHA-256 does not match the recorded provenance hash.',path:match.path,userId:user.id})}
 for(const item of evidence){const matchingUsers=users.filter(user=>filenameIdentityMatches(item.filename,user)),filenameOrganization=organizationFrom(item.filename),folderOrganization=item.folderOrganization?.trim();if(folderOrganization&&filenameOrganization&&folderOrganization.toUpperCase()!==filenameOrganization.toUpperCase())issues.push({id:`folder-organization:${item.path}`,category:'Organization Conflict',severity:'Medium',summary:`${item.filename}: filename organization is ${filenameOrganization}`,detail:`The containing organization folder is authoritative and is named ${folderOrganization}. Run Sync to normalize this filename.`,path:item.path});if(!matchingUsers.length){issues.push({id:`orphan:${item.path}`,category:'Orphan Evidence',severity:'Medium',summary:`No user record matches ${item.filename}`,detail:'The file is valid evidence but its filename identity is not present in the manifest.',path:item.path});continue}for(const user of matchingUsers){const authoritative=folderOrganization||filenameOrganization;if(authoritative&&authoritative.toUpperCase()!==user.organization.toUpperCase())issues.push({id:`organization:${user.id}:${item.path}`,category:'Organization Conflict',severity:'Medium',summary:`${user.last}, ${user.first}: authoritative organization is ${authoritative}`,detail:`User record organization is ${user.organization}.`,path:item.path,userId:user.id});const known=user.artifacts.some(artifact=>artifact.filename.toUpperCase()===item.filename.toUpperCase()||filenameMatchesKind(item.filename,artifact.kind));if(!known)issues.push({id:`orphan-kind:${user.id}:${item.path}`,category:'Orphan Evidence',severity:'Medium',summary:`${item.filename} is not represented in the user record`,detail:`The filename matches ${user.last}, ${user.first}, but not a tracked artifact.`,path:item.path,userId:user.id})}}
 for(const item of rejected)issues.push({id:`rejected:${item.path??item.filename}`,category:'Rejected Evidence',severity:'High',summary:`${item.filename} failed validation`,detail:item.reason,path:item.path});
 return issues.sort((left,right)=>(left.severity===right.severity?left.category.localeCompare(right.category):left.severity==='High'?-1:1)||left.summary.localeCompare(right.summary));
}
