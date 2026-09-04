export function selectSupersededEvidence<T>(items:T[],dateOf:(item:T)=>Date|undefined,isCurrent:(item:T)=>boolean,keyOf:(item:T)=>string,isPreferred:(item:T)=>boolean=()=>false){
 const ordered=[...items].filter(item=>!!dateOf(item)).sort((left,right)=>(dateOf(right)?.getTime()??0)-(dateOf(left)?.getTime()??0)||Number(isPreferred(right))-Number(isPreferred(left))||keyOf(left).localeCompare(keyOf(right)));
 if(ordered.length<2||!isCurrent(ordered[0]))return{current:undefined,superseded:[] as T[]};
 return{current:ordered[0],superseded:ordered.slice(1)};
}

export function distinctByPath<T extends{path:string}>(items:T[]){
 const seen=new Set<string>();
 return items.filter(item=>{const key=item.path.replaceAll('\\','/').toUpperCase();if(seen.has(key))return false;seen.add(key);return true});
}

export function selectLoosePdfCleanupCandidates<T extends{filename:string;path:string},U>(items:T[],existingUsers:U[],matchesUser:(item:T,user:U)=>boolean,excludedPaths:string[]=[]){
 const excluded=new Set(excludedPaths.map(path=>path.replaceAll('\\','/').toUpperCase()));
 return distinctByPath(items.filter(item=>item.filename.toLowerCase().endsWith('.pdf')&&!excluded.has(item.path.replaceAll('\\','/').toUpperCase())&&existingUsers.some(user=>matchesUser(item,user))));
}

export function findLoosePdfZipCollisions<T extends{filename:string;path:string}>(items:T[]){
 const pathKey=(path:string)=>path.replaceAll('\\','/').toUpperCase(),byPath=new Map(items.map(item=>[pathKey(item.path),item]));
 return distinctByPath(items.filter(item=>item.filename.toLowerCase().endsWith('.pdf')).map(pdf=>{const zip=byPath.get(pathKey(`${pdf.path}.zip`));return zip?{pdf,zip}:undefined}).filter((item):item is{pdf:T;zip:T}=>!!item).map(item=>({path:item.pdf.path,filename:item.pdf.filename,pdf:item.pdf,zip:item.zip})));
}

export function retainUnfinishedCleanup<T extends{id:string}>(items:T[],completedIds:Iterable<string>){
 const completed=new Set(completedIds);
 return items.filter(item=>!completed.has(item.id));
}

export function shouldReopenCleanupReview(requestedActionCount:number,remainingCleanupCount:number){
 return requestedActionCount>0&&remainingCleanupCount>0;
}

export function shouldPreselectRework(reason:string){
 return reason.startsWith('Unidentified PDF:')||reason.startsWith('Recognized as ')||reason.startsWith('Invalid ZIP filename:');
}

export type EvidenceCollisionClassification='Exact Duplicate'|'Same-Name Conflict'|'Hash Unavailable';
export type EvidenceCollisionChoice='existing'|'incoming'|'defer';

export function classifyEvidenceCollision(incomingSha256?:string,existingSha256?:string):EvidenceCollisionClassification{
 const incoming=incomingSha256?.trim().toLowerCase(),existing=existingSha256?.trim().toLowerCase();
 if(!incoming||!existing)return'Hash Unavailable';
 return incoming===existing?'Exact Duplicate':'Same-Name Conflict';
}

export function defaultEvidenceCollisionChoice(classification:EvidenceCollisionClassification):EvidenceCollisionChoice{
 return classification==='Exact Duplicate'?'existing':'defer';
}

export function collisionArchiveFilename(filename:string,sha256?:string){
 const lower=filename.toLowerCase(),dot=filename.lastIndexOf('.'),extension=lower.endsWith('.pdf.zip')?filename.slice(-8):dot>=0?filename.slice(dot):'',stem=filename.slice(0,filename.length-extension.length),identifier=sha256?.trim().slice(0,8).toUpperCase()||'REVIEW',suffix=`_CONFLICT_${identifier}`,safeStem=stem.slice(0,Math.max(1,180-extension.length-suffix.length));
 return`${safeStem}${suffix}${extension}`;
}

export function supersedingEvidenceApproval(storedFilename:string,newestFilename:string,updateCandidateId?:string){
 if(storedFilename&&storedFilename.toUpperCase()===newestFilename.toUpperCase())return{};
 return updateCandidateId?{requiresCandidateId:updateCandidateId}:undefined;
}
