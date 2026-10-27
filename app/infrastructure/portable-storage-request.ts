import {PortableStorageBusyError,SessionLeaseLostError,portableErrorMessage,portableFetch} from '../portable-request-utils.ts';
import {decodeStorageOperationReceipt} from './portable-contracts.ts';
import {decodeJsonResponse} from './runtime-decoders.ts';

type StorageRequestOptions={
 systemId:string;
 action:string;
 init?:RequestInit;
 networkWriteTimeoutMs:number;
 launcherHeaders:(initial?:HeadersInit)=>Headers;
 onStart:(operationId:string,stage:string)=>void;
 onFinish:(operationId:string)=>void;
};

export async function portableStorageRequest(options:StorageRequestOptions){
 const{systemId,action,init,networkWriteTimeoutMs,launcherHeaders,onStart,onFinish}=options,method=(init?.method??'GET').toUpperCase(),stage=action.split('?')[0],retrySafe=method==='GET'&&/^(?:manifest|scan|locations|backups|verify|audit-verify|audit-view|last-logon|performance|diagnostics|recovery|catalog-recovery|file|organizations|evidence-status|evidence-pdf-status|evidence-exists)(?:[?]|$)/.test(action),operationId=crypto.randomUUID(),headers=launcherHeaders(init?.headers);headers.set('X-Tracker-Operation-Id',operationId);
 const timeoutMs=stage==='scan'||stage==='rework-retention'||stage==='sync-pipeline'||stage==='workspace-publish'?4*60*60*1000:stage==='select'||stage==='select-readonly'||stage.startsWith('unarchive-select')||stage==='restore'?15*60*1000:stage==='manifest'||stage==='csv'||stage==='state-commit'?networkWriteTimeoutMs:stage==='evidence'||stage==='evidence-pdf'||stage==='file'?5*60*1000:stage==='evidence-status'||stage==='evidence-pdf-status'?90_000:5*60*1000,requestInit={credentials:'same-origin' as const,cache:'no-store' as const,...init,headers};
 onStart(operationId,stage.replaceAll('-',' '));
 try{
  let response:Response;
  try{response=await portableFetch(fetch,`/api/storage/${encodeURIComponent(systemId)}/${action}`,action,requestInit,retrySafe,750,timeoutMs)}catch(error){
   const mayHaveCompleted=(method==='POST'||method==='DELETE')&&!['select','select-readonly'].includes(stage)&&!init?.signal?.aborted;
   if(!mayHaveCompleted)throw error;
   try{
    const receiptResponse=await portableFetch(fetch,`/api/storage/${encodeURIComponent(systemId)}/operation-status?operation=${encodeURIComponent(operationId)}`,'operation status',{credentials:'same-origin',cache:'no-store',headers:launcherHeaders()},true,500,30_000);
    if(receiptResponse.ok){const receipt=await decodeJsonResponse(receiptResponse,'Storage operation receipt',decodeStorageOperationReceipt,2*1024*1024+4096);if(receipt.completed&&receipt.action===stage&&receipt.responseAvailable&&receipt.response)return new Response(receipt.response,{status:200,headers:{'Content-Type':'application/json; charset=utf-8','X-RAPTOR-Reconciled-Operation':operationId}})}
   }catch{/* Preserve the original transport error when the receipt is absent or unavailable. */}
   throw error;
  }
  if(!response.ok){const message=portableErrorMessage((await response.text()).replace(/[\r\n\0]+/g,' ').trim(),operationId);if(response.status===503)throw new PortableStorageBusyError(message);if(response.status===403&&/exclusive Full Access lease/i.test(message))throw new SessionLeaseLostError(message);throw new Error(message)}return response;
 }finally{onFinish(operationId)}
}
