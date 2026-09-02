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
