import {mapWithConcurrency} from './concurrency-utils.ts';
import {filenameIdentityMatches} from './filename-utils.ts';

type ProvenanceTarget={user:{last:string;first:string};artifact:{filename:string}};
type ProvenanceEvidence={filename:string;path:string};

export async function verifySyncProvenance<TTarget extends ProvenanceTarget,TEvidence extends ProvenanceEvidence>(targets:TTarget[],evidence:TEvidence[],hasher:(item:TEvidence)=>Promise<string>,options:{concurrency?:number;onCompleted?:(completed:number,total:number,index:number)=>void}={}){
 const results=await mapWithConcurrency(targets,options.concurrency??4,async target=>{
  const match=evidence.find(item=>item.filename.toUpperCase()===target.artifact.filename.toUpperCase()&&filenameIdentityMatches(item.filename,target.user));
  if(!match)return{target,error:`The Sync evidence for ${target.artifact.filename} could not be located at its current path.`} as const;
  try{return{target,evidence:{filename:match.filename,path:match.path,sha256:await hasher(match)}} as const}
  catch(error){return{target,error:error instanceof Error?error.message:'The evidence file could not be verified.'} as const}
 },{onCompleted:options.onCompleted});
 const verified=results.filter((result):result is Extract<(typeof results)[number],{evidence:unknown}>=>'evidence'in result);
 const failures=results.filter((result):result is Extract<(typeof results)[number],{error:string}>=>'error'in result);
 return{verified,failures};
}
