import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationTimeoutError,withOperationTimeout} from '../app/operation-timeout.ts';

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
