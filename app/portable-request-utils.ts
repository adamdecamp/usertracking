type PortableFetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;

export function portableActionLabel(action:string){
 const value=action.split('?')[0].replace(/[^A-Za-z0-9_-]+/g,' ').replace(/[-_]+/g,' ').trim();
 return (value||'storage request').slice(0,100);
}

function aborted(error:unknown,signal?:AbortSignal|null){
 return signal?.aborted===true||error instanceof DOMException&&error.name==='AbortError'||error instanceof Error&&error.name==='AbortError';
}

export async function portableFetch(fetcher:PortableFetcher,url:string,action:string,init?:RequestInit,retrySafe=false,delayMs=200){
 const attempts=retrySafe?2:1;
 for(let attempt=1;attempt<=attempts;attempt++)try{
  return await fetcher(url,init);
 }catch(error){
  if(aborted(error,init?.signal))throw error;
  if(attempt<attempts){await new Promise(resolve=>setTimeout(resolve,delayMs));continue}
  const stage=portableActionLabel(action),suffix=attempts===1?'':' after one safe retry';
  throw new Error(`The local Windows launcher stopped responding during ${stage}${suffix}. The browser connection may have been interrupted or the launcher may have exited. Reopen the application if its system-tray icon is no longer present.`,{cause:error});
 }
 throw new Error('The local Windows launcher request did not complete.');
}
