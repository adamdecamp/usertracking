export function throwIfSyncCancelled(signal?:AbortSignal){
 if(signal?.aborted)throw new DOMException('Sync stopped by the operator.','AbortError');
}

export function isSyncCancellation(error:unknown){
 return error instanceof DOMException&&error.name==='AbortError';
}
