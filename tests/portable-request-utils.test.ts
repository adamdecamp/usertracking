import test from 'node:test';
import assert from 'node:assert/strict';
import {PortableRequestTimeoutError,portableActionLabel,portableArchiveAction,portableFetch} from '../app/portable-request-utils.ts';

test('keeps launcher failure stages useful without exposing query values',()=>{
 assert.equal(portableActionLabel('scan?rules=secret&full=1'),'scan');
 assert.equal(portableActionLabel('normalize-date?path=Sensitive%20Name.pdf'),'normalize date');
});

test('always supplies the optional archive filename request value',()=>{
 const defaultName=new URLSearchParams(portableArchiveAction('GDMS/User Evidence/file.pdf.zip').split('?')[1]);
 assert.equal(defaultName.get('path'),'GDMS/User Evidence/file.pdf.zip');
 assert.equal(defaultName.get('filename'),'');
 const collision=new URLSearchParams(portableArchiveAction('GDMS/source.pdf','target conflict.pdf').split('?')[1]);
 assert.equal(collision.get('filename'),'target conflict.pdf');
});

test('retries a resumable or idempotent launcher request once',async()=>{
 let calls=0;
 const response=await portableFetch(async()=>{
  calls++;
  if(calls===1)throw new TypeError('Failed to fetch');
  return new Response('ok',{status:200});
 },'/api/storage/system/scan','scan?rules=1',undefined,true,0);
 assert.equal(response.status,200);
 assert.equal(calls,2);
});

test('does not retry an unsafe launcher write',async()=>{
 let calls=0;
 await assert.rejects(()=>portableFetch(async()=>{calls++;throw new TypeError('Failed to fetch')},'/api/storage/system/archive','archive?path=private',undefined,false,0),/during archive/);
 assert.equal(calls,1);
});

test('preserves cancellation without converting it to a launcher failure',async()=>{
 const controller=new AbortController();
 controller.abort();
 await assert.rejects(()=>portableFetch(async()=>new Response('unused'),'/api/storage/system/scan','scan',{signal:controller.signal},true,0),error=>error instanceof Error&&error.name==='AbortError'&&!/launcher stopped responding/i.test(error.message));
});

test('times out an unresponsive launcher request and aborts its fetch signal',async()=>{
 let fetchSignal:AbortSignal|null|undefined;
 await assert.rejects(()=>portableFetch(async(_url,init)=>{fetchSignal=init?.signal;return new Promise<Response>(()=>undefined)},'/api/storage/system/archive','archive',undefined,false,0,10),error=>error instanceof PortableRequestTimeoutError&&/within 1 seconds/.test(error.message));
 assert.equal(fetchSignal?.aborted,true);
});
