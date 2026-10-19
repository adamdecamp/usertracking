import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatDeleteUserCompletionAudit} from '../app/application/user-deletion-service.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const policy=readFileSync(new URL('../portable-launcher/LauncherPolicy.cs',import.meta.url),'utf8');

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
 assert.match(page,/stage==='evidence-status'\|\|stage==='evidence-pdf-status'\?90_000:5\*60\*1000/);
});

test('slow network storage queues safely instead of failing after five seconds',()=>{
 assert.match(launcher,/StorageQueueWaitMilliseconds\(action, parts\[0\]\)/);
 assert.match(policy,/\? 30000 : 120000/);
 assert.doesNotMatch(launcher,/storageOperations\.WaitAsync\(5000\)/);
 assert.match(launcher,/client\.ReceiveTimeout = 120000; client\.SendTimeout = 120000/);
 assert.match(launcher,/ActiveStorageOperation\(systemId\)/);
 assert.match(launcher,/activeOperation/);
});

test('idle disconnect arms bounded shutdown, reuses final publication, and releases the lease',()=>{
 assert.match(page,/waitForPortableStorageIdle/);
 assert.match(page,/publicationBySystem\.current\.get\(systemId\)/);
 assert.match(page,/publicationBySystem\.current\.has\(systemId\)/);
 assert.match(page,/idle logoff/);
 assert.match(page,/idle shutdown ready/);
 const disconnect=page.slice(page.indexOf('async function disconnectForInactivity'),page.indexOf('async function prepareShutdown'));
 assert.match(disconnect,/error instanceof PortableStorageBusyError/);
 assert.match(disconnect,/before retrying the final verified save/);
 assert.ok(disconnect.indexOf("'/api/logoff'")<disconnect.indexOf('publishForShutdown'));
 assert.ok(disconnect.indexOf('publishForShutdown')<disconnect.indexOf('releaseLeaseForShutdown'));
 assert.ok(disconnect.indexOf('releaseLeaseForShutdown')<disconnect.indexOf("'/api/shutdown-ready'"));
 assert.doesNotMatch(disconnect,/finally\{[^}]*releaseLease/);
});

test('shutdown waits are bounded and retain local-first recovery state',()=>{
 const wait=page.slice(page.indexOf('async function waitForPortableStorageIdle'),page.indexOf('async function portableRequest'));
 assert.match(wait,/Date\.now\(\)-started>=timeoutMs/);
 assert.match(wait,/OperationTimeoutError/);
 assert.match(page,/shutdownPublicationTimeoutMs=2\*60\*1000/);
 assert.match(page,/protected local workspace (?:remains|was retained)/i);
});

