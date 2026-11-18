import assert from 'node:assert/strict';
import test from 'node:test';
import {runBestEffort} from '../app/application/user-information-edit.ts';

test('best-effort evidence relabeling completes other files after an individual failure',async()=>{
 const visited:string[]=[];
 const result=await runBestEffort(['SAAR','DoD Cyber Cert','User Agreement'],async item=>{
  visited.push(item);
  if(item==='DoD Cyber Cert')throw new Error('stale evidence path');
  return`${item} moved`;
 },error=>error instanceof Error?error.message:'unknown error');

 assert.deepEqual(visited,['SAAR','DoD Cyber Cert','User Agreement']);
 assert.deepEqual(result.completed,['SAAR moved','User Agreement moved']);
 assert.deepEqual(result.failures,[{item:'DoD Cyber Cert',reason:'stale evidence path'}]);
});

test('best-effort evidence relabeling reports every failed file without throwing',async()=>{
 const result=await runBestEffort([1,2],async item=>{throw new Error(`failure ${item}`)},error=>error instanceof Error?error.message:'unknown error');
 assert.deepEqual(result.completed,[]);
 assert.deepEqual(result.failures,[{item:1,reason:'failure 1'},{item:2,reason:'failure 2'}]);
});
