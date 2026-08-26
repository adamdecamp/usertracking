export function selectSupersededEvidence<T>(items:T[],dateOf:(item:T)=>Date|undefined,isCurrent:(item:T)=>boolean,keyOf:(item:T)=>string){
 const ordered=[...items].filter(item=>!!dateOf(item)).sort((left,right)=>(dateOf(right)?.getTime()??0)-(dateOf(left)?.getTime()??0)||keyOf(left).localeCompare(keyOf(right)));
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

export function retainUnfinishedCleanup<T extends{id:string}>(items:T[],completedIds:Iterable<string>){
 const completed=new Set(completedIds);
 return items.filter(item=>!completed.has(item.id));
}
