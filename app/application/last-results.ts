import type {PendingSync,PortableRoot} from '../tracker-workflow-types.ts';
import type {RecognitionAlias,SystemRecord,UserRecord} from '../domain/tracker-models.ts';
import type {ReconciliationIssue} from '../workflow-utils.ts';

/**
 * The last Sync (Daily or Full Scan) review and the last Reconciliation are
 * saved in the protected local workspace so an operator who logs off, closes
 * the window, or clicks away can reopen them instead of scanning again.
 *
 * A saved Sync review carries a snapshot of the user records it was built
 * from. Applying it after any later save would write those older records back,
 * so it is only reopened for action while the records still match the
 * fingerprint taken when the review was made. Otherwise it is summary-only.
 */
export const lastResultsVersion=1 as const;
export const lastResultsMaxAgeMs=7*24*60*60*1000;
export type LastResultKind='sync'|'reconciliation';
export type SavedSyncReviewBody=Omit<PendingSync,'handle'|'baseSaveGeneration'>;
export type SavedSyncReview={version:typeof lastResultsVersion;kind:'sync';systemId:string;savedAtUtc:string;savedBy:string;baseStateHash:string;review:SavedSyncReviewBody};
export type SavedReconciliation={version:typeof lastResultsVersion;kind:'reconciliation';systemId:string;savedAtUtc:string;savedBy:string;scanned:number;issues:ReconciliationIssue[]};
export type SavedLastResults={sync:SavedSyncReview|null;reconciliation:SavedReconciliation|null};
export type LastResultsRequest=(action:string,init?:RequestInit)=>Promise<Response>;

const sha256=/^[a-f0-9]{64}$/i;
const reviewArrays=['syncRunIds','systems','users','evidence','externalSharedAdditions','candidates','archiveCandidates','zipCandidates','reworkCandidates','collisionCandidates','newUsers','disabledStatusUpdates','reactivationCandidates','unmatched','rejected','contentDuplicates','identityConflicts'] as const;
const reviewNumbers=['scanned','unchanged','validated','ignored','scanDurationMs'] as const;
const issueCategories=new Set(['File Collision','Content Changed','Duplicate Identity','Duplicate Email','Possible Duplicate User','Account State Conflict','Organization Conflict','Rejected Evidence']);

function record(value:unknown):Record<string,unknown>|null{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null}
function text(value:unknown,limit:number){return typeof value==='string'&&value.length<=limit}
function count(value:unknown){return Number.isSafeInteger(value)&&(value as number)>=0}
function header(value:Record<string,unknown>,kind:LastResultKind,systemId:string){
 return value.version===lastResultsVersion&&value.kind===kind&&value.systemId===systemId&&text(value.savedAtUtc,40)&&!Number.isNaN(Date.parse(String(value.savedAtUtc)))&&text(value.savedBy,200);
}

/** Every evidence reference in a saved review must point into this system's own portable storage. */
function refsBelongTo(review:Record<string,unknown>,storageId:string){
 const refs:unknown[]=[];
 for(const key of ['evidence','externalSharedAdditions','archiveCandidates','zipCandidates','reworkCandidates','rejected'] as const)for(const item of review[key] as unknown[])refs.push(record(item)?.ref);
 for(const item of review.collisionCandidates as unknown[]){const candidate=record(item);refs.push(record(candidate?.incoming)?.ref,record(candidate?.existing)?.ref)}
 return refs.every(ref=>{if(ref===undefined)return true;const value=record(ref);return !!value&&value.kind==='portable'&&value.systemId===storageId&&text(value.path,2000)&&text(value.name,400)});
}

export function decodeSavedSyncReview(value:unknown,systemId:string,storageId:string):SavedSyncReview|null{
 const saved=record(value);if(!saved||!header(saved,'sync',systemId)||!text(saved.baseStateHash,64)||!sha256.test(String(saved.baseStateHash)))return null;
 const review=record(saved.review);if(!review||review.systemId!==systemId||typeof review.fullRescan!=='boolean'||!text(review.mode,100))return null;
 if(!reviewArrays.every(key=>Array.isArray(review[key]))||!reviewNumbers.every(key=>count(review[key])))return null;
 if(!(review.syncRunIds as unknown[]).every(id=>text(id,100)))return null;
 if((review.systems as unknown[]).some(item=>record(item)?.id!==systemId)||(review.users as unknown[]).some(item=>record(item)?.systemId!==systemId))return null;
 if(!refsBelongTo(review,storageId))return null;
 return saved as unknown as SavedSyncReview;
}

export function decodeSavedReconciliation(value:unknown,systemId:string):SavedReconciliation|null{
 const saved=record(value);if(!saved||!header(saved,'reconciliation',systemId)||!count(saved.scanned)||!Array.isArray(saved.issues)||saved.issues.length>100000)return null;
 const valid=saved.issues.every(item=>{const issue=record(item);return !!issue&&text(issue.id,400)&&issueCategories.has(String(issue.category))&&(issue.severity==='High'||issue.severity==='Medium')&&text(issue.summary,4000)&&text(issue.detail,20000)&&(issue.path===undefined||text(issue.path,2000))&&(issue.userId===undefined||text(issue.userId,200))});
 return valid?saved as unknown as SavedReconciliation:null;
}

