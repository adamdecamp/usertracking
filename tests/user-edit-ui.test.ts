import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');

test('selected user records expose a controlled user-information editor',()=>{
 assert.match(page,/'Edit User Information'/);
 assert.match(page,/Save User Information/);
 assert.match(page,/Official Email<input type="email"/);
 assert.match(page,/Edit User Information',description:details\.join/);
});

test('identity edits safely relabel evidence and roll back failed saves',()=>{
 assert.match(page,/relabelUserArtifacts\(root,previous,proposed\)/);
 assert.match(page,/rollbackRelabeledArtifacts\(root,previous,updated,moves\)/);
 assert.match(page,/relabel-user-evidence\?path=/);
 assert.match(page,/Resolve that file collision before changing this user/);
});
