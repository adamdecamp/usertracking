import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {decodeWorkspaceStatusResponse} from '../app/infrastructure/portable-contracts.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');

test('workspace status decoder accepts the bounded local preflight contract',()=>{
 const hash='a'.repeat(64),result=decodeWorkspaceStatusResponse({
  noChanges:true,
  stateHash:hash,
  databaseChangePending:false,
  pendingEvidenceCount:0,
  interruptedRecovery:false,
  evidenceWorkPending:false,
  saved:'2026-10-19T12:00:00.000Z',
  backup:'2026-10-19T12:00:00.000Z',
 });
 assert.equal(result.noChanges,true);
 assert.equal(result.stateHash,hash);
 assert.equal(result.databaseChangePending,false);
 assert.equal(result.pendingEvidenceCount,0);
 assert.equal(result.interruptedRecovery,false);
 assert.equal(result.evidenceWorkPending,false);
 assert.equal(result.saved,'2026-10-19T12:00:00.000Z');
 assert.equal(result.backup,'2026-10-19T12:00:00.000Z');
});

test('workspace status decoder rejects malformed and contradictory status records',()=>{
 const hash='b'.repeat(64),base={noChanges:false,stateHash:hash,databaseChangePending:false,pendingEvidenceCount:1,interruptedRecovery:false,evidenceWorkPending:true,saved:'2026-10-19T12:00:00.000Z',backup:'2026-10-19T12:00:00.000Z'};
 assert.throws(()=>decodeWorkspaceStatusResponse({...base,stateHash:'bad'}),/state hash/i);
 assert.throws(()=>decodeWorkspaceStatusResponse({...base,pendingEvidenceCount:-1}),/pendingEvidenceCount|pending evidence/i);
 assert.throws(()=>decodeWorkspaceStatusResponse({...base,pendingEvidenceCount:1.5}),/pendingEvidenceCount|pending evidence/i);
 assert.throws(()=>decodeWorkspaceStatusResponse({...base,noChanges:true,databaseChangePending:true}),/no changes|contradict/i);
 assert.throws(()=>decodeWorkspaceStatusResponse({...base,evidenceWorkPending:false}),/evidence work|contradict/i);
});

test('Session Commit checks local state before renewing the shared lease or publishing',()=>{
 const publish=page.slice(page.indexOf('async function publishSystemWorkspace'),page.indexOf('async function publishForShutdown'));
 const statusIndex=publish.indexOf("'workspace-status"),noChangeIndex=publish.indexOf('.noChanges'),leaseIndex=publish.indexOf('requireActiveLease(h)'),publicationIndex=publish.indexOf("'workspace-publish");
 assert.ok(statusIndex>=0,'Session Commit must request local workspace status.');
 assert.ok(noChangeIndex>statusIndex,'Session Commit must evaluate the local no-change result.');
 assert.match(publish.slice(statusIndex,noChangeIndex),/JSON\.stringify\(\{stateHash\}\)/,'Local preflight must send only the bounded state hash, not the full database or CSV.');
 assert.ok(leaseIndex<0||leaseIndex>noChangeIndex,'A no-op Session Commit must return before any explicit shared-drive lease renewal.');
 assert.ok(publicationIndex>noChangeIndex,'Only a real pending change may proceed to shared publication.');
 const firstSharedAction=leaseIndex>=0?Math.min(leaseIndex,publicationIndex):publicationIndex;
 assert.match(publish.slice(noChangeIndex,firstSharedAction),/\breturn\b/,'The local no-change path must return before any shared action.');
 assert.match(launcher,/action == "workspace-status"[\s\S]*?WorkspaceStatus/,'The loopback launcher must expose the local-only status operation.');
});

test('Session Commit reports distinct local, publication, verification, and finalization phases',()=>{
 const commit=page.slice(page.indexOf('async function commitSession'),page.indexOf('async function logOff'));
 const publish=page.slice(page.indexOf('async function publishSystemWorkspace'),page.indexOf('async function publishForShutdown'));
 assert.match(commit,/Checking Local Changes/);
 assert.match(publish,/Preparing Evidence/);
 assert.match(publish,/Publishing to Shared Drive/);
 assert.match(publish,/Verifying Shared Publication/);
 assert.match(publish,/Finalizing Session Commit/);
 assert.match(publish,/monitorWorkspacePublication/,'Manual Session Commit must poll the durable launcher journal while publication is running.');
 assert.match(page,/progress\.processed,progress\.total/,'The status bar must show file movement progress, not only an indeterminate stage.');
 assert.doesNotMatch(commit,/Checking for Pending Changes/,'The former catch-all phase must not conceal network publication work.');
});

test('Session Commit queue wait matches its long-running transport window',()=>{
 const policy=readFileSync('portable-launcher/LauncherPolicy.cs','utf8');
 const request=readFileSync('app/infrastructure/portable-storage-request.ts','utf8');
 assert.match(policy,/String\.Equals\(action, "workspace-publish"[\s\S]*?4 \* 60 \* 60 \* 1000/,'The launcher must not reject Session Commit after the ordinary two-minute mutation queue wait.');
 assert.match(request,/stage==='scan'\|\|stage==='rework-retention'\|\|stage==='sync-pipeline'\|\|stage==='workspace-publish'\?4\*60\*60\*1000/,'The browser transport must remain open for the same long Session Commit window.');
});

test('logoff rechecks local evidence after a clean manual commit even when React state is unchanged',()=>{
 const shutdown=page.slice(page.indexOf('async function publishForShutdown'),page.indexOf('async function releaseLeaseForShutdown'));
 const statusPath=page.slice(page.indexOf('async function publishSystemWorkspace'),page.indexOf('async function publishForShutdown'));
 assert.match(shutdown,/withOperationTimeout\(signal=>publishSystemWorkspace\(root,systemId,systems,users,signal\)/,'Every shutdown path must enter the same local preflight used by manual Session Commit.');
 assert.match(statusPath,/'workspace-status'/,'The shared shutdown path must observe evidence-only Incoming changes through protected local status.');
 assert.match(statusPath,/if\(status\.noChanges\)[\s\S]*?return/,'Only an authoritative no-change response may skip workspace-publish.');
 assert.doesNotMatch(shutdown,/stateHash[\s\S]*?return\{performed:false/,'A matching browser state hash must not bypass the local evidence check.');
});
