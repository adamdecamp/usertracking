import {mapWithConcurrency} from './concurrency-utils.ts';
import {canonicalArtifactKind,filenameIdentityMatches,filenameMatchesKind,organizationFrom} from './filename-utils.ts';

type ProvenanceTarget={user:{last:string;first:string;organization?:string};artifact:{filename:string;kind?:string;path?:string}};
type ProvenanceEvidence={filename:string;path:string;folderOrganization?:string};
type ProvenanceResolution<TEvidence>={evidence:TEvidence}|{error:string};

function evidenceContainerKey(filename:string){
 const upper=filename.trim().toUpperCase();
 return upper.endsWith('.PDF.ZIP')?upper.slice(0,-4):upper;
}

function sameOrganization(target:ProvenanceTarget,item:ProvenanceEvidence){
 const expected=target.user.organization?.trim().toUpperCase();if(!expected)return true;
 const actual=(item.folderOrganization||organizationFrom(item.filename)||'').trim().toUpperCase();
 return !actual||actual===expected;
}

export function resolveSyncProvenanceEvidence<TEvidence extends ProvenanceEvidence>(target:ProvenanceTarget,evidence:TEvidence[]):ProvenanceResolution<TEvidence>{
 const identityMatches=evidence.filter(item=>filenameIdentityMatches(item.filename,target.user)&&sameOrganization(target,item));
 const expectedPath=target.artifact.path?.replaceAll('\\','/').toUpperCase(),pathMatches=expectedPath?identityMatches.filter(item=>item.path.replaceAll('\\','/').toUpperCase()===expectedPath):[];
 if(pathMatches.length===1)return{evidence:pathMatches[0]!} as const;
 if(pathMatches.length>1)return{error:`Multiple current evidence files occupy the selected path for ${target.artifact.filename}; run Reconciliation before applying this update.`} as const;
 const containerKey=evidenceContainerKey(target.artifact.filename),exact=identityMatches.filter(item=>evidenceContainerKey(item.filename)===containerKey);
 if(exact.length===1)return{evidence:exact[0]!} as const;
 if(exact.length>1)return{error:`Multiple current evidence files match ${target.artifact.filename}; resolve the duplicate before applying this update.`} as const;
 const kind=target.artifact.kind&&canonicalArtifactKind(target.artifact.kind),sameKind=kind?identityMatches.filter(item=>filenameMatchesKind(item.filename,kind)):[];
 if(sameKind.length===1)return{evidence:sameKind[0]!} as const;
 if(sameKind.length>1)return{error:`Multiple current ${kind} files match ${target.user.last}, ${target.user.first}; resolve the duplicate before applying this update.`} as const;
 return{error:`The Sync evidence for ${target.artifact.filename} could not be located at its current path.`} as const;
}

export async function verifySyncProvenance<TTarget extends ProvenanceTarget,TEvidence extends ProvenanceEvidence>(targets:TTarget[],evidence:TEvidence[],hasher:(item:TEvidence)=>Promise<string>,options:{concurrency?:number;onCompleted?:(completed:number,total:number,index:number)=>void}={}){
 const results=await mapWithConcurrency(targets,options.concurrency??4,async target=>{
  const resolution=resolveSyncProvenanceEvidence(target,evidence);
  if(!('evidence'in resolution))return{target,error:resolution.error} as const;
  const match=resolution.evidence;
  try{return{target,evidence:{filename:match.filename,path:match.path,sha256:await hasher(match)}} as const}
  catch(error){return{target,error:error instanceof Error?error.message:'The evidence file could not be verified.'} as const}
 },{onCompleted:options.onCompleted});
 const verified=results.filter((result):result is Extract<(typeof results)[number],{evidence:unknown}>=>'evidence'in result);
 const failures=results.filter((result):result is Extract<(typeof results)[number],{error:string}>=>'error'in result);
 return{verified,failures};
}
