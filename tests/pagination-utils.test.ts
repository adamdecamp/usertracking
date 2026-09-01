import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupPageSize,paginateItems} from '../app/pagination-utils.ts';

test('shows cleanup records in pages of 20',()=>{
 const records=Array.from({length:45},(_,index)=>index+1);
 assert.equal(cleanupPageSize,20);
 assert.deepEqual(paginateItems(records,0),{items:records.slice(0,20),page:0,pageCount:3,start:0,end:20,total:45});
 assert.deepEqual(paginateItems(records,1),{items:records.slice(20,40),page:1,pageCount:3,start:20,end:40,total:45});
 assert.deepEqual(paginateItems(records,2),{items:records.slice(40),page:2,pageCount:3,start:40,end:45,total:45});
});

test('clamps cleanup pages after switching to a shorter action list',()=>{
 const records=Array.from({length:7},(_,index)=>index);
 assert.deepEqual(paginateItems(records,99),{items:records,page:0,pageCount:1,start:0,end:7,total:7});
 assert.deepEqual(paginateItems([],4),{items:[],page:0,pageCount:1,start:0,end:0,total:0});
});
