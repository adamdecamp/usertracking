import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const application=readFileSync(new URL('../app/application/sync-user-match-application.ts',import.meta.url),'utf8');
const editApplication=readFileSync(new URL('../app/application/user-information-edit.ts',import.meta.url),'utf8');
const relabelRecovery=readFileSync(new URL('../portable-launcher/PortableEvidenceRelabelRecovery.cs',import.meta.url),'utf8');

test('selected user records expose a controlled user-information editor',()=>{
 assert.match(page,/'Edit User Information'/);
 assert.match(page,/Save User Information/);
 assert.match(page,/Official Email<input type="email"/);
 assert.match(page,/action:'Edit User Information'/);
 assert.match(application,/action:'Reconcile Edited User Evidence'/);
 assert.doesNotMatch(page,/Another record has this name and storage organization\. Resolve the duplicate before saving/);
 assert.match(page,/userInformationEditConflicts/);
});

test('identity edits relabel available evidence without blocking the user correction on one stale file',()=>{
 const edit=page.slice(page.indexOf('async function editUserInformation'),page.indexOf('async function deleteUserRecord'));
 assert.ok(edit.indexOf('await requireActiveLease(root)')<edit.indexOf('await saveUser(savedRecord'),'The edit must renew or safely reacquire its exclusive session before changing the user record.');
 assert.match(edit,/identityChanged\?\[newPendingEvidenceMove\('relabel-user',savedRecord,currentActor\(\)\)\]:\[\]/,'A name or organization change queues the file renaming for Session Commit.');
 assert.doesNotMatch(edit,/relabelUserArtifacts\(/,'Files are not renamed while the operator waits on the edit.');
 assert.match(page,/relabel:async user=>\{const relabeled=await relabelUserArtifacts\(root,user,user\)/,'Session Commit renames the files to match the saved record.');
 assert.doesNotMatch(page,/rollbackRelabeledArtifacts/);
 assert.match(page,/relabel-user-evidence\?path=/);
 assert.match(page,/sha256=\$\{encodeURIComponent\(expectedSha256\)\}/);
 assert.match(page,/Resolve that file collision before changing this user/);
 assert.match(editApplication,/User Updated — Evidence Needs Review/);
 assert.match(readFileSync(new URL('../app/application/pending-evidence-commit.ts',import.meta.url),'utf8'),/kept at the prior name for Reconciliation/);
 assert.match(edit,/startLauncherProtectedOperation\(\)/,'A multi-file user edit must keep the launcher and editor lease active until the complete edit finishes.');
 assert.match(edit,/finally\{finishLauncherOperation\?\.\(\);syncInProgress\.current=false;lastActivity\.current=Date\.now\(\)\}/,'A user edit must always release its keep-alive after success or failure.');
});

test('a stale edit reference never starts a recursive scan of the shared organization tree',()=>{
 assert.doesNotMatch(relabelRecovery,/RelabelEvidenceCandidates\(sharedRoot/);
 assert.match(relabelRecovery,/run Reconciliation to resolve the retained evidence association/);
});
