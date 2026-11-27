import {validManifestArtifactPath} from '../manifest-validation.ts';

/**
 * Manifest v9: file moves that a record change asked for, waiting for Session Commit.
 *
 * Record changes (Disable User, Re-enable User, Edit User Information, evidence
 * transfers, and Delete User) save the record locally right away and queue their
 * file moves here. Session Commit runs the queue in order before it publishes,
 * so the operator never waits on the shared folder while editing records.
 *
 * User-scoped work is worked out from the record as it stands at commit, so
 * a later change (for example re-enabling a user before commit) simply
 * replaces the earlier request instead of fighting it.
 */
export type PendingEvidenceMoveWork=
 /** Move every active file of a disabled user to the organization Archive. */
 |'archive-user'
 /** Bring the newest disabled SAAR of a re-enabled user back to the active SAAR folder. */
 |'restore-saar'
 /** Rename and move a user's files to match a corrected name or organization. */
 |'relabel-user'
 /** Move one file that no user record references any longer to the organization Archive. */
 |'archive-file'
 /** Find and archive every active file of a deleted user. */
 |'archive-deleted-user';

export type PendingEvidenceFile={kind:string;filename:string;path:string;sha256?:string};
export type DeletedUserEvidence={id:string;last:string;first:string;organization:string;disabled:boolean;artifacts:{kind:string;filename:string;path?:string;sha256?:string}[]};

export type PendingEvidenceMove={
 id:string;
 work:PendingEvidenceMoveWork;
 userId:string;
 /** "Last, First" for messages and the audit trail, even after the user is deleted. */
 userLabel:string;
 requestedAt:string;
 requestedBy:string;
 /** archive-file only. */
 file?:PendingEvidenceFile;
 /** archive-deleted-user only. */
 user?:DeletedUserEvidence;
};

export const pendingEvidenceMoveLimit=5000;
const works:readonly PendingEvidenceMoveWork[]=['archive-user','restore-saar','relabel-user','archive-file','archive-deleted-user'];
const text=(value:unknown,max:number,allowEmpty=false):value is string=>typeof value==='string'&&value.length<=max&&(allowEmpty||value.trim().length>0);
const sha=(value:unknown)=>value===undefined||(typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value));
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
// Same rule the launcher applies to artifact paths: relative, no drive or colon, and no "." or ".." segment.
const safePath=(value:unknown):value is string=>validManifestArtifactPath(value)&&value.trim().length>0&&!value.includes(':')&&!/^[\\/]/.test(value)&&!value.split(/[\\/]+/).some(part=>part==='.'||part==='..');

function decodeFile(value:unknown):PendingEvidenceFile|undefined{
 if(!record(value)||!text(value.kind,100)||!text(value.filename,500)||!safePath(value.path)||!sha(value.sha256))return;
 return{kind:value.kind,filename:value.filename,path:value.path,...(value.sha256!==undefined?{sha256:value.sha256 as string}:{})};
}

function decodeDeletedUser(value:unknown):DeletedUserEvidence|undefined{
 if(!record(value)||!text(value.id,100)||!text(value.last,100,true)||!text(value.first,100,true)||!text(value.organization,200,true)||typeof value.disabled!=='boolean'||!Array.isArray(value.artifacts)||value.artifacts.length>100)return;
 const artifacts:DeletedUserEvidence['artifacts']=[];
 for(const item of value.artifacts){
  if(!record(item)||!text(item.kind,100)||!text(item.filename,500)||(item.path!==undefined&&!safePath(item.path))||!sha(item.sha256))return;
  artifacts.push({kind:item.kind,filename:item.filename,...(item.path!==undefined?{path:item.path as string}:{}),...(item.sha256!==undefined?{sha256:item.sha256 as string}:{})});
 }
 return{id:value.id,last:value.last,first:value.first,organization:value.organization,disabled:value.disabled,artifacts};
}

