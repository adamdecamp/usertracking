import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const application=readFileSync(new URL('../app/application/sync-user-match-application.ts',import.meta.url),'utf8');
const relabelRecovery=readFileSync(new URL('../portable-launcher/PortableEvidenceRelabelRecovery.cs',import.meta.url),'utf8');

test('selected user records expose a controlled user-information editor',()=>{
 assert.match(page,/'Edit User Information'/);
 assert.match(page,/Save User Information/);
 assert.match(page,/Official Email<input type="email"/);
 assert.match(page,/action:'Edit User Information'/);
 assert.match(application,/action:'Reconcile Edited User Evidence'/);
});

test('identity edits relabel available evidence without blocking the user correction on one stale file',()=>{
 const edit=page.slice(page.indexOf('async function editUserInformation'),page.indexOf('async function deleteUserRecord'));
 assert.ok(edit.indexOf('await requireActiveLease(root)')<edit.indexOf('relabelUserArtifacts(root,previous,savedRecord)'),'The edit must renew or safely reacquire its exclusive session before changing files or the user record.');
 assert.ok(edit.indexOf('await saveUser(savedRecord')<edit.indexOf('relabelUserArtifacts(root,previous,savedRecord)'),'The corrected user record must be durably saved before any slow evidence relabeling begins.');
 assert.match(page,/relabelUserArtifacts\(root,previous,savedRecord\)/);
 assert.doesNotMatch(page,/rollbackRelabeledArtifacts/);
 assert.match(page,/relabel-user-evidence\?path=/);
 assert.match(page,/sha256=\$\{encodeURIComponent\(expectedSha256\)\}/);
 assert.match(page,/Resolve that file collision before changing this user/);
 assert.match(page,/User Updated — Evidence Needs Review/);
 assert.match(page,/retained associations for Reconciliation/);
 assert.match(edit,/startLauncherProtectedOperation\(\)/,'A multi-file user edit must keep the launcher and editor lease active until the complete edit finishes.');
 assert.match(edit,/finally\{finishLauncherOperation\?\.\(\);syncInProgress\.current=false;lastActivity\.current=Date\.now\(\)\}/,'A user edit must always release its keep-alive after success or failure.');
});

test('a stale edit reference never starts a recursive scan of the shared organization tree',()=>{
 assert.doesNotMatch(relabelRecovery,/RelabelEvidenceCandidates\(sharedRoot/);
 assert.match(relabelRecovery,/run Reconciliation to resolve the retained evidence association/);
});
