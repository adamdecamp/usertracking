import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const helpers=readFileSync(new URL('../app/page-helpers.ts',import.meta.url),'utf8');
// page-helpers.ts imports browser-only modules, so the function under test is evaluated from its own source line.
const source=helpers.match(/export function withoutTrailingPunctuation\(text:string\)\{([^\n]*)\}\r?\n/);
assert.ok(source,'withoutTrailingPunctuation is defined on one line');
const withoutTrailingPunctuation=new Function('text',source[1]) as (text:string)=>string;
const previous=(text:string)=>text.replace(/[.:]+$/,'');

test('notification titles drop trailing periods and colons exactly as before',()=>{
 for(const value of ['Sync failed.','Sync failed:','Sync failed.:..','Sync. failed','...','','No punctuation','a.b.c.',':x:','.'.repeat(50)+'x'])assert.equal(withoutTrailingPunctuation(value),previous(value),JSON.stringify(value));
});

test('a long run of periods that is not at the end stays fast',()=>{
 const hostile=`${'.'.repeat(20_000)}x`,started=performance.now();
 assert.equal(withoutTrailingPunctuation(hostile),hostile);
 assert.ok(performance.now()-started<50);
 assert.match(helpers,/notify\(reported\.message,'error',withoutTrailingPunctuation\(context\)\)/);
 assert.doesNotMatch(helpers,/\/\[\.:\]\+\$\//,'the backtracking pattern is gone');
});
