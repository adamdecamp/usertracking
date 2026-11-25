import type {Artifact,ChangeRecord,SystemRecord,UserRecord} from '../domain/tracker-models.ts';
import type {DeletedUserEvidence,PendingEvidenceMove,PendingEvidenceMoveWork} from '../domain/pending-evidence-moves.ts';

/** Storage work the runner needs. page.tsx supplies the real launcher and browser operations. */
export type PendingEvidenceOperations={
 /** Moves one file to its organization Archive and returns where it went. */
 archive(owner:Pick<UserRecord,'id'|'last'|'first'|'organization'>,artifact:Artifact):Promise<string>;
 /** Renames a user's files to match the record and returns the record with updated references and any retained issues. */
 relabel(user:UserRecord):Promise<{user:UserRecord;issues:number;detail:string}>;
 /** Brings the newest disabled SAAR back to the active SAAR folder. */
 restoreSaar(user:UserRecord):Promise<{artifact?:Artifact;destination?:string;error?:string}>;
 /** Finds and archives every active file of a deleted user. */
 archiveDeletedUser(user:DeletedUserEvidence,systemUsers:UserRecord[]):Promise<{moved:{source:string;destination:string}[];missingErrors:string[];blockingErrors:string[]}>;
 isArchived(path:string):boolean;
 isMissing(error:unknown):boolean;
 /** Errors that must stop the commit, such as a lost shared-folder lease. */
 isFatal(error:unknown):boolean;
 describe(error:unknown):string;
 actor:string;
 now?:()=>string;
 onProgress?:(done:number,total:number,label:string)=>void;
};

export type PendingEvidenceCommitResult={
 system:SystemRecord;
 users:UserRecord[];
 /** One line per finished or retained request, for the audit trail. */
 audit:string[];
 /** Requests left in the queue because of a problem that may clear up (for example the shared folder was busy). */
 retained:number;
 warnings:string[];
};

// A rename runs before an archive for the same user, so edits made after a disable never pull archived files back out.
const order:Record<PendingEvidenceMoveWork,number>={'relabel-user':0,'restore-saar':1,'archive-user':2,'archive-file':3,'archive-deleted-user':4};
const basename=(path:string)=>path.replaceAll('\\','/').split('/').at(-1)??path;

/**
 * Runs the file moves that record changes queued for this system, in a safe
 * order, and returns the updated system and user records to publish. A missing
 * file is reported and dropped (there is nothing left to move); any other
 * problem keeps the request for the next Session Commit; a fatal error stops.
 */
