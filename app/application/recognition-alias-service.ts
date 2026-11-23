import type {RecognitionAlias,UserRecord} from '../domain/tracker-models.ts';

export function approveRecognitionAlias(aliases:RecognitionAlias[],alias:RecognitionAlias){
 return[...aliases.filter(item=>item.id!==alias.id&&!(item.systemId===alias.systemId&&item.normalizedPattern===alias.normalizedPattern&&item.organization.toUpperCase()===alias.organization.toUpperCase()&&!item.revokedAtUtc)),alias];
}

export type ReviewedAliasItem={decisionSource?:'automatic'|'alias'|'review';normalizedPattern?:string;candidates?:Array<{userId:string;last:string;first:string;organization:string}>;last:string;first:string;organization:string;kind:string;filename:string;targetFilename?:string};
export function aliasesFromReviewedItems(aliases:RecognitionAlias[],items:ReviewedAliasItem[],context:{systemId:string;operator:string;atUtc:string;id:()=>string}){
 let next=aliases,approved=0;
 for(const item of items){
  if(item.decisionSource==='automatic'||item.decisionSource==='alias'||!item.normalizedPattern)continue;
  const candidate=item.candidates?.find(value=>value.last.localeCompare(item.last,undefined,{sensitivity:'accent'})===0&&value.first.localeCompare(item.first,undefined,{sensitivity:'accent'})===0&&value.organization.localeCompare(item.organization,undefined,{sensitivity:'accent'})===0)??item.candidates?.[0];
  next=approveRecognitionAlias(next,{id:context.id(),systemId:context.systemId,normalizedPattern:item.normalizedPattern,organization:item.organization,userId:candidate?.userId,artifactKind:item.kind,operator:context.operator,createdAtUtc:context.atUtc,originalFilename:item.filename,affectedFilenames:item.targetFilename?[item.targetFilename]:[]});approved++;
 }
 return{aliases:next,approved};
}

export function editRecognitionAlias(aliases:RecognitionAlias[],id:string,change:Pick<RecognitionAlias,'organization'|'artifactKind'|'userId'>){
 return aliases.map(alias=>alias.id===id&&!alias.revokedAtUtc?{...alias,...change}:alias);
}

export function revokeRecognitionAlias(aliases:RecognitionAlias[],users:UserRecord[],id:string,operator:string,atUtc:string){
 const alias=aliases.find(item=>item.id===id);if(!alias||alias.revokedAtUtc)return{aliases,users,affected:0};let affected=0;
 return{
  aliases:aliases.map(item=>item.id===id?{...item,revokedAtUtc:atUtc,revokedBy:operator}:item),
  users:users.map(user=>({...user,artifacts:user.artifacts.map(artifact=>{if(artifact.recognitionAliasId!==id&&!alias.affectedFilenames.some(filename=>filename.localeCompare(artifact.filename,undefined,{sensitivity:'accent'})===0))return artifact;affected++;return{...artifact,recognitionReviewRequired:true}})})),
  affected,
 };
}
