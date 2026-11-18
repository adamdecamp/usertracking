import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');

test('selected user records expose a controlled user-information editor',()=>{
 assert.match(page,/'Edit User Information'/);
 assert.match(page,/Save User Information/);
 assert.match(page,/Official Email<input type="email"/);
 assert.match(page,/action:'Edit User Information'/);
 assert.match(page,/description:\[\.\.\.details,issueSummary\]/);
});

test('identity edits relabel available evidence without blocking the user correction on one stale file',()=>{
 assert.match(page,/relabelUserArtifacts\(root,previous,proposed\)/);
 assert.match(page,/rollbackRelabeledArtifacts\(root,previous,updated,moves\)/);
 assert.match(page,/relabel-user-evidence\?path=/);
 assert.match(page,/sha256=\$\{encodeURIComponent\(expectedSha256\)\}/);
 assert.match(page,/Resolve that file collision before changing this user/);
 assert.match(page,/User Updated — Evidence Needs Review/);
 assert.match(page,/evidence reconciliation warnings/);
});
