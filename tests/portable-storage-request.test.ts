import assert from'node:assert/strict';
import{test}from'node:test';
import{portableStorageRequest}from'../app/infrastructure/portable-storage-request.ts';
import{SessionLeaseLostError}from'../app/portable-request-utils.ts';

const headers=(initial?:HeadersInit)=>new Headers(initial);

test('reconciles a completed mutating operation after its browser response is lost',async()=>{
 const original=globalThis.fetch,calls:string[]=[],completed:string[]=[];
 globalThis.fetch=async input=>{const url=String(input);calls.push(url);if(!url.includes('operation-status'))throw new TypeError('connection lost');return new Response(JSON.stringify({completed:true,action:'workspace-publish',completedAtUtc:'2026-10-22T12:00:00.000Z',responseAvailable:true,response:'{"saved":"2026-10-22T12:00:00.000Z"}'}),{status:200})};
 try{
  const response=await portableStorageRequest({systemId:'storage-1',action:'workspace-publish',init:{method:'POST'},networkWriteTimeoutMs:1000,launcherHeaders:headers,onStart:id=>completed.push(`start:${id}`),onFinish:id=>completed.push(`finish:${id}`)});
  assert.equal(response.headers.has('X-RAPTOR-Reconciled-Operation'),true);
  assert.deepEqual(await response.json(),{saved:'2026-10-22T12:00:00.000Z'});
  assert.equal(calls.length,2);assert.equal(completed.length,2);assert.equal(completed[0].slice(6),completed[1].slice(7));
 }finally{globalThis.fetch=original}
});

test('retains exclusive-lease failures as session ownership errors',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('The exclusive Full Access lease is missing or is owned by another session.',{status:403});
 try{await assert.rejects(()=>portableStorageRequest({systemId:'storage-1',action:'manifest',init:{method:'POST'},networkWriteTimeoutMs:1000,launcherHeaders:headers,onStart:()=>undefined,onFinish:()=>undefined}),SessionLeaseLostError)}finally{globalThis.fetch=original}
});