export async function runPendingEvidenceMoves(system:SystemRecord,allUsers:readonly UserRecord[],ops:PendingEvidenceOperations):Promise<PendingEvidenceCommitResult>{
 const queue=[...(system.pendingEvidenceMoves??[])].map((move,index)=>({move,index})).sort((left,right)=>order[left.move.work]-order[right.move.work]||left.index-right.index).map(item=>item.move);
 let users=[...allUsers];const retained:PendingEvidenceMove[]=[],audit:string[]=[],warnings:string[]=[],now=ops.now??(()=>new Date().toISOString());
 const replaceUser=(next:UserRecord)=>{users=users.map(user=>user.id===next.id?next:user)};
 const change=(user:UserRecord,action:string,description:string,files:string[]):UserRecord=>({...user,changes:[...(user.changes??[]),{timestamp:now(),actor:ops.actor,action,description,rolesBefore:[...user.roles],rolesAfter:[...user.roles],files} satisfies ChangeRecord]});
 for(const[index,move]of queue.entries()){
  ops.onProgress?.(index,queue.length,move.userLabel);
  const user=users.find(item=>item.id===move.userId&&item.systemId===system.id);
  try{
   if(move.work==='archive-user'){
    if(!user||!user.disabled){audit.push(`SESSION COMMIT FILE MOVES: archive for ${move.userLabel} skipped; the user is ${user?'active again':'no longer in this system'}`);continue}
    const moved:string[]=[],missing:string[]=[],failed:string[]=[];
    const artifacts:Artifact[]=[];
    for(const artifact of user.artifacts){
     if(artifact.path&&ops.isArchived(artifact.path)){artifacts.push(artifact);continue}
     try{const destination=await ops.archive(user,artifact);moved.push(destination);artifacts.push({...artifact,filename:basename(destination),path:destination})}
     catch(error){if(ops.isFatal(error))throw error;artifacts.push(artifact);(ops.isMissing(error)?missing:failed).push(`${artifact.filename}: ${ops.describe(error)}`)}
    }
    let next:UserRecord={...user,artifacts};
    if(moved.length||missing.length||failed.length)next=change(next,'Archive Disabled User Evidence',`Session Commit archived ${moved.length} file${moved.length===1?'':'s'} queued when the user was disabled${missing.length?`; ${missing.length} already missing`:''}${failed.length?`; ${failed.length} kept for the next commit`:''}.`,moved.map(basename));
    replaceUser(next);
    if(failed.length){retained.push(move);warnings.push(...failed)}
    warnings.push(...missing);
    audit.push(`SESSION COMMIT FILE MOVES: ${move.userLabel}; archived ${moved.length} disabled-user file${moved.length===1?'':'s'}${moved.length?` (${moved.join(', ')})`:''}${missing.length?`; ${missing.length} missing: ${missing.join(' | ')}`:''}${failed.length?`; ${failed.length} kept for the next commit: ${failed.join(' | ')}`:''}`);
   }else if(move.work==='restore-saar'){
    if(!user||user.disabled){audit.push(`SESSION COMMIT FILE MOVES: SAAR restore for ${move.userLabel} skipped; the user is ${user?'disabled again':'no longer in this system'}`);continue}
    const restored=await ops.restoreSaar(user);
    if(restored.artifact){replaceUser(change({...user,artifacts:[...user.artifacts.filter(artifact=>artifact.kind!=='SAAR'),restored.artifact]},'Restore Disabled SAAR',`Session Commit restored the disabled SAAR to the active SAAR folder as ${restored.artifact.filename}.`,[restored.artifact.filename]));audit.push(`SESSION COMMIT FILE MOVES: ${move.userLabel}; restored the disabled SAAR to ${restored.destination??restored.artifact.path??restored.artifact.filename}`)}
    else{const detail=restored.error??'The disabled SAAR could not be restored.';replaceUser(change(user,'Restore Disabled SAAR Exception',detail,[]));warnings.push(`${move.userLabel}: ${detail}`);audit.push(`SESSION COMMIT FILE MOVES: ${move.userLabel}; disabled SAAR not restored, recorded for review: ${detail}`)}
   }else if(move.work==='relabel-user'){
    if(!user){audit.push(`SESSION COMMIT FILE MOVES: file renaming for ${move.userLabel} skipped; the user is no longer in this system`);continue}
    const relabeled=await ops.relabel(user);replaceUser(relabeled.user);
    if(relabeled.issues)warnings.push(`${move.userLabel}: ${relabeled.detail}`);
    audit.push(`SESSION COMMIT FILE MOVES: ${move.userLabel}; renamed files to match the edited user${relabeled.issues?`; ${relabeled.issues} kept at the prior name for Reconciliation: ${relabeled.detail}`:''}`);
   }else if(move.work==='archive-file'&&move.file){
    try{const destination=await ops.archive({id:move.userId,last:'',first:'',organization:''},{kind:move.file.kind,filename:move.file.filename,path:move.file.path,...(move.file.sha256?{sha256:move.file.sha256}:{})});audit.push(`SESSION COMMIT FILE MOVES: archived ${move.file.path} released by ${move.userLabel} to ${destination}`)}
    catch(error){if(ops.isFatal(error))throw error;const detail=`${move.file.filename}: ${ops.describe(error)}`;warnings.push(detail);if(ops.isMissing(error))audit.push(`SESSION COMMIT FILE MOVES: ${move.file.path} released by ${move.userLabel} is already missing; nothing to archive`);else{retained.push(move);audit.push(`SESSION COMMIT FILE MOVES: ${move.file.path} kept for the next commit: ${detail}`)}}
   }else if(move.work==='archive-deleted-user'&&move.user){
    const result=await ops.archiveDeletedUser(move.user,users.filter(item=>item.systemId===system.id));
    warnings.push(...result.missingErrors,...result.blockingErrors);if(result.blockingErrors.length)retained.push(move);
    audit.push(`SESSION COMMIT FILE MOVES: deleted user ${move.userLabel}; archived ${result.moved.length} file${result.moved.length===1?'':'s'}${result.moved.length?` (${result.moved.map(item=>`${item.source} to ${item.destination}`).join(', ')})`:''}${result.missingErrors.length?`; ${result.missingErrors.length} missing`:''}${result.blockingErrors.length?`; ${result.blockingErrors.length} kept for the next commit: ${result.blockingErrors.join(' | ')}`:''}`);
   }
  }catch(error){
   if(ops.isFatal(error))throw error;
   retained.push(move);const detail=`${move.userLabel}: ${ops.describe(error)}`;warnings.push(detail);audit.push(`SESSION COMMIT FILE MOVES: request kept for the next commit; ${detail}`);
  }
 }
 ops.onProgress?.(queue.length,queue.length,'');
 const keptIds=new Set(retained.map(move=>move.id)),kept=(system.pendingEvidenceMoves??[]).filter(move=>keptIds.has(move.id)),next:SystemRecord={...system};
 if(kept.length)next.pendingEvidenceMoves=kept;else delete next.pendingEvidenceMoves;
 return{system:next,users,audit,retained:kept.length,warnings};
}
