export function createKeyedSerialQueue(){
 const tails=new Map<string,Promise<void>>();
 return function enqueue<T>(key:string,operation:()=>Promise<T>):Promise<T>{
  const prior=tails.get(key)??Promise.resolve(),result=prior.then(operation),settled=result.then(()=>undefined,()=>undefined);
  tails.set(key,settled);
  void settled.then(()=>{if(tails.get(key)===settled)tails.delete(key)});
  return result;
 };
}

export async function writeBatchesWithBusyRetry<T>(items:T[],batchSize:number,write:(batch:T[])=>Promise<unknown>,waitForIdle:()=>Promise<void>,isBusy:(error:unknown)=>boolean){
 for(let offset=0;offset<items.length;offset+=batchSize){const batch=items.slice(offset,offset+batchSize);try{await write(batch)}catch(error){if(!isBusy(error))throw error;await waitForIdle();await write(batch)}}
}
