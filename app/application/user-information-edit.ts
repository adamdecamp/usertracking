export type BestEffortFailure<T>={item:T;reason:string};

export type BestEffortResult<T,R>={
 completed:R[];
 failures:BestEffortFailure<T>[];
};

/**
 * Runs independent evidence corrections sequentially so one stale or missing
 * file cannot prevent the remaining files or the user record from being
 * corrected. Storage mutations remain sequential to preserve launcher locks.
 */
export async function runBestEffort<T,R>(
 items:readonly T[],
 operation:(item:T)=>Promise<R>,
 describeError:(error:unknown)=>string,
):Promise<BestEffortResult<T,R>>{
 const completed:R[]=[];
 const failures:BestEffortFailure<T>[]=[];
 for(const item of items){
  try{completed.push(await operation(item))}
  catch(error){failures.push({item,reason:describeError(error)})}
 }
 return{completed,failures};
}
