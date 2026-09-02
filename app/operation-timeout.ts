export class OperationTimeoutError extends Error{
 constructor(message:string){super(message);this.name='OperationTimeoutError'}
}

export function withOperationTimeout<T>(operation:(signal:AbortSignal)=>Promise<T>,options:{timeoutMs:number;message:string;signal?:AbortSignal}){
 const timeoutMs=Math.max(1,Math.min(Math.trunc(options.timeoutMs),120000)),controller=new AbortController();
 return new Promise<T>((resolve,reject)=>{
  if(options.signal?.aborted){const error=new Error('Sync stopped by the operator.');error.name='AbortError';reject(error);return}
  let settled=false;
  const finish=(action:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);action()};
  const abort=()=>{controller.abort();const error=new Error('Sync stopped by the operator.');error.name='AbortError';finish(()=>reject(error))};
  const timer=setTimeout(()=>{controller.abort();finish(()=>reject(new OperationTimeoutError(options.message)))},timeoutMs);
  options.signal?.addEventListener('abort',abort,{once:true});
 Promise.resolve().then(()=>operation(controller.signal)).then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
 })
}

export async function withReadRetry<T>(operation:(signal:AbortSignal,attempt:1|2)=>Promise<T>,options:{timeoutMs:number;retryTimeoutMs?:number;message:string;retryMessage?:string;signal?:AbortSignal;onRetry?:()=>void}){
 try{return await withOperationTimeout(signal=>operation(signal,1),options)}catch(error){
  if(!(error instanceof OperationTimeoutError)||options.signal?.aborted)throw error;
  options.onRetry?.();
  return withOperationTimeout(signal=>operation(signal,2),{timeoutMs:options.retryTimeoutMs??Math.min(options.timeoutMs*2,120000),message:options.retryMessage??options.message,signal:options.signal});
 }
}
