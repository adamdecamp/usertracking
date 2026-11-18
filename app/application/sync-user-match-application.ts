import type {Artifact,UserRecord} from '../domain/tracker-models';
import type {SyncCandidate,SyncNewUser} from '../tracker-workflow-types';
import {canonicalArtifactKind} from '../filename-utils';
import {normalizeAffiliatedOrganizations} from '../affiliated-organization-utils';
import {statusFor} from '../user-status-utils';

export type RelabeledArtifactMove={before:Artifact;after:Artifact};
export type RelabeledArtifactIssue={artifact:Artifact;reason:string};

export function retryableSyncCandidates(pending:SyncCandidate[],matched:SyncCandidate[],approved:Set<string>,failedArtifactKeys:Set<string>){
 const failed=(candidate:SyncCandidate)=>failedArtifactKeys.has(`${candidate.userId}:${canonicalArtifactKind(candidate.kind)}`);
 return[...pending.filter(candidate=>approved.has(candidate.id)&&failed(candidate)),...matched.filter(failed)];
}

export function successfulMatchedProfileCount(candidates:SyncCandidate[],verifiedArtifactKeys:Set<string>){
 return new Set(candidates.filter(candidate=>verifiedArtifactKeys.has(`${candidate.userId}:${canonicalArtifactKind(candidate.kind)}`)).map(candidate=>candidate.userId)).size;
}

export async function applyConfirmedUserMatches({items,users,relabel,emailAccepted,onProgress}:{
 items:SyncNewUser[];
 users:UserRecord[];
 relabel:(previous:UserRecord,next:UserRecord)=>Promise<{moves:RelabeledArtifactMove[];issues:RelabeledArtifactIssue[]}>;
 emailAccepted:(email:string)=>boolean;
 onProgress?:(item:SyncNewUser,target?:UserRecord)=>void;
}){
 const failures:string[]=[],remaining:SyncNewUser[]=[],moves:RelabeledArtifactMove[]=[],candidates:SyncCandidate[]=[];
 for(const item of items){
  const target=users.find(user=>user.id===item.matchToUserId);
  if(!target){failures.push(`${item.record.last}, ${item.record.first}: the selected existing User Profile is no longer available.`);remaining.push({...item,matchToUserId:undefined,confirmedNewUser:false});onProgress?.(item);continue}
  const result=await relabel(item.record,{...target,roles:item.record.roles,privilegedTypes:item.record.privilegedTypes});moves.push(...result.moves);
  for(const move of result.moves){
   const kind=canonicalArtifactKind(move.after.kind),preview={...target,artifacts:[...target.artifacts.filter(artifact=>canonicalArtifactKind(artifact.kind)!==kind),move.after]},isSaar=kind==='SAAR';
   candidates.push({id:`identity-match:${item.id}:${kind}`,userId:target.id,kind,filename:move.after.filename,path:move.after.path??'',status:statusFor(preview,kind),organization:target.organization,...(isSaar?{roles:item.record.roles,privilegedTypes:item.record.privilegedTypes,affiliatedOrganizations:normalizeAffiliatedOrganizations([...target.affiliatedOrganizations,...item.record.affiliatedOrganizations]),extractionProvenance:item.record.extractionProvenance,...(!target.email.trim()&&emailAccepted(item.record.email)?{email:item.record.email}:{})}:{})});
  }
  if(result.issues.length){const issueArtifacts=new Set(result.issues.map(issue=>issue.artifact));remaining.push({...item,record:{...item.record,artifacts:item.record.artifacts.filter(artifact=>issueArtifacts.has(artifact))}});failures.push(`${item.record.last}, ${item.record.first} → ${target.last}, ${target.first}: ${result.issues.map(issue=>`${issue.artifact.filename}: ${issue.reason}`).join(' | ')}`)}
  onProgress?.(item,target);
 }
 return{failures,remaining,moves,candidates};
}
