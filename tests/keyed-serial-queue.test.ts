import assert from 'node:assert/strict';
import test from 'node:test';
import {createKeyedSerialQueue,writeBatchesWithBusyRetry} from '../app/application/keyed-serial-queue.ts';

test('serializes audit work for one system without blocking another mapped system',async()=>{
 const enqueue=createKeyedSerialQueue(),events:string[]=[];
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});
 const first=enqueue('system-a',async()=>{events.push('a1-start');await gate;events.push('a1-end')});
 const second=enqueue('system-a',async()=>{events.push('a2')});
 const other=enqueue('system-b',async()=>{events.push('b1')});
 await other;assert.deepEqual(events,['a1-start','b1']);
 release();await Promise.all([first,second]);assert.deepEqual(events,['a1-start','b1','a1-end','a2']);
});

test('continues a system queue after an earlier operation fails',async()=>{
 const enqueue=createKeyedSerialQueue();
 await assert.rejects(()=>enqueue('system',async()=>{throw new Error('expected')}));
 assert.equal(await enqueue('system',async()=>42),42);
});

test('waits for a busy audit writer and retries the same bounded batch once',async()=>{
 let writes=0,waits=0;
 await writeBatchesWithBusyRetry(['one','two'],10000,async batch=>{assert.deepEqual(batch,['one','two']);if(++writes===1)throw new Error('busy')},async()=>{waits++},error=>error instanceof Error&&error.message==='busy');
 assert.equal(writes,2);assert.equal(waits,1);
});
