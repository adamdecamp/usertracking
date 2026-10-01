import {canonicalArtifactKind,disabledSaarFilename,filenameIdentityMatches,filenameMatchesKind,identityKey,organizationFrom,parseDate} from './filename-utils.ts';
import {resolveSyncProvenanceEvidence} from './provenance-utils.ts';

export type ComplianceException={id:string;artifact:string;reason:string;approvedBy:string;createdAt:string;createdBy:string;expiresOn:string;revokedAt?:string;revokedBy?:string};
export type ReconciliationUser={id:string;last:string;first:string;email:string;organization:string;artifacts:{kind:string;filename:string;sha256?:string;path?:string}[]};
export type ReconciliationEvidence={filename:string;path:string;sha256?:string;folderOrganization?:string};
export type ReconciliationRejection={filename:string;reason:string;path?:string};
export type ReconciliationIssue={id:string;category:'Missing File'|'Content Changed'|'Orphan Evidence'|'Duplicate Identity'|'Duplicate Email'|'Organization Conflict'|'Rejected Evidence';severity:'High'|'Medium';summary:string;detail:string;path?:string;userId?:string};
export type SyncProvenanceArtifact={kind:string;filename:string;sha256?:string;path?:string;storedAt?:string;storedBy?:string;source?:string};
export type SyncProvenanceUser={id:string;last:string;first:string;organization?:string;artifacts:SyncProvenanceArtifact[]};
export type UserEvidenceArchiveScope={last:string;first:string;organization:string};
export type TransferEvidenceArtifact={kind:string;filename:string;sha256?:string;path?:string};
export type DeletionEvidenceUser=UserEvidenceArchiveScope&{id:string;disabled:boolean;artifacts:TransferEvidenceArtifact[]};
export type DeletionEvidenceItem={filename:string;path:string;kind?:string};
export type HashedEvidence={filename:string;path:string;sha256:string};
export type RetentionMove={source:string;archived:string;bucket:string};
export type DuplicateContentGroup={sha256:string;files:{filename:string;path:string}[]};
export type SaarAccountState={filename:string;date:Date;disabled:boolean};
export type NotificationHistoryChange={timestamp:string;actor:string;action:string;description:string;rolesBefore:string[];rolesAfter:string[];files:string[]};
export const complianceNotificationAction='Paperwork Notification Draft Prepared';
export function requiresSaarFormClassification(filename:string){return /\.pdf$/i.test(filename)&&filenameMatchesKind(filename,'SAAR')}
export function duplicateContentGroups(items:HashedEvidence[]):DuplicateContentGroup[]{
 const groups=new Map<string,{filename:string;path:string}[]>();
 for(const item of items){const hash=item.sha256.trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(hash))continue;const files=groups.get(hash)??[];if(!files.some(file=>file.path.toUpperCase()===item.path.toUpperCase()))files.push({filename:item.filename,path:item.path});groups.set(hash,files)}
 return Array.from(groups.entries()).filter(([,files])=>files.length>1).map(([sha256,files])=>({sha256,files:files.sort((left,right)=>left.path.localeCompare(right.path))})).sort((left,right)=>left.files[0].path.localeCompare(right.files[0].path));
}

export function newestSaarAccountState(filenames:string[]):SaarAccountState|undefined{
 const candidates=filenames.filter(filename=>filenameMatchesKind(filename,'SAAR')).map(filename=>{const date=parseDate(filename);return date?{filename,date,disabled:disabledSaarFilename(filename)}:undefined}).filter((candidate):candidate is SaarAccountState=>!!candidate);
 return candidates.sort((left,right)=>right.date.getTime()-left.date.getTime()||Number(right.disabled)-Number(left.disabled)||left.filename.localeCompare(right.filename))[0];
}
export function shouldDisableUserFromSaarState(currentlyDisabled:boolean,state:SaarAccountState|undefined){return !currentlyDisabled&&state?.disabled===true}

export function proposedNewUserArtifacts(filenames:string[],user:{last:string;first:string;organization?:string},kinds:string[],saarSource:string){
 const organization=user.organization?.trim().toUpperCase(),sameOrganization=(filename:string)=>!organization||organizationFrom(filename)?.trim().toUpperCase()===organization;
 const identityFiles=filenames.filter(filename=>filenameIdentityMatches(filename,user)&&sameOrganization(filename));
 return kinds.map(kind=>{
  if(kind==='SAAR')return !disabledSaarFilename(saarSource)&&filenameIdentityMatches(saarSource,user)&&sameOrganization(saarSource)&&filenameMatchesKind(saarSource,'SAAR')?{kind,filename:saarSource}:undefined;
  const filename=identityFiles.filter(item=>filenameMatchesKind(item,kind)&&!!parseDate(item)).sort((left,right)=>(parseDate(right)!.getTime()-parseDate(left)!.getTime())||left.localeCompare(right))[0];
  return filename?{kind,filename}:undefined;
 }).filter((artifact):artifact is{kind:string;filename:string}=>!!artifact);
}

