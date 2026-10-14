import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {destroyPdfResources} from '../app/pdf-worker-utils.ts';

const pdfTextSource=fs.readFileSync(new URL('../app/pdf-text.ts',import.meta.url),'utf8');

test('reuses a bounded PDF worker pool and recycles workers by age or document count',()=>{
 assert.match(pdfTextSource,/workerPoolLimit=2/);
 assert.match(pdfTextSource,/workerRecycleUses=50/);
 assert.match(pdfTextSource,/workerRecycleAgeMs=10\*60\*1000/);
 assert.match(pdfTextSource,/acquireWorker\(\)/);
 assert.match(pdfTextSource,/releaseWorker\(slot,healthy\)/);
 assert.match(pdfTextSource,/addEventListener\('pagehide',disposePdfWorkerPool/);
});

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
