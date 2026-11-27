import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import test from 'node:test';

// scripts/regression-tests.txt is the only list `pnpm test` and the build gate run. A test file left out of it
// never runs, and its checks go stale without anyone noticing. These tests keep the list and the folder the same.
const root=new URL('../',import.meta.url);
const listed=readFileSync(new URL('scripts/regression-tests.txt',root),'utf8').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
/** Run separately by `pnpm run test:fuzz`. */
const runSeparately=['tests/fuzz.test.ts'];

test('every test file in tests/ is in the regression list',()=>{
 const onDisk=readdirSync(new URL('tests/',root)).filter(name=>name.endsWith('.test.ts')).map(name=>`tests/${name}`);
 assert.ok(onDisk.length>50,'the tests folder was read');
 assert.deepEqual(onDisk.filter(file=>!listed.includes(file)&&!runSeparately.includes(file)),[],'add these files to scripts/regression-tests.txt');
});

test('every file in the regression list exists and is listed once',()=>{
 assert.deepEqual(listed.filter(file=>!existsSync(new URL(file,root))),[],'remove these missing files from scripts/regression-tests.txt');
 assert.deepEqual(listed.filter((file,index)=>listed.indexOf(file)!==index),[],'no file is listed twice');
 for(const file of runSeparately)assert.ok(!listed.includes(file)&&existsSync(new URL(file,root)),`${file} runs on its own`);
 assert.match(readFileSync(new URL('package.json',root),'utf8'),/"test:fuzz": "node --experimental-strip-types --test tests\/fuzz\.test\.ts"/);
});
