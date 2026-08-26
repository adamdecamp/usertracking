import test from 'node:test';
import assert from 'node:assert/strict';
import {distinctByPath,selectSupersededEvidence} from '../app/cleanup-utils.ts';

type Item={path:string;date:string;current:boolean};
const select=(items:Item[])=>selectSupersededEvidence(items,item=>new Date(item.date),item=>item.current,item=>item.path);

test('offers older and duplicate evidence only when the selected newest file is current',()=>{
 const result=select([
  {path:'older.pdf',date:'2025-08-24T00:00:00Z',current:false},
  {path:'current.pdf',date:'2026-08-24T00:00:00Z',current:true},
  {path:'duplicate-current.pdf',date:'2026-08-24T00:00:00Z',current:true},
 ]);
 assert.equal(result.current?.path,'current.pdf');
 assert.deepEqual(result.superseded.map(item=>item.path),['duplicate-current.pdf','older.pdf']);
});

test('does not offer cleanup when the newest evidence is not current',()=>{
 const result=select([
  {path:'newer-overdue.pdf',date:'2024-08-24T00:00:00Z',current:false},
  {path:'older.pdf',date:'2023-08-24T00:00:00Z',current:false},
 ]);
 assert.equal(result.current,undefined);
 assert.deepEqual(result.superseded,[]);
});

test('deduplicates cleanup actions by case-insensitive Windows path',()=>{
 const result=distinctByPath([
  {path:'User Evidence/GOV/Shaw/file.pdf',kind:'first'},
  {path:'user evidence\\gov\\shaw\\FILE.PDF',kind:'duplicate'},
  {path:'User Evidence/GOV/Shaw/other.pdf',kind:'other'},
 ]);
 assert.deepEqual(result.map(item=>item.kind),['first','other']);
});
