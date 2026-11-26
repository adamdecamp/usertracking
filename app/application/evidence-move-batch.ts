import {SessionLeaseLostError} from '../portable-request-utils.ts';

/**
 * Sync organizes and renames files in batches of this many per launcher request. A batch
 * saves a browser round trip and a shared lease-fence read for every file. It stays small
 * so a stopped or timed-out request leaves only a few files to reconcile on the next scan.
 */
export const evidenceMoveBatchSize=10;
/** One launcher request for a batch may take as long as the slowest network write. */
export const evidenceMoveBatchTimeoutMs=10*60*1000;

export type EvidenceMoveOutcome<T>={ok:true;value:T}|{ok:false;error:Error};

const asError=(error:unknown)=>error instanceof Error?error:new Error(String(error));

/** Runs each move on its own, in order, keeping every file's result or error (the browser-folder path). */
export async function settleEach<Item,Value>(items:readonly Item[],run:(item:Item)=>Promise<Value>){
 const outcomes:EvidenceMoveOutcome<Value>[]=[];
 for(const item of items)try{outcomes.push({ok:true,value:await run(item)})}catch(error){outcomes.push({ok:false,error:asError(error)})}
 return outcomes;
}

/** Turns the launcher's per-file batch results into outcomes, in request order. */
export function evidenceMoveOutcomes<Raw,Value>(response:unknown,expected:number,convert:(value:Raw,index:number)=>Value):EvidenceMoveOutcome<Value>[]{
 if(!Array.isArray(response)||response.length!==expected)throw new Error('The launcher returned an evidence batch result that does not match the request.');
 return response.map((item,index):EvidenceMoveOutcome<Value>=>{
  const entry=(item&&typeof item==='object'?item:{}) as {ok?:unknown;result?:unknown;error?:unknown;leaseLost?:unknown};
  if(entry.ok===true&&entry.result&&typeof entry.result==='object')return{ok:true,value:convert(entry.result as Raw,index)};
  const message=typeof entry.error==='string'&&entry.error.trim()?entry.error.trim():'The evidence file could not be changed.';
  return{ok:false,error:entry.leaseLost===true?new SessionLeaseLostError(message):new Error(message)};
 });
}

/**
 * Sends items in batches and hands every file's outcome to onOutcome in the original order,
 * exactly as the one-file-at-a-time loops did. If a whole batch request fails, each file in
 * it receives that failure, so the caller records it the same way it recorded one file.
 */
export async function runEvidenceMoveBatches<Item,Value>(items:readonly Item[],runBatch:(batch:Item[])=>Promise<EvidenceMoveOutcome<Value>[]>,onOutcome:(item:Item,outcome:EvidenceMoveOutcome<Value>,index:number)=>void|Promise<void>,options:{size?:number;beforeBatch?:()=>void}={}){
 const size=Math.max(1,Math.floor(options.size??evidenceMoveBatchSize));
 for(let start=0;start<items.length;start+=size){
  options.beforeBatch?.();
  const batch=items.slice(start,start+size);let outcomes:EvidenceMoveOutcome<Value>[];
  try{outcomes=await runBatch(batch);if(outcomes.length!==batch.length)throw new Error('The evidence batch result count does not match the request.')}
  catch(error){const failure=asError(error);outcomes=batch.map(()=>({ok:false,error:failure}))}
  for(const[offset,item]of batch.entries())await onOutcome(item,outcomes[offset],start+offset);
 }
}
