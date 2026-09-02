import assert from 'node:assert/strict';
import test from 'node:test';
import {destroyPdfResources} from '../app/pdf-worker-utils.ts';

test('destroys the loading task before the PDF worker and worker thread',async()=>{
 const calls:string[]=[];
 await destroyPdfResources(
  {destroy:async()=>{calls.push('task')}},
  {destroy:()=>{calls.push('worker')}},
  {terminate:()=>{calls.push('port')}},
 );
 assert.deepEqual(calls,['task','worker','port']);
});

test('continues cleanup when an earlier destroy operation fails',async()=>{
 const calls:string[]=[];
 await destroyPdfResources(
  {destroy:async()=>{calls.push('task');throw new Error('task cleanup failed')}},
  {destroy:()=>{calls.push('worker');throw new Error('worker cleanup failed')}},
  {terminate:()=>{calls.push('port')}},
 );
 assert.deepEqual(calls,['task','worker','port']);
});

test('does not wait forever for a hung PDF loading-task destroy',async()=>{
 const calls:string[]=[];const started=Date.now();
 await destroyPdfResources({destroy:()=>new Promise(()=>undefined)},{destroy:()=>calls.push('worker')},{terminate:()=>calls.push('port')},10);
 assert.ok(Date.now()-started<250);assert.deepEqual(calls,['worker','port']);
});
