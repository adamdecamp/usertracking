import type {RecognitionAlias,SystemRecord,UserRecord} from '../domain/tracker-models';
import {applicationVersion} from '../version.ts';
import {currentManifestVersion} from '../data-migrations.ts';

export type SystemCommitDatabase={
 version:typeof currentManifestVersion;
 minimumApplicationVersion:string;
 lastWriterVersion:string;
 updated:string;
 systems:SystemRecord[];
 users:UserRecord[];
 recognitionAliases:RecognitionAlias[];
};

export type SystemCommitPayload={
 target:SystemRecord;
 scopedSystems:SystemRecord[];
 scopedUsers:UserRecord[];
 scopedRecognitionAliases:RecognitionAlias[];
 stateHash:string;
 database:SystemCommitDatabase;
 csv:string;
};

export type SystemCommitState=Pick<SystemCommitPayload,'target'|'scopedSystems'|'scopedUsers'|'scopedRecognitionAliases'|'stateHash'>;

export type SystemCommitDependencies={
 hashState:(serializedState:string)=>Promise<string>;
 buildCsv:(users:UserRecord[],systems:SystemRecord[])=>string;
 now?:()=>string;
};

type CacheEntry={
 systems:SystemRecord[];
 users:UserRecord[];
 aliases:RecognitionAlias[];
 systemId:string;
 state:Promise<SystemCommitState>;
 payload?:Promise<SystemCommitPayload>;
};
const emptyAliases:RecognitionAlias[]=[];

/**
 * Builds the authoritative payload for exactly one information system.
 *
 * Keeping this operation outside the React page makes its security boundary
 * explicit: records from another system can never leak into a commit or CSV.
 */
export async function buildSystemCommitState(
 systems:SystemRecord[],
 users:UserRecord[],
 systemId:string,
 dependencies:Pick<SystemCommitDependencies,'hashState'>,
 aliases:RecognitionAlias[]=emptyAliases,
):Promise<SystemCommitState>{
 const target=systems.find(item=>item.id===systemId);
 if(!target)throw new Error('The mapped information system no longer exists.');
 const scopedSystems=[target];
 const scopedUsers=users.filter(item=>item.systemId===systemId);
 const scopedRecognitionAliases=aliases.filter(item=>item.systemId===systemId);
 const serializedState=JSON.stringify({systems:scopedSystems,users:scopedUsers,recognitionAliases:scopedRecognitionAliases});
 const stateHash=await dependencies.hashState(serializedState);
 return{target,scopedSystems,scopedUsers,scopedRecognitionAliases,stateHash};
}

export async function buildSystemCommitPayload(
 systems:SystemRecord[],
 users:UserRecord[],
 systemId:string,
 dependencies:SystemCommitDependencies,
 aliases:RecognitionAlias[]=emptyAliases,
):Promise<SystemCommitPayload>{
 const state=await buildSystemCommitState(systems,users,systemId,dependencies,aliases);
 const database:SystemCommitDatabase={
  version:currentManifestVersion,
  minimumApplicationVersion:applicationVersion,
  lastWriterVersion:applicationVersion,
  updated:(dependencies.now??(()=>new Date().toISOString()))(),
  systems:state.scopedSystems,
  users:state.scopedUsers,
  recognitionAliases:state.scopedRecognitionAliases,
 };
 return{
  ...state,
  database,
  csv:dependencies.buildCsv(state.scopedUsers,state.scopedSystems),
 };
}

/** Memoizes only referentially identical React state snapshots. */
export class SystemCommitPayloadCache{
 private entry:CacheEntry|undefined;

 private ensure(
  systems:SystemRecord[],
  users:UserRecord[],
  systemId:string,
  dependencies:SystemCommitDependencies,
  aliases:RecognitionAlias[]=emptyAliases,
 ){
  if(this.entry&&this.entry.systems===systems&&this.entry.users===users&&this.entry.aliases===aliases&&this.entry.systemId===systemId)return this.entry;
  const state=buildSystemCommitState(systems,users,systemId,dependencies,aliases);
  this.entry={systems,users,aliases,systemId,state};
  return this.entry;
 }

 getState(
  systems:SystemRecord[],
  users:UserRecord[],
  systemId:string,
  dependencies:SystemCommitDependencies,
  aliases:RecognitionAlias[]=emptyAliases,
 ):Promise<SystemCommitState>{
  return this.ensure(systems,users,systemId,dependencies,aliases).state;
 }

 get(
  systems:SystemRecord[],
  users:UserRecord[],
  systemId:string,
  dependencies:SystemCommitDependencies,
  aliases:RecognitionAlias[]=emptyAliases,
 ):Promise<SystemCommitPayload>{
  const entry=this.ensure(systems,users,systemId,dependencies,aliases);
  if(!entry.payload)entry.payload=entry.state.then(state=>{
   const database:SystemCommitDatabase={version:currentManifestVersion,minimumApplicationVersion:applicationVersion,lastWriterVersion:applicationVersion,updated:(dependencies.now??(()=>new Date().toISOString()))(),systems:state.scopedSystems,users:state.scopedUsers,recognitionAliases:state.scopedRecognitionAliases};
   return{...state,database,csv:dependencies.buildCsv(state.scopedUsers,state.scopedSystems)};
  });
  return entry.payload;
 }

 clear(){this.entry=undefined}
}
