export async function mapWithConcurrency<T,R>(items:readonly T[],concurrency:number,worker:(item:T,index:number)=>Promise<R>,options:{signal?:AbortSignal;onCompleted?:(completed:number,total:number,index:number)=>void}={}){
 const results=new Array<R>(items.length);let cursor=0,completed=0;
 const throwIfAborted=()=>{if(!options.signal?.aborted)return;const error=new Error('Sync stopped by the operator.');error.name='AbortError';throw error};
 const run=async()=>{for(;;){throwIfAborted();const index=cursor++;if(index>=items.length)return;results[index]=await worker(items[index],index);throwIfAborted();completed++;options.onCompleted?.(completed,items.length,index)}};
 const workers=Array.from({length:Math.min(items.length,Math.max(1,Math.trunc(concurrency)||1))},()=>run());
 await Promise.all(workers);return results;
}
