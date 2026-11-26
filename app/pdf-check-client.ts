import {errorFromPdfCheck,runPdfCheck,type PdfCheckResponse,type PdfCheckWork} from './pdf-check-handler.ts';
import type {SaarFormFields} from './saar-form-utils.ts';

/**
 * Runs CPU-heavy PDF checks (evidence validation, SAAR form fields) in background workers so the page
 * keeps responding during Sync. The worker is a separate same-origin script, which the launcher's
 * Content-Security-Policy allows. If a worker cannot start (no Worker support, or it fails before it
 * ever answers), every check runs in the page thread exactly as before.
 */
type Slot={worker:Worker;busy:boolean;idleTimer?:ReturnType<typeof setTimeout>};
type Pending={slot:Slot;work:PdfCheckWork;resolve:(value:unknown)=>void;reject:(error:unknown)=>void;cleanup:()=>void};

const idleWorkerMs=60000,slots:Slot[]=[],waiters:((slot:Slot|undefined)=>void)[]=[],pending=new Map<number,Pending>();
let workersUnavailable=typeof Worker==='undefined',anyWorkerAnswered=false,nextId=1;

const workerLimit=()=>Math.max(1,Math.min(3,Math.floor((globalThis.navigator?.hardwareConcurrency??2)/2)));
const abortError=()=>new DOMException('Sync stopped by the operator.','AbortError');

/** How many PDF checks can truly run at once: the worker count, or 1 in the page thread. */
export function pdfCheckParallelism(){return workersUnavailable?1:workerLimit()}

function removeSlot(slot:Slot){const index=slots.indexOf(slot);if(index>=0)slots.splice(index,1);if(slot.idleTimer)clearTimeout(slot.idleTimer);try{slot.worker.terminate()}catch{}}

/** Hands freed capacity to the next waiter: a new worker, or the page thread when workers are unavailable. */
function serveWaiters(){
 while(waiters.length){
  if(workersUnavailable){waiters.shift()!(undefined);continue}
  const idle=slots.find(slot=>!slot.busy);if(idle){idle.busy=true;if(idle.idleTimer)clearTimeout(idle.idleTimer);waiters.shift()!(idle);continue}
  if(slots.length>=workerLimit())return;
  const created=createSlot();if(!created)continue;created.busy=true;waiters.shift()!(created);
 }
}

function release(slot:Slot){
 slot.busy=false;serveWaiters();
 if(!slot.busy&&slots.includes(slot)){if(slot.idleTimer)clearTimeout(slot.idleTimer);slot.idleTimer=setTimeout(()=>{if(!slot.busy)removeSlot(slot)},idleWorkerMs)}
}

/** A worker failed to load or crashed. Its checks rerun in the page thread; if no worker ever answered, workers are turned off. */
function failSlot(slot:Slot){
 removeSlot(slot);if(!anyWorkerAnswered)workersUnavailable=true;
 for(const[id,request]of Array.from(pending))if(request.slot===slot){pending.delete(id);request.cleanup();runPdfCheck(request.work).then(request.resolve,request.reject)}
 serveWaiters();
}

function createSlot():Slot|undefined{
 try{
  const worker=new Worker(new URL('./workers/pdf-check.worker.ts',import.meta.url),{type:'module'}),slot:Slot={worker,busy:false};
  worker.onmessage=(event:MessageEvent<PdfCheckResponse>)=>{const response=event.data,request=pending.get(response.id);if(!request)return;anyWorkerAnswered=true;pending.delete(response.id);request.cleanup();release(slot);if(response.ok)request.resolve(response.value);else request.reject(errorFromPdfCheck(response))};
  worker.onerror=event=>{event.preventDefault();failSlot(slot)};
  slots.push(slot);return slot;
 }catch{workersUnavailable=true;return undefined}
}

async function acquire():Promise<Slot|undefined>{
 if(workersUnavailable)return undefined;
 const idle=slots.find(slot=>!slot.busy);if(idle){idle.busy=true;if(idle.idleTimer)clearTimeout(idle.idleTimer);return idle}
 if(slots.length<workerLimit()){const created=createSlot();if(created){created.busy=true;return created}return undefined}
 return new Promise<Slot|undefined>(resolve=>waiters.push(resolve));
}

async function run(work:PdfCheckWork,signal?:AbortSignal):Promise<unknown>{
 if(signal?.aborted)throw abortError();
 const slot=await acquire();
 if(!slot)return runPdfCheck(work);
 if(signal?.aborted){release(slot);throw abortError()}
 return new Promise((resolve,reject)=>{
  const id=nextId++;
  // A stopped or timed-out check terminates its worker, because a parse in progress cannot be interrupted.
  const onAbort=()=>{if(!pending.delete(id))return;removeSlot(slot);serveWaiters();reject(abortError())};
  signal?.addEventListener('abort',onAbort,{once:true});
  pending.set(id,{slot,work,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',onAbort)});
  slot.worker.postMessage({id,...work});
 });
}

/** Full content check of one evidence file; true when it is an encrypted PDF accepted by its filename. */
export async function validateEvidenceOffThread(bytes:Uint8Array,filename:string,gateFilename:string,path:string,rootName:string,signal?:AbortSignal){
 return await run({op:'validate-evidence',bytes,filename,gateFilename,path,rootName},signal) as boolean;
}

/** Reads the SAAR form fields that Sync and Add User need. */
export async function readSaarFieldsOffThread(bytes:Uint8Array,signal?:AbortSignal){
 return await run({op:'saar-fields',bytes},signal) as SaarFormFields;
}

export function disposePdfCheckWorkers(){for(const slot of Array.from(slots))removeSlot(slot)}
if(typeof globalThis.addEventListener==='function')globalThis.addEventListener('pagehide',disposePdfCheckWorkers,{once:true});
