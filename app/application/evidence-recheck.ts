import {inspectEvidenceBytes,validateReadableOrStrictEncryptedEvidence} from '../evidence-validation.ts';
import {withReadRetry} from '../operation-timeout.ts';
import {withoutReworkMarker} from '../rework-marker.ts';
import {throwIfSyncCancelled} from '../sync-utils.ts';

/** Evidence files the browser reads at once for its full content check. */
export const evidenceRecheckConcurrency=3;
export type EvidenceRecheck={file:File;encryptedPdf:boolean};
export type EvidenceRechecker=(load:(signal:AbortSignal)=>Promise<File>,filename:string,path:string)=>Promise<EvidenceRecheck>;

/**
 * Runs the browser's full content check (PDF parse, one-PDF ZIP rule, encrypted-PDF filename gate)
 * for many files without doing them strictly one after another.
 * Up to `concurrency` files are read at once, so file transfer overlaps parsing.
 * Parsing itself stays one file at a time because it runs on the page thread.
 * Each step's timeout starts only when that step starts, so one file is never timed out while it waits for another.
 * A file keeps its slot until its parse finishes, so at most `concurrency` files are held in memory.
 */
export function createEvidenceRechecker(rootName:string,signal?:AbortSignal,concurrency=evidenceRecheckConcurrency):EvidenceRechecker{
 const limit=Math.max(1,Math.trunc(concurrency)||1),waiting:(()=>void)[]=[];let active=0,parseQueue:Promise<unknown>=Promise.resolve();
 const acquire=async()=>{while(active>=limit)await new Promise<void>(resolve=>waiting.push(resolve));active++};
 const release=()=>{active--;waiting.shift()?.()};
 const oneAtATime=<T>(task:()=>Promise<T>)=>{const run=parseQueue.then(task,task);parseQueue=run.catch(()=>undefined);return run};
 return async(load,filename,path)=>{
  await acquire();
  try{
   throwIfSyncCancelled(signal);
   const timing=(verb:string)=>({timeoutMs:30000,retryTimeoutMs:60000,signal,message:`${filename} could not be ${verb} within 30 seconds.`,retryMessage:`${filename} could not be ${verb} after one retry within 60 seconds.`});
   const loaded=await withReadRetry(async operationSignal=>{const file=await load(operationSignal);return{file,bytes:new Uint8Array(await file.arrayBuffer())}},timing('read'));throwIfSyncCancelled(signal);
   const encryptedPdf=await oneAtATime(()=>withReadRetry(async operationSignal=>{throwIfSyncCancelled(signal);const result=await validateReadableOrStrictEncryptedEvidence(inspectEvidenceBytes(filename,loaded.bytes),withoutReworkMarker(filename),path,rootName);throwIfSyncCancelled(operationSignal);return result},timing('validated')));
   throwIfSyncCancelled(signal);return{file:loaded.file,encryptedPdf};
  }finally{release()}
 };
}
