import {errorDetail} from '../error-utils.ts';
import {canonicalManualEvidenceFilename,preserveEvidenceExtension} from '../filename-utils.ts';
import type {Artifact,UserRecord} from '../domain/tracker-models.ts';

export type BestEffortFailure<T>={item:T;reason:string};

export type BestEffortResult<T,R>={
 completed:R[];
 failures:BestEffortFailure<T>[];
};

export async function relabelArtifactsForUserIdentity<TLocated extends{path:string}>(
 previous:UserRecord,
 next:UserRecord,
 locate:(artifact:Artifact)=>Promise<TLocated>,
 relocate:(artifact:Artifact,targetFilename:string,located:TLocated)=>Promise<string>,
){
 const result=await runBestEffort(previous.artifacts,async artifact=>{
  const role=next.roles.includes('Privileged')?'PRIV':'GEN',canonical=canonicalManualEvidenceFilename({filename:artifact.filename,kind:artifact.kind,last:next.last,first:next.first,organization:next.organization,role,privilegedType:next.privilegedTypes[0]});
  if(!canonical)throw new Error(`${artifact.filename} cannot be safely relabeled because its evidence type, role, or complete date is not recognizable.`);
  // Canonical names end in .pdf.zip; a file stored as a plain PDF keeps .pdf.
  const located=await locate(artifact),targetFilename=preserveEvidenceExtension(located.path,canonical);
  const path=await relocate(artifact,targetFilename,located);
  return{before:artifact,after:{...artifact,filename:targetFilename,path}};
 },error=>errorDetail(error,'The evidence file could not be relabeled.'));
 return{moves:result.completed,issues:result.failures.map(failure=>({artifact:failure.item,reason:failure.reason}))};
}

export function userInformationEvidenceWarning(issueCount:number,issueDetails:string){
 return`The user record was saved. ${issueCount} associated evidence file${issueCount===1?' was':'s were'} not relabeled and remain recorded at the prior filename or location: ${issueDetails}\n\nThe completed user-record change and this evidence exception were recorded in Administrative Change History. Run Reconciliation when you are ready to review the retained file locations.`;
}

export function userInformationEditNotice(issueCount:number,issueDetails:string,duplicateDetail:string,renameQueued=false){
 const queued=renameQueued?'The user information is saved. Associated evidence files are renamed to match at the next Session Commit.':'';
 if(issueCount||duplicateDetail)return{message:[queued,issueCount?userInformationEvidenceWarning(issueCount,issueDetails):'',duplicateDetail].filter(Boolean).join(' '),tone:'warning' as const,title:issueCount?'User Updated — Evidence Needs Review':'User Updated — Duplicate Review Needed'};
 return{message:queued||'The user information and associated evidence references were updated.',tone:'success' as const,title:'User Information Updated'};
}

/**
 * Runs independent evidence corrections sequentially so one stale or missing
 * file cannot prevent the remaining files or the user record from being
 * corrected. Storage mutations remain sequential to preserve launcher locks.
 */
export async function runBestEffort<T,R>(
 items:readonly T[],
 operation:(item:T)=>Promise<R>,
 describeError:(error:unknown)=>string,
):Promise<BestEffortResult<T,R>>{
 const completed:R[]=[];
 const failures:BestEffortFailure<T>[]=[];
 for(const item of items){
  try{completed.push(await operation(item))}
  catch(error){failures.push({item,reason:describeError(error)})}
 }
 return{completed,failures};
}
