import test from 'node:test';
import assert from 'node:assert/strict';
import {mapWithConcurrency} from '../app/concurrency-utils.ts';

test('processes work with bounded concurrency while preserving result order',async()=>{
 let active=0,maximum=0;const completed:number[]=[];
 const result=await mapWithConcurrency([40,5,25,10],2,async(value,index)=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,value));active--;return`${index}:${value}`},{onCompleted:value=>completed.push(value)});
 assert.deepEqual(result,['0:40','1:5','2:25','3:10']);
 assert.equal(maximum,2);assert.deepEqual(completed,[1,2,3,4]);
});

test('rejects promptly when cancelled',async()=>{
 const controller=new AbortController(),pending=mapWithConcurrency([1,2,3],2,async()=>{await new Promise(resolve=>setTimeout(resolve,20));return true},{signal:controller.signal});
 controller.abort();await assert.rejects(pending,error=>error instanceof Error&&error.name==='AbortError');
});

test('continues the bounded batch when an item records its own failure',async()=>{
 const result=await mapWithConcurrency([1,2,3,4],2,async value=>value===2?{value,error:'unreadable'}:{value,result:value*10});
 assert.deepEqual(result,[{value:1,result:10},{value:2,error:'unreadable'},{value:3,result:30},{value:4,result:40}]);
});