test('operator logoff arms launcher shutdown before final network publication',()=>{
 const logoff=page.slice(page.indexOf('async function logOff()'),page.indexOf('async function reconnect'));
 assert.ok(logoff.indexOf("'/api/logoff'")<logoff.indexOf('publishForShutdown'));
 assert.match(logoff,/syncAbort\.current\?\.abort\(\)/);
 assert.match(logoff,/finally\{[\s\S]*?shutdown-ready/);
});

test('shutdown always rechecks protected local status after a manual Session Commit',()=>{
 const shutdown=page.slice(page.indexOf('async function publishForShutdown'),page.indexOf('async function releaseLeaseForShutdown'));
 assert.match(shutdown,/publishSystemWorkspace\(root,systemId,systems,users,signal\)/,'Logoff must rerun the local workspace-status preflight so a later Incoming drop is not skipped.');
 assert.match(shutdown,/performed:result\.noChanges!==true/,'Only the launcher workspace-status no-change result may suppress shutdown publication.');
 assert.doesNotMatch(shutdown,/manualSessionCommitHashes|shutdownPublicationRequired/,'A matching React state hash cannot prove that the local evidence workspace is unchanged.');
 assert.doesNotMatch(page,/manualSessionCommitHashes|shutdownPublicationRequired/);
});

test('launcher finalization never blocks its UI thread and has a hard exit deadline',()=>{
 const request=launcher.slice(launcher.indexOf('private void RequestShutdown'),launcher.indexOf('private void StartBackupFinalization'));
 assert.doesNotMatch(request,/FinalizeMappedBackups\(\)/);
 const finalizer=launcher.slice(launcher.indexOf('private void StartBackupFinalization'),launcher.indexOf('private void MarkShutdownReady'));
 assert.match(finalizer,/Task\.Run/);
 assert.match(finalizer,/storage\.FinalizePendingBackups\(\)/);
 const lifecycle=launcher.slice(launcher.indexOf('private void EvaluateLifecycle'),launcher.indexOf('private static async Task Respond'));
 assert.match(lifecycle,/ShutdownShouldExit\(shutdownReason, waiting, operationBusy, backupClean, shutdownFinalizationComplete, shutdownReady\)/);
 assert.match(launcher,/internal static bool ShutdownShouldExit[\s\S]*?ForcedShutdownLimit\(reason\)/);
 assert.match(lifecycle,/shutdownFinalizationComplete/);
 const exit=launcher.slice(launcher.indexOf('protected override void ExitThreadCore'),launcher.indexOf('internal static class Program'));
 assert.match(exit,/Thread\.Sleep\(8000\);Environment\.Exit\(0\)/);
 assert.match(exit,/storage\.Dispose\(false\)/);
 assert.doesNotMatch(exit,/FinalizeMappedBackups\(\)/);
});

test('Sync confirms launcher activity before its first serialized storage request',()=>{
 assert.match(page,/setSyncRunning\(true\);await setLauncherLongOperation\(true,true\);const launcherKeepAlive/);
});

test('long scans and verified updates hold the launcher and browser session active end to end',()=>{
 assert.match(launcher,/\/api\/operation-active/);
 assert.match(launcher,/\/api\/operation-idle/);
 assert.match(launcher,/activeStorageRequests > 0 \|\| longOperationActive/);
 assert.match(launcher,/lastLongOperationHeartbeatUtc >= TimeSpan\.FromMinutes\(5\)/);
 const apply=page.slice(page.indexOf('async function applyVerifiedSync'),page.indexOf('function resetFilters'));
 assert.match(apply,/syncInProgress\.current=true/);
 assert.match(apply,/setLauncherLongOperation\(true,true\)/);
 assert.match(apply,/finally\{window\.clearInterval\(launcherKeepAlive\);syncInProgress\.current=false/);
 assert.match(page,/stage==='scan'\|\|stage==='rework-retention'\|\|stage==='sync-pipeline'\|\|stage==='workspace-publish'\?4\*60\*60\*1000/);
});

test('evidence that fails canonical folder routing cannot enter database matching',()=>{
 const sync=page.slice(page.indexOf('async function syncMapped'),page.indexOf('async function sync(forceFull'));
 assert.match(sync,/organizationFailurePaths\.add\(scanPathKey\(source\)\)/);
 assert.match(sync,/!organizationFailurePaths\.has\(scanPathKey\(item\.path\)\)/);
 assert.ok(sync.indexOf('organizationFailurePaths.add')<sync.indexOf('const activeEvidence='));
});

test('same-year supporting evidence can propose a missing-SAAR user in either Sync mode',()=>{
 const sync=page.slice(page.indexOf('async function syncMapped'),page.indexOf('async function sync(forceFull'));
 assert.match(sync,/sameYearSupportingEvidenceEligible\(item\.filename,scanDate\)/);
 assert.doesNotMatch(sync,/if\(legacyImport\)\{for\(const item of activeEvidence\)/);
});

test('a live heartbeat cancels only a pending browser-closed shutdown',()=>{
 const presence=launcher.slice(launcher.indexOf('private void RecordPresence()'),launcher.indexOf('private void BeginStorageRequest()'));
 assert.match(presence,/shutdownReason == "browser-closed"/);
 assert.match(presence,/shutdownRequestedUtc = null/);
 assert.doesNotMatch(presence,/operator-logoff|operator-exit|"idle"/);
 const storage=launcher.slice(launcher.indexOf('private void BeginStorageRequest()'),launcher.indexOf('private void SetBackupClean'));
 assert.doesNotMatch(storage,/shutdownRequestedUtc = null/);
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

test('reconnection reuses a verified Full Access manifest and waits for a Read-Only refresh before activation',()=>{
 assert.match(page,/async function readManifestAfterStorageSettles/);
 const reconnect=page.slice(page.indexOf('async function reconnect'),page.indexOf('async function openRestore'));
 assert.match(reconnect,/if\(verification\.manifest\)await applyVerifiedSystemManifest\(systemId,verification\.manifest\)/);
 assert.match(reconnect,/else\{const shared=await readManifestAfterStorageSettles\(root\)/);
 assert.ok(reconnect.indexOf("else{const shared=await readManifestAfterStorageSettles(root)")<reconnect.lastIndexOf("setSessionState('active')"));
});

test('Outlook completion auditing always includes the mapped endpoint system',()=>{
 const outlook=launcher.slice(launcher.indexOf('private string OpenOutlookDraft'),launcher.indexOf('internal static string OutlookHtmlBody'));
 assert.match(outlook,/requestedAuditSystemIds\.Concat\(new\[\] \{ systemId \}\)\.Distinct/);
 assert.match(outlook,/RecordOutlookOutcome\(auditSystemIds/);
 assert.doesNotMatch(outlook,/!auditSystemIds\.Contains\(systemId/);
});

test('manual PDF receipt verification is read-only and does not wait behind storage writes',()=>{
 assert.match(policy,/!String\.Equals\(action, "evidence-pdf-status", StringComparison\.Ordinal\)/);
 assert.match(policy,/String\.Equals\(action, "evidence-pdf-status", StringComparison\.Ordinal\)[\s\S]*?String\.Equals\(action, "archive-locations"/);
});

test('successful disable and delete operations keep missing evidence in the audit trail without creating false failure reports',()=>{
 const deleteUser=page.slice(page.indexOf('async function deleteUserRecord'),page.indexOf('async function openEvidence'));
 const userModal=page.slice(page.indexOf('function UserModal'),page.indexOf('function MessageAutomation'));
 const userSubmit=userModal.slice(userModal.indexOf(' async function submit(){'),userModal.indexOf(' async function deleteRecord()'));
 assert.doesNotMatch(deleteUser,/Delete user completed with missing evidence files/);
 assert.match(deleteUser,/formatDeleteUserCompletionAudit/);
 assert.match(formatDeleteUserCompletionAudit({last:'Missing',first:'Evidence',justification:'Verified duplicate',moved:[],missingErrors:['missing.pdf.zip']}),/already-missing evidence reference/);
 assert.doesNotMatch(userSubmit,/Disable user completed with missing evidence files/);
 assert.match(userSubmit,/archive exception/);
});
