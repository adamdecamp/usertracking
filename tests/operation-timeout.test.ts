import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationTimeoutError,withOperationTimeout,withReadRetry} from '../app/operation-timeout.ts';

test('returns a completed operation before its safety limit',async()=>{
 assert.equal(await withOperationTimeout(async()=>42,{timeoutMs:100,message:'timed out'}),42);
});

test('aborts and rejects an operation that exceeds its safety limit',async()=>{
 let operationSignal:AbortSignal|undefined;
 await assert.rejects(withOperationTimeout(signal=>{operationSignal=signal;return new Promise(()=>undefined)},{timeoutMs:10,message:'SAAR read timed out'}),error=>error instanceof OperationTimeoutError&&error.message==='SAAR read timed out');
 assert.equal(operationSignal?.aborted,true);
});

test('propagates an operator cancellation independently of the timeout',async()=>{
 const controller=new AbortController(),pending=withOperationTimeout(()=>new Promise(()=>undefined),{timeoutMs:1000,message:'timed out',signal:controller.signal});controller.abort();
 await assert.rejects(pending,error=>error instanceof Error&&error.name==='AbortError');
});

test('retries a timed-out read once with a fresh operation',async()=>{
 let attempts=0,retries=0;
 const result=await withReadRetry(async(_signal,attempt)=>{attempts++;if(attempt===1)return new Promise<string>(()=>undefined);return'complete'},{timeoutMs:10,retryTimeoutMs:50,message:'first read timed out',retryMessage:'retry timed out',onRetry:()=>retries++});
 assert.equal(result,'complete');assert.equal(attempts,2);assert.equal(retries,1);
});

test('does not retry a deterministic read failure',async()=>{
 let attempts=0;
 await assert.rejects(withReadRetry(async()=>{attempts++;throw new Error('invalid PDF')},{timeoutMs:50,message:'timed out'}),/invalid PDF/);
 assert.equal(attempts,1);
});