export function lastResultExpired(savedAtUtc:string,now=Date.now()){const saved=Date.parse(savedAtUtc);return Number.isNaN(saved)||now-saved>lastResultsMaxAgeMs||saved-now>5*60*1000}

/** Key-order independent JSON, so records reloaded from disk fingerprint the same as the in-memory originals. */
export function canonicalJson(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(item=>item===undefined?'null':canonicalJson(item)).join(',')}]`;
 const object=record(value);if(!object)return JSON.stringify(value)??'null';
 return `{${Object.keys(object).filter(key=>object[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export async function recordsFingerprint(systems:SystemRecord[],users:UserRecord[],aliases:RecognitionAlias[],systemId:string,hash:(text:string)=>Promise<string>){
 const system=systems.find(item=>item.id===systemId)??null,scopedUsers=users.filter(user=>user.systemId===systemId).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),scopedAliases=aliases.filter(alias=>alias.systemId===systemId);
 return hash(canonicalJson({system,users:scopedUsers,recognitionAliases:scopedAliases}));
}

export function savedSyncReview(review:PendingSync,baseStateHash:string,savedBy:string,now=new Date().toISOString()):SavedSyncReview{
 const body:Record<string,unknown>={...review};delete body.handle;delete body.baseSaveGeneration;
 return{version:lastResultsVersion,kind:'sync',systemId:review.systemId,savedAtUtc:now,savedBy,baseStateHash,review:body as SavedSyncReviewBody};
}

export function savedReconciliation(systemId:string,issues:ReconciliationIssue[],scanned:number,savedBy:string,now=new Date().toISOString()):SavedReconciliation{
 return{version:lastResultsVersion,kind:'reconciliation',systemId,savedAtUtc:now,savedBy,scanned,issues};
}

/** Rebuilds an actionable review on the current portable root, stamped with the current save generation. */
export function restoredSyncReview(saved:SavedSyncReview,root:PortableRoot,saveGeneration:number):PendingSync{
 return{...saved.review,handle:root,baseSaveGeneration:saveGeneration};
}

export function syncReviewCounts(review:SavedSyncReviewBody){
 return [
  ['Evidence Matches',review.candidates.length],
  ['New Users',review.newUsers.length],
  ['Disables From SAAR Status',review.disabledStatusUpdates.length],
  ['Reactivations',review.reactivationCandidates.length],
  ['Archive',review.archiveCandidates.length],
  ['Compress',review.zipCandidates.length],
  ['Rework',review.reworkCandidates.length],
  ['Collisions',review.collisionCandidates.length],
  ['Rejected Files',review.rejected.length],
 ] as const;
}

export const syncReviewItemCount=(review:SavedSyncReviewBody)=>syncReviewCounts(review).reduce((total,[label,value])=>label==='Rejected Files'?total:total+value,0);
export const savedResultLabel=(review:SavedSyncReviewBody)=>review.fullRescan?'Full Scan Review':'Sync Review';
const savedTime=(value:string)=>new Date(value).toLocaleString([], {dateStyle:'short',timeStyle:'short'});

/** One logon notice describing what can be reopened; empty when nothing is saved. */
export function lastResultsNotice(saved:SavedLastResults,syncCurrent:boolean){
 const parts:string[]=[];
 if(saved.sync){const items=syncReviewItemCount(saved.sync.review);parts.push(`${savedResultLabel(saved.sync.review)} from ${savedTime(saved.sync.savedAtUtc)} (${items} item${items===1?'':'s'})${syncCurrent?'':', summary only because records changed after it was saved'}`)}
 if(saved.reconciliation){const issues=saved.reconciliation.issues.length;parts.push(`Reconciliation from ${savedTime(saved.reconciliation.savedAtUtc)} (${issues} issue${issues===1?'':'s'})`)}
 return parts.length?`Saved results are ready to reopen: ${parts.join('; ')}. Open them from Reports & Oversight, Last Results.`:'';
}

export async function readLastResults(request:LastResultsRequest,systemId:string,storageId:string,now=Date.now()):Promise<SavedLastResults>{
 const response=await request('last-results'),body=record(await response.json())??{};
 const sync=decodeSavedSyncReview(body.sync??null,systemId,storageId),reconciliation=decodeSavedReconciliation(body.reconciliation??null,systemId);
 const expired=(kind:LastResultKind)=>void clearLastResult(request,kind).catch(()=>undefined);
 if(body.sync&&(!sync||lastResultExpired(sync.savedAtUtc,now)))expired('sync');
 if(body.reconciliation&&(!reconciliation||lastResultExpired(reconciliation.savedAtUtc,now)))expired('reconciliation');
 return{sync:sync&&!lastResultExpired(sync.savedAtUtc,now)?sync:null,reconciliation:reconciliation&&!lastResultExpired(reconciliation.savedAtUtc,now)?reconciliation:null};
}

export async function saveLastResult(request:LastResultsRequest,result:SavedSyncReview|SavedReconciliation){
 await request('last-results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
}

export async function clearLastResult(request:LastResultsRequest,kind:LastResultKind){
 await request(`last-results?kind=${kind}`,{method:'DELETE'});
}