/** Strict decoder for a persisted queue; undefined rejects the whole database, like every other field. */
export function decodePendingEvidenceMoves(value:unknown):PendingEvidenceMove[]|undefined{
 if(!Array.isArray(value)||value.length>pendingEvidenceMoveLimit)return;
 const moves:PendingEvidenceMove[]=[],ids=new Set<string>();
 for(const item of value){
  if(!record(item)||!text(item.id,100)||ids.has(item.id)||!works.includes(item.work as PendingEvidenceMoveWork)||!text(item.userId,100)||!text(item.userLabel,300,true)||!text(item.requestedAt,50)||Number.isNaN(Date.parse(item.requestedAt))||!text(item.requestedBy,500))return;
  const work=item.work as PendingEvidenceMoveWork,file=item.file===undefined?undefined:decodeFile(item.file),user=item.user===undefined?undefined:decodeDeletedUser(item.user);
  if((item.file!==undefined&&!file)||(item.user!==undefined&&!user))return;
  if((work==='archive-file')!==!!file||(work==='archive-deleted-user')!==!!user)return;
  if(user&&user.id!==item.userId)return;
  ids.add(item.id);
  moves.push({id:item.id,work,userId:item.userId,userLabel:item.userLabel,requestedAt:item.requestedAt,requestedBy:item.requestedBy,...(file?{file}:{}),...(user?{user}:{})});
 }
 return moves;
}

/**
 * Adds one request to the queue and drops the requests it replaces:
 * disabling cancels a waiting SAAR restore, re-enabling cancels a waiting
 * archive, and deleting a user replaces everything queued for that user except
 * files already released to other records. Repeated requests are not duplicated.
 */
export function queuePendingEvidenceMove(queue:readonly PendingEvidenceMove[]|undefined,move:PendingEvidenceMove):PendingEvidenceMove[]{
 const current=[...(queue??[])],same=(item:PendingEvidenceMove,work:PendingEvidenceMoveWork)=>item.userId===move.userId&&item.work===work;
 let next=current;
 if(move.work==='archive-user')next=current.filter(item=>!same(item,'restore-saar'));
 if(move.work==='restore-saar')next=current.filter(item=>!same(item,'archive-user'));
 if(move.work==='archive-deleted-user')next=current.filter(item=>item.userId!==move.userId||item.work==='archive-file');
 const duplicate=move.work==='archive-file'?next.some(item=>item.work==='archive-file'&&item.file?.path.toLowerCase()===move.file?.path.toLowerCase()):move.work!=='archive-deleted-user'&&next.some(item=>same(item,move.work));
 if(duplicate)return next;
 if(next.length>=pendingEvidenceMoveLimit)throw new Error(`More than ${pendingEvidenceMoveLimit} file moves are waiting. Run Session Commit before making more changes.`);
 return[...next,move];
}

/** A new request for one user, stamped with who asked and when. */
export function newPendingEvidenceMove(work:PendingEvidenceMoveWork,user:{id:string;last:string;first:string},actor:string,extra:{file?:PendingEvidenceFile;user?:DeletedUserEvidence}={},now=new Date().toISOString()):PendingEvidenceMove{
 return{id:crypto.randomUUID(),work,userId:user.id,userLabel:`${user.last}, ${user.first}`,requestedAt:now,requestedBy:actor,...extra};
}

/** Applies a record change's cancellations, then its new requests, to a system's queue. */
export function updatePendingEvidenceQueue(queue:readonly PendingEvidenceMove[]|undefined,requests:readonly PendingEvidenceMove[],cancel:readonly{userId:string;work:PendingEvidenceMoveWork}[]=[]){
 let next=[...(queue??[])];
 for(const item of cancel)next=cancelPendingEvidenceMoves(next,item.userId,item.work);
 for(const request of requests)next=queuePendingEvidenceMove(next,request);
 return next;
}

/** The system with this queue, leaving the field off entirely when nothing is waiting. */
export function withPendingMoves<T extends{pendingEvidenceMoves?:PendingEvidenceMove[]}>(system:T,queue:readonly PendingEvidenceMove[]):T{
 const next={...system};if(queue.length)next.pendingEvidenceMoves=[...queue];else delete next.pendingEvidenceMoves;return next;
}

/** Drops a re-enable's waiting archive (or a disable's waiting restore) without adding anything. */
export function cancelPendingEvidenceMoves(queue:readonly PendingEvidenceMove[]|undefined,userId:string,work:PendingEvidenceMoveWork){
 return(queue??[]).filter(item=>!(item.userId===userId&&item.work===work));
}

