import type {SystemRecord,UserRecord} from '../domain/tracker-models';

export type SystemCommitDatabase={
 version:2;
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

export type SystemCommitDependencies={
 hashState:(serializedState:string)=>Promise<string>;
 buildCsv:(users:UserRecord[],systems:SystemRecord[])=>string;
 now?:()=>string;
};

type CacheEntry={
 systems:SystemRecord[];
 users:UserRecord[];
 systemId:string;
 promise:Promise<SystemCommitPayload>;
};

/**
 * Builds the authoritative payload for exactly one information system.
 *
 * Keeping this operation outside the React page makes its security boundary
 * explicit: records from another system can never leak into a commit or CSV.
 */
export async function buildSystemCommitPayload(
 systems:SystemRecord[],
 users:UserRecord[],
 systemId:string,
 dependencies:SystemCommitDependencies,
):Promise<SystemCommitPayload>{
 const target=systems.find(item=>item.id===systemId);
 if(!target)throw new Error('The mapped information system no longer exists.');
 const scopedSystems=[target];
 const scopedUsers=users.filter(item=>item.systemId===systemId);
 const serializedState=JSON.stringify({systems:scopedSystems,users:scopedUsers});
 const stateHash=await dependencies.hashState(serializedState);
 const database:SystemCommitDatabase={
  version:2,
  updated:(dependencies.now??(()=>new Date().toISOString()))(),
  systems:scopedSystems,
  users:scopedUsers,
 };
 return{
  target,
  scopedSystems,
  scopedUsers,
  stateHash,
  database,
  csv:dependencies.buildCsv(scopedUsers,scopedSystems),
 };
}

/** Memoizes only referentially identical React state snapshots. */
export class SystemCommitPayloadCache{
 private entry:CacheEntry|undefined;

 get(
  systems:SystemRecord[],
  users:UserRecord[],
  systemId:string,
  dependencies:SystemCommitDependencies,
 ):Promise<SystemCommitPayload>{
  if(this.entry&&this.entry.systems===systems&&this.entry.users===users&&this.entry.systemId===systemId)return this.entry.promise;
  const promise=buildSystemCommitPayload(systems,users,systemId,dependencies);
  this.entry={systems,users,systemId,promise};
  return promise;
 }

 clear(){this.entry=undefined}
}
