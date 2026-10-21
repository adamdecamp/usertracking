import type {SystemRecord,UserRecord} from '../domain/tracker-models';

export type SystemCommitDatabase={
 version:3;
 updated:string;
 systems:SystemRecord[];
 users:UserRecord[];
};

export type SystemCommitPayload={
 target:SystemRecord;
 scopedSystems:SystemRecord[];
 scopedUsers:UserRecord[];
 stateHash:string;
 database:SystemCommitDatabase;
 csv:string;
};

export type SystemCommitState=Pick<SystemCommitPayload,'target'|'scopedSystems'|'scopedUsers'|'stateHash'>;

export type SystemCommitDependencies={
 hashState:(serializedState:string)=>Promise<string>;
 buildCsv:(users:UserRecord[],systems:SystemRecord[])=>string;
 now?:()=>string;
};

type CacheEntry={
 systems:SystemRecord[];
 users:UserRecord[];
 systemId:string;
 state:Promise<SystemCommitState>;
 payload?:Promise<SystemCommitPayload>;
};

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
):Promise<SystemCommitState>{
 const target=systems.find(item=>item.id===systemId);
 if(!target)throw new Error('The mapped information system no longer exists.');
 const scopedSystems=[target];
 const scopedUsers=users.filter(item=>item.systemId===systemId);
 const serializedState=JSON.stringify({systems:scopedSystems,users:scopedUsers});
 const stateHash=await dependencies.hashState(serializedState);
 return{target,scopedSystems,scopedUsers,stateHash};
}

export async function buildSystemCommitPayload(
 systems:SystemRecord[],
 users:UserRecord[],
 systemId:string,
 dependencies:SystemCommitDependencies,
):Promise<SystemCommitPayload>{
 const state=await buildSystemCommitState(systems,users,systemId,dependencies);
 const database:SystemCommitDatabase={
  version:3,
  updated:(dependencies.now??(()=>new Date().toISOString()))(),
  systems:state.scopedSystems,
  users:state.scopedUsers,
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
 ){
  if(this.entry&&this.entry.systems===systems&&this.entry.users===users&&this.entry.systemId===systemId)return this.entry;
  const state=buildSystemCommitState(systems,users,systemId,dependencies);
  this.entry={systems,users,systemId,state};
  return this.entry;
 }

 getState(
  systems:SystemRecord[],
  users:UserRecord[],
  systemId:string,
  dependencies:SystemCommitDependencies,
 ):Promise<SystemCommitState>{
  return this.ensure(systems,users,systemId,dependencies).state;
 }

 get(
  systems:SystemRecord[],
  users:UserRecord[],
  systemId:string,
  dependencies:SystemCommitDependencies,
 ):Promise<SystemCommitPayload>{
  const entry=this.ensure(systems,users,systemId,dependencies);
  if(!entry.payload)entry.payload=entry.state.then(state=>{
   const database:SystemCommitDatabase={version:3,updated:(dependencies.now??(()=>new Date().toISOString()))(),systems:state.scopedSystems,users:state.scopedUsers};
   return{...state,database,csv:dependencies.buildCsv(state.scopedUsers,state.scopedSystems)};
  });
  return entry.payload;
 }

 clear(){this.entry=undefined}
}
