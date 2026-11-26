import {withReadRetry} from '../operation-timeout.ts';
import {pdfCheckParallelism,validateEvidenceOffThread} from '../pdf-check-client.ts';
import {withoutReworkMarker} from '../rework-marker.ts';
import {throwIfSyncCancelled} from '../sync-utils.ts';

/** Evidence files the browser reads at once for its full content check. */
export const evidenceRecheckConcurrency=3;
export type EvidenceRecheck={file:File;encryptedPdf:boolean};
export type EvidenceRechecker=(load:(signal:AbortSignal)=>Promise<File>,filename:string,path:string)=>Promise<EvidenceRecheck>;

/** A counting semaphore; each step's timeout starts only after its slot is granted. */
function slots(count:number){
 const limit=Math.max(1,Math.trunc(count)||1),waiting:(()=>void)[]=[];let active=0;
 return{async acquire(){while(active>=limit)await new Promise<void>(resolve=>waiting.push(resolve));active++},release(){active--;waiting.shift()?.()}};
}

/**
 * Runs the browser's full content check (PDF parse, one-PDF ZIP rule, encrypted-PDF filename gate)
 * for many files without doing them strictly one after another.
 * Up to `concurrency` files are read at once, so file transfer overlaps parsing.
 * Parsing runs in background workers (as many at once as there are workers), or one file at a time in the
 * page thread when workers are unavailable.
 * Each step's timeout starts only when that step starts, so one file is never timed out while it waits for another.
 * A file keeps its read slot until its parse finishes, so at most `concurrency` files are held in memory.
 */
export function createEvidenceRechecker(rootName:string,signal?:AbortSignal,concurrency=evidenceRecheckConcurrency):EvidenceRechecker{
 const reads=slots(concurrency),parses=slots(pdfCheckParallelism());
 return async(load,filename,path)=>{
  await reads.acquire();
  try{
   throwIfSyncCancelled(signal);
   const timing=(verb:string)=>({timeoutMs:30000,retryTimeoutMs:60000,signal,message:`${filename} could not be ${verb} within 30 seconds.`,retryMessage:`${filename} could not be ${verb} after one retry within 60 seconds.`});
   const loaded=await withReadRetry(async operationSignal=>{const file=await load(operationSignal);return{file,bytes:new Uint8Array(await file.arrayBuffer())}},timing('read'));throwIfSyncCancelled(signal);
   await parses.acquire();
   let encryptedPdf:boolean;
   try{encryptedPdf=await withReadRetry(async operationSignal=>{throwIfSyncCancelled(signal);const result=await validateEvidenceOffThread(loaded.bytes,filename,withoutReworkMarker(filename),path,rootName,operationSignal);throwIfSyncCancelled(operationSignal);return result},timing('validated'))}
   finally{parses.release()}
   throwIfSyncCancelled(signal);return{file:loaded.file,encryptedPdf};
  }finally{reads.release()}
 };
}
