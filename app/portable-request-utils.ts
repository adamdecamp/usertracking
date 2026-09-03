type PortableFetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;

export class PortableRequestTimeoutError extends Error{
 constructor(message:string){super(message);this.name='PortableRequestTimeoutError'}
}

export class PortableStorageBusyError extends Error{
 constructor(message:string){super(message);this.name='PortableStorageBusyError'}
}

export function portableActionLabel(action:string){
 const value=action.split('?')[0].replace(/[^A-Za-z0-9_-]+/g,' ').replace(/[-_]+/g,' ').trim();
 return (value||'storage request').slice(0,100);
}

export function portableArchiveAction(path:string,requestedFilename?:string){
 return `archive?path=${encodeURIComponent(path)}&filename=${encodeURIComponent(requestedFilename??'')}`;
}

function aborted(error:unknown,signal?:AbortSignal|null){
 return signal?.aborted===true||error instanceof DOMException&&error.name==='AbortError'||error instanceof Error&&error.name==='AbortError';
}

function wait(delayMs:number,signal?:AbortSignal|null){
 return new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){const error=new Error('The operation was stopped.');error.name='AbortError';reject(error);return}
  const timer=setTimeout(done,Math.max(0,delayMs));function done(){signal?.removeEventListener('abort',cancel);resolve()}function cancel(){clearTimeout(timer);const error=new Error('The operation was stopped.');error.name='AbortError';reject(error)}signal?.addEventListener('abort',cancel,{once:true});
 })
}

async function timedFetch(fetcher:PortableFetcher,url:string,action:string,init:RequestInit|undefined,timeoutMs:number){
 const external=init?.signal,controller=new AbortController(),stage=portableActionLabel(action);let timedOut=false;
 if(external?.aborted){const error=new Error('The operation was stopped.');error.name='AbortError';throw error}
 let timer:ReturnType<typeof setTimeout>|undefined,cancelReject:(error:Error)=>void=()=>undefined;
 const cancelled=new Promise<never>((_resolve,reject)=>{cancelReject=reject}),cancel=()=>{controller.abort();const error=new Error('The operation was stopped.');error.name='AbortError';cancelReject(error)},timeout=timeoutMs>0?new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new PortableRequestTimeoutError(`The local Windows launcher did not finish ${stage} within ${Math.ceil(timeoutMs/1000)} seconds. The request was stopped in the browser and its operation ID can be used to reconcile any late filesystem completion.`))},timeoutMs)}):undefined;
 external?.addEventListener('abort',cancel,{once:true});
 try{const request=fetcher(url,{...init,signal:controller.signal}),pending=[request,cancelled,...(timeout?[timeout]:[])];return await Promise.race(pending)}
 catch(error){
  if(timedOut&&!(error instanceof PortableRequestTimeoutError))throw new PortableRequestTimeoutError(`The local Windows launcher did not finish ${stage} within ${Math.ceil(timeoutMs/1000)} seconds. The request was stopped in the browser and its operation ID can be used to reconcile any late filesystem completion.`);
  throw error;
 }finally{if(timer!==undefined)clearTimeout(timer);external?.removeEventListener('abort',cancel)}
}

export async function portableFetch(fetcher:PortableFetcher,url:string,action:string,init?:RequestInit,retrySafe=false,delayMs=200,timeoutMs=120000){
 const attempts=retrySafe?2:1;
 for(let attempt=1;attempt<=attempts;attempt++)try{
  return await timedFetch(fetcher,url,action,init,timeoutMs);
 }catch(error){
  if(aborted(error,init?.signal))throw error;
  if(attempt<attempts){await wait(delayMs,init?.signal);continue}
  const stage=portableActionLabel(action),suffix=attempts===1?'':' after one safe retry';
  if(error instanceof PortableRequestTimeoutError)throw error;
  throw new Error(`The local Windows launcher stopped responding during ${stage}${suffix}. The browser connection may have been interrupted or the launcher may have exited. Reopen the application if its system-tray icon is no longer present.`,{cause:error});
 }
 throw new Error('The local Windows launcher request did not complete.');
}