export function activeComplianceException(exceptions:ComplianceException[]|undefined,artifact:string,asOf=new Date()){
 const endOfDay=(value:string)=>Date.parse(`${value}T23:59:59.999Z`);
 return exceptions?.filter(item=>item.artifact===artifact&&!item.revokedAt&&Number.isFinite(endOfDay(item.expiresOn))&&endOfDay(item.expiresOn)>=asOf.getTime()).sort((a,b)=>b.expiresOn.localeCompare(a.expiresOn))[0];
}

export function archiveRetentionDisposition(filename:string,asOf=new Date()):'Archive'|'Superseded'{
 const evidenceDate=parseDate(filename);if(!evidenceDate)return'Archive';
 const fiveYearCutoff=new Date(asOf);fiveYearCutoff.setUTCHours(0,0,0,0);fiveYearCutoff.setUTCFullYear(fiveYearCutoff.getUTCFullYear()-5);
 return evidenceDate<fiveYearCutoff?'Superseded':'Archive';
}

export function removePreflightArchivedArtifacts<T extends{id:string;artifacts:{filename:string;path?:string}[];changes?:{timestamp:string;actor:string;action:string;description:string;rolesBefore:string[];rolesAfter:string[];files:string[]}[];roles:string[]}>(users:T[],moves:RetentionMove[],timestamp:string,actor:string){
 const archivalMoves=moves.filter(move=>!['Unaccepted File Format','Rework Extraction'].includes(move.bucket)),sources=archivalMoves.flatMap(move=>{const source=move.source.replaceAll('\\','/');return source.toLowerCase().endsWith('.pdf.zip')?[source,source.slice(0,-4)]:[source]}),paths=new Set(sources.map(source=>source.toUpperCase())),filenames=new Set(sources.map(source=>source.split('/').at(-1)!.toUpperCase()));
 if(!archivalMoves.length)return users;
 return users.map(user=>{const removed=user.artifacts.filter(artifact=>(!!artifact.path&&paths.has(artifact.path.replaceAll('\\','/').toUpperCase()))||filenames.has(artifact.filename.toUpperCase()));if(!removed.length)return user;return{...user,artifacts:user.artifacts.filter(artifact=>!removed.includes(artifact)),changes:[...(user.changes??[]),{timestamp,actor,action:'Archive Evidence After Administrative Action',description:'A verified administrative archive action removed evidence from the active record. The requirement is Missing unless another usable file is matched during this Sync.',rolesBefore:[...user.roles],rolesAfter:[...user.roles],files:removed.map(artifact=>artifact.filename)}]}});
}

export function notificationRecipientBatches(values:string[],maxRecipients=40,maxEncodedCharacters=1500){
 const unique=Array.from(new Set(values.map(value=>value.trim().toLowerCase()).filter(Boolean))),batches:string[][]=[];let current:string[]=[];
 for(const value of unique){const candidate=[...current,value],length=encodeURIComponent(candidate.join(';')).length;if(current.length&&(candidate.length>maxRecipients||length>maxEncodedCharacters)){batches.push(current);current=[value]}else current=candidate}
 if(current.length)batches.push(current);return batches;
}

export function automaticDatabaseCompressionCandidateIds(candidates:{id:string;path:string;filename:string}[],updates:{id:string;path:string}[],approvedUpdateIds:Iterable<string>,discoveredUsers:{last:string;first:string;organization:string;artifacts:{filename:string}[]}[]){
 const approved=new Set(approvedUpdateIds),approvedPaths=new Set(updates.filter(update=>approved.has(update.id)).map(update=>update.path.replaceAll('\\','/').toUpperCase()));
 return candidates.filter(candidate=>approvedPaths.has(candidate.path.replaceAll('\\','/').toUpperCase())||discoveredUsers.some(user=>organizationFrom(candidate.filename)?.trim().toUpperCase()===user.organization.trim().toUpperCase()&&filenameIdentityMatches(candidate.filename,user)&&user.artifacts.some(artifact=>artifact.filename.toUpperCase()===candidate.filename.toUpperCase()))).map(candidate=>candidate.id);
}

export function isComplianceNotificationChange(change:{action?:string}){return change.action===complianceNotificationAction}

export function clearComplianceNotificationHistory<T extends{changes?:NotificationHistoryChange[]}>(record:T):T{
 if(!record.changes?.some(isComplianceNotificationChange))return record;
 return{...record,changes:record.changes.filter(change=>!isComplianceNotificationChange(change))};
}

