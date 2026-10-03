import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');

test('the portable page sends presence immediately and throughout an open session',()=>{
 assert.match(page,/startPortablePresenceHeartbeat\(\(\)=>launcherPost\('\/api\/presence',true\)\)/);
});

test('folder mapping uses the foreground Windows Explorer folder picker',()=>{
 assert.match(launcher,/Type\.GetTypeFromCLSID/);
 assert.match(launcher,/PickFolders = 0x00000020/);
 assert.match(launcher,/SetForegroundWindow\(owner\.Handle\)/);
 assert.doesNotMatch(launcher,/new FolderBrowserDialog/);
});

test('mapped-drive operations use bounded network-lag retries',()=>{
 const storage=readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
 assert.match(storage,/NetworkRetryDelay/);
 assert.match(storage,/EnumerateScanFilesOnce/);
 assert.match(storage,/NetworkReadAttempts/);
 assert.match(page,/stage==='evidence-status'\?90_000:5\*60\*1000/);
});

test('slow network storage queues safely instead of failing after five seconds',()=>{
 assert.match(launcher,/StorageQueueWaitMilliseconds\(action, parts\[0\]\)/);
 assert.match(launcher,/\? 30000 : 120000/);
 assert.doesNotMatch(launcher,/storageOperations\.WaitAsync\(5000\)/);
 assert.match(launcher,/client\.ReceiveTimeout = 120000; client\.SendTimeout = 120000/);
});

test('Sync confirms launcher activity before its first serialized storage request',()=>{
 assert.match(page,/setSyncRunning\(true\);await launcherPost\('\/api\/activity',true\);const launcherKeepAlive/);
});

test('a live heartbeat cancels only a pending browser-closed shutdown',()=>{
 const presence=launcher.slice(launcher.indexOf('private void RecordPresence()'),launcher.indexOf('private void BeginStorageRequest()'));
 assert.match(presence,/shutdownReason == "browser-closed"/);
 assert.match(presence,/shutdownRequestedUtc = null/);
 assert.doesNotMatch(presence,/operator-logoff|operator-exit|"idle"/);
});

test('lease loss stops active work and preserves the current Sync review',()=>{
 assert.match(page,/if\(!ok\)\{syncAbort\.current\?\.abort\(\)/);
 const apply=page.slice(page.indexOf('async function applyVerifiedSync'),page.indexOf('function resetFilters'));
 assert.match(apply,/if\(error instanceof SessionLeaseLostError\)throw error/g);
 assert.match(apply,/pendingSyncBySystem\.current\.set\(failedSystemId,pendingSync\)/);
 assert.match(apply,/Verified Sync Paused/);
});

test('a recoverable verified Sync error preserves review and cleanup actions',()=>{
 const apply=page.slice(page.indexOf('async function applyVerifiedSync'),page.indexOf('function resetFilters'));
 assert.match(apply,/pendingSyncBySystem\.current\.set\(failedSystemId,pendingSync\);setPendingSync\(pendingSync\)/);
 assert.match(apply,/setModal\('sync-review'\)/);
 assert.match(apply,/current Sync review and Clean Up actions were preserved/);
 assert.doesNotMatch(apply,/pendingSyncBySystem\.current\.delete\(failedSystemId\)/);
});

test('selected updates retain exact paths through optional PDF compression',()=>{
 const apply=page.slice(page.indexOf('async function applyVerifiedSync'),page.indexOf('function resetFilters'));
 assert.match(page,/type SyncCandidate=\{[^}]*path:string/);
 assert.match(apply,/compressionResults\.get\(scanPathKey\(match\.path\)\)/);
 assert.match(apply,/path:compressedResult\?\.path\?\?match\.path/);
});

test('reconnection waits for an in-flight verified storage operation before activating the session',()=>{
 assert.match(page,/async function readManifestAfterStorageSettles/);
 const reconnect=page.slice(page.indexOf('async function reconnect'),page.indexOf('async function openRestore'));
 assert.match(reconnect,/await readManifestAfterStorageSettles\(root\)/);
 assert.ok(reconnect.indexOf('await readManifestAfterStorageSettles(root)')<reconnect.lastIndexOf("setSessionState('active')"));
});
