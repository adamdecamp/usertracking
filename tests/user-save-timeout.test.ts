import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');

test('user updates rely on the local-first manifest writer timeout and receipt reconciliation',()=>{
 assert.match(page,/await writeSystemManifest\(root,u\.systemId,nextSystems,nextUsers\);setSystems\(nextSystems\);setUsers\(nextUsers\)/);
 assert.doesNotMatch(page,/Saving the updated user database and verified backup exceeded the two-minute safety limit/);
});

test('user deletion does not reintroduce the obsolete two-minute database wrapper',()=>{
 assert.match(page,/await writeSystemManifest\(root,user\.systemId,nextSystems,nextUsers\);setSystems\(nextSystems\);setUsers\(nextUsers\)/);
 assert.doesNotMatch(page,/Saving the database after user deletion exceeded the two-minute safety limit/);
});