export function recordComplianceNotificationHistory<T extends{id:string;email:string;roles:string[];changes?:NotificationHistoryChange[]}>(users:T[],userIds:Iterable<string>,state:string,artifact:string,timestamp:string,actor:string,batchNumber:number,batchTotal:number){
 const selected=new Set(userIds);
 return users.map(user=>{if(!selected.has(user.id))return user;const change:NotificationHistoryChange={timestamp,actor,action:complianceNotificationAction,description:`${state} ${artifact} Outlook draft prepared for ${user.email}; BCC batch ${batchNumber} of ${batchTotal}. Outlook controls final sending, so this entry records draft preparation rather than delivery confirmation.`,rolesBefore:[...user.roles],rolesAfter:[...user.roles],files:[]};return{...user,changes:[...(user.changes??[]),change]}});
}

export function committedRecordWithExceptions<T extends{exceptions?:ComplianceException[]}>(record:T,exceptions:ComplianceException[]){return{...record,exceptions}}

export function evidenceBelongsToUserArchiveScope(item:{filename:string;folderOrganization?:string},user:UserEvidenceArchiveScope){
 if(!filenameIdentityMatches(item.filename,user))return false;
 const organization=(item.folderOrganization||organizationFrom(item.filename)||'').trim();
 return !!organization&&organization.toUpperCase()===user.organization.trim().toUpperCase();
}

function normalizedEvidencePath(value?:string){return value?.replaceAll('\\','/').toUpperCase()}
export function activeUserProtectsEvidenceFromDeletion(item:DeletionEvidenceItem,deletingUser:DeletionEvidenceUser,users:DeletionEvidenceUser[]){
 const itemPath=normalizedEvidencePath(item.path),itemKind=canonicalArtifactKind(item.kind??artifactKindFromFilename(item.filename));
 return users.some(user=>user.id!==deletingUser.id&&!user.disabled&&user.artifacts.some(artifact=>{
  const artifactPath=normalizedEvidencePath(artifact.path);
  if(itemPath&&artifactPath)return itemPath===artifactPath;
  return !artifactPath&&canonicalArtifactKind(artifact.kind)===itemKind&&artifact.filename.toUpperCase()===item.filename.toUpperCase();
 }));
}
function artifactKindFromFilename(filename:string){return['SAAR','DoD Cyber Cert','User Agreement','8140 Cert Memo','Privileged User Training Cert','DTA Training'].find(kind=>filenameMatchesKind(filename,kind))??'Associated Evidence'}
export function hasActiveDuplicateEvidenceScope(deletingUser:DeletionEvidenceUser,users:DeletionEvidenceUser[]){
 return users.some(user=>user.id!==deletingUser.id&&!user.disabled&&identityKey(user.last,user.first)===identityKey(deletingUser.last,deletingUser.first)&&user.organization.trim().toUpperCase()===deletingUser.organization.trim().toUpperCase());
}

export function evidenceAssociationMatchesTransfer(existing:TransferEvidenceArtifact,incoming:TransferEvidenceArtifact,target:{last:string;first:string}){
 if(canonicalArtifactKind(existing.kind)!==canonicalArtifactKind(incoming.kind))return false;
 const existingHash=existing.sha256?.trim().toLowerCase(),incomingHash=incoming.sha256?.trim().toLowerCase();
 if(existingHash&&incomingHash&&/^[a-f0-9]{64}$/.test(existingHash)&&existingHash===incomingHash)return true;
 const existingPath=existing.path?.replaceAll('\\','/').toUpperCase(),incomingPath=incoming.path?.replaceAll('\\','/').toUpperCase();
 if(existingPath&&incomingPath&&existingPath===incomingPath)return true;
 return existing.filename.toUpperCase()===incoming.filename.toUpperCase()&&filenameIdentityMatches(incoming.filename,target);
}

export function applySyncArtifactProvenance<T extends SyncProvenanceUser>(users:T[],touchedKeys:Set<string>,evidence:ReconciliationEvidence[],storedAt:string,storedBy:string){
 return users.map(user=>({...user,artifacts:user.artifacts.map(artifact=>{if(!touchedKeys.has(`${user.id}:${artifact.kind}`))return artifact;const resolution=resolveSyncProvenanceEvidence({user,artifact},evidence),match='evidence'in resolution?resolution.evidence:undefined;if(!match?.sha256)throw new Error(`Provenance could not be recorded for ${artifact.filename}. ${'error'in resolution?resolution.error:''}`.trim());return{...artifact,filename:match.filename,sha256:match.sha256,path:match.path,storedAt,storedBy,source:'Sync'}})})) as T[];
}

