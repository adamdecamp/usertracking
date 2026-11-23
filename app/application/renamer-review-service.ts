import {buildTrackerFilename} from '../document-renamer-utils.ts';
import type {RenamerItem} from '../tracker-workflow-types.ts';

export function renamerProposalState(source:RenamerItem[]){
 const targets=new Map<string,string>(),counts=new Map<string,number>();
 for(const item of source){const target=buildTrackerFilename(item);if(!target)continue;targets.set(item.id,target);const key=target.toUpperCase();counts.set(key,(counts.get(key)??0)+1)}
 const duplicateIds=new Set(source.filter(item=>{const target=targets.get(item.id);return !!target&&(counts.get(target.toUpperCase())??0)>1}).map(item=>item.id));
 const collisionIds=new Set(source.filter(item=>duplicateIds.has(item.id)||/collision|already exists/i.test(item.error??'')).map(item=>item.id));
 return{targets,duplicateIds,collisionIds};
}