function reconciliationPathIsActive(path?:string){
 if(!path)return true;
 const directories=path.replaceAll('\\','/').split('/').slice(0,-1);
 return !directories.some(segment=>{const value=segment.trim().toUpperCase();return value==='REWORK'||value.endsWith(' REWORK')||value==='ARCHIVE'||value==='ARCHIVE REVIEW'||value.endsWith(' ARCHIVE')||value==='SUPERSEDED'});
}
function reconciliationArtifactMatches(item:{filename:string;path?:string},artifact:{filename:string;path?:string}){
 const itemPath=item.path?.replaceAll('\\','/').toUpperCase(),artifactPath=artifact.path?.replaceAll('\\','/').toUpperCase();
 return artifactPath?itemPath===artifactPath:item.filename.toUpperCase()===artifact.filename.toUpperCase();
}
export function reconciliationIncludesEvidence(users:ReconciliationUser[],item:{filename:string;path?:string}){
 return reconciliationPathIsActive(item.path)&&users.some(user=>user.artifacts.some(artifact=>reconciliationArtifactMatches(item,artifact)));
}

export function reconcileEvidence(users:ReconciliationUser[],evidence:ReconciliationEvidence[],rejected:ReconciliationRejection[]){
 const issues:ReconciliationIssue[]=[];
 const recordedEvidence=evidence.filter(item=>reconciliationIncludesEvidence(users,item)),recordedRejected=rejected.filter(item=>reconciliationIncludesEvidence(users,item));
 const groups=(keyOf:(user:ReconciliationUser)=>string)=>{const map=new Map<string,ReconciliationUser[]>();for(const user of users){const key=keyOf(user);if(!key)continue;map.set(key,[...(map.get(key)??[]),user])}return map};
 for(const group of groups(user=>identityKey(user.last,user.first)).values())if(group.length>1)issues.push({id:`identity:${group.map(user=>user.id).sort().join(':')}`,category:'Duplicate Identity',severity:'High',summary:`${group[0].last}, ${group[0].first} appears ${group.length} times`,detail:group.map(user=>user.email).join(', ')});
 for(const[email,group]of groups(user=>user.email.trim().toUpperCase()).entries())if(group.length>1)issues.push({id:`email:${email}`,category:'Duplicate Email',severity:'High',summary:`${group.length} users share ${group[0].email}`,detail:group.map(user=>`${user.last}, ${user.first}`).join('; ')});
 for(const user of users)for(const artifact of user.artifacts){const match=recordedEvidence.find(item=>reconciliationArtifactMatches(item,artifact));if(!match)issues.push({id:`missing:${user.id}:${artifact.kind}:${artifact.filename}`,category:'Missing File',severity:'High',summary:`${user.last}, ${user.first}: ${artifact.kind} file is missing`,detail:artifact.filename,userId:user.id});else if(artifact.sha256&&match.sha256&&artifact.sha256.toLowerCase()!==match.sha256.toLowerCase())issues.push({id:`changed:${user.id}:${artifact.kind}:${match.path}`,category:'Content Changed',severity:'High',summary:`${user.last}, ${user.first}: ${artifact.kind} content changed`,detail:'The stored filename is unchanged, but its current SHA-256 does not match the recorded provenance hash.',path:match.path,userId:user.id})}
 for(const item of recordedEvidence){const matchingUsers=users.filter(user=>user.artifacts.some(artifact=>reconciliationArtifactMatches(item,artifact))),filenameOrganization=organizationFrom(item.filename),folderOrganization=item.folderOrganization?.trim();if(folderOrganization&&filenameOrganization&&folderOrganization.toUpperCase()!==filenameOrganization.toUpperCase())issues.push({id:`folder-organization:${item.path}`,category:'Organization Conflict',severity:'Medium',summary:`${item.filename}: filename organization is ${filenameOrganization}`,detail:`The containing organization folder is authoritative and is named ${folderOrganization}. Run Sync to normalize this filename.`,path:item.path});for(const user of matchingUsers){const authoritative=folderOrganization||filenameOrganization;if(authoritative&&authoritative.toUpperCase()!==user.organization.toUpperCase())issues.push({id:`organization:${user.id}:${item.path}`,category:'Organization Conflict',severity:'Medium',summary:`${user.last}, ${user.first}: authoritative organization is ${authoritative}`,detail:`User record organization is ${user.organization}.`,path:item.path,userId:user.id})}}
 for(const item of recordedRejected)issues.push({id:`rejected:${item.path??item.filename}`,category:'Rejected Evidence',severity:'High',summary:`${item.filename} failed validation`,detail:item.reason,path:item.path});
 return issues.sort((left,right)=>(left.severity===right.severity?left.category.localeCompare(right.category):left.severity==='High'?-1:1)||left.summary.localeCompare(right.summary));
}
