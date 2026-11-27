import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readPageSource} from './page-source.ts';

const page=readPageSource();
const storage=fs.readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
const publicationRecovery=fs.readFileSync(new URL('../portable-launcher/PublicationRecovery.cs',import.meta.url),'utf8');
const workspacePublicationProgress=fs.readFileSync(new URL('../portable-launcher/PortableWorkspacePublicationProgress.cs',import.meta.url),'utf8');
const workspaceStatus=fs.readFileSync(new URL('../portable-launcher/PortableWorkspaceStatus.cs',import.meta.url),'utf8');
const launcher=fs.readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const policy=fs.readFileSync(new URL('../portable-launcher/LauncherPolicy.cs',import.meta.url),'utf8');
const systemCommitService=fs.readFileSync(new URL('../app/application/system-commit-service.ts',import.meta.url),'utf8');

test('portable database and CSV backup use one serialized launcher commit',()=>{
 assert.match(page,/portableRequest\(h,'state-commit'[\s\S]*?JSON\.stringify\(\{database,csv\}/);
 assert.match(launcher,/action == "state-commit"[\s\S]*?SaveSystemState/);
 assert.match(storage,/public string SaveSystemState[\s\S]*?SaveManifest[\s\S]*?QueueBackup/);
 assert.match(storage,/private void FlushDueBackups[\s\S]*?CreateSnapshot[\s\S]*?SaveCsv/);
});

test('local Complete evidence is never treated as a publication source',()=>{
 const storage=fs.readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
 const recovery=fs.readFileSync(new URL('../portable-launcher/PublicationRecovery.cs',import.meta.url),'utf8');
 assert.match(storage,/IsFinalCompleteLocalEvidencePath\(workspaceRoot, source\)/);
 assert.match(storage,/local Complete copy was excluded from publication/);
 assert.match(storage,/Convert\.ToBoolean\(mapped\["pending"\][\s\S]*?\|\| !IsFinalCompleteLocalEvidencePath\(root, candidate\)/);
 assert.match(recovery,/FindVerifiedMovedLocalEvidence\(workspaceRoot, item, hashCache, true\)/);
 assert.match(recovery,/FindVerifiedMovedLocalEvidence\(workspaceRoot, item, hashCache, false\)/);
 assert.match(recovery,/IsFinalCompleteLocalEvidencePath\(workspaceRoot, exact\) == finalCompleteOnly/);
 assert.match(recovery,/hashCache\.Pdf\(candidate\), hashCache\.Pdf\(completedLocal\)/);
 assert.match(recovery,/File\.Exists\(expectedLocal\) && !IsFinalCompleteLocalEvidencePath\(workspaceRoot, expectedLocal\)/);
 assert.ok(recovery.indexOf('FindVerifiedSharedEvidence(sharedRoot, item, hashCache, recoveredComplete)')<recovery.indexOf('FindVerifiedMovedLocalEvidence(workspaceRoot, item, hashCache, false)'),'Recovery must reconcile a verified shared copy before looking for any movable local source.');
});

test('Sync keeps resumable journals and a verified index mirror in the local performance cache',()=>{
 assert.match(storage,/SyncJournalBatchEntryLimit = 64/);
 assert.match(storage,/AppendSyncJournalLines[\s\S]*?FlushCompatible/);
 assert.match(storage,/LocalPerformanceCacheDirectory\(Root\(systemId\), "Sync Journals"\)/);
 assert.match(storage,/LocalPerformanceCacheDirectory\(root, "Sync Index Shards"\)/);
});

test('shared Sync indexes are checksum-protected and sharded by organization',()=>{
 assert.match(storage,/SyncIndexDirectoryName = "Sync Index"/);
 assert.match(storage,/SyncIndexShardFilename/);
 assert.match(storage,/index-org-/);
 assert.match(storage,/SaveSyncIndex\(string root, string ruleSetVersion, List<Dictionary<string, object>> files, string organization = null\)/);
 assert.match(storage,/ReadSyncIndexChecksum/);
});

test('portable Verified Sync uses exact mutation paths before any broad location fallback',()=>{
 const apply=page.slice(page.indexOf('async function applyVerifiedSync'),page.indexOf('function resetFilters'));
 assert.match(apply,/if\(isPortableRoot\(pendingSync\.handle\)\)[\s\S]*?byPath=new Map\(pendingSync\.evidence/);
 assert.match(apply,/compressionResults\.values\(\)[\s\S]*?collisionEvidenceResults\.get/);
 assert.match(apply,/if\(provenanceResult\.failures\.length\)[\s\S]*?refreshEvidenceLocations/);
});

test('launcher discovery reuses one directory enumeration with file metadata',()=>{
 assert.match(storage,/class DirectoryScanEntry[\s\S]*?LastModifiedUnixMs/);
 assert.match(storage,/EnumerateManagedDirectoryEntries[\s\S]*?GetFileSystemInfos/);
 const scan=storage.slice(storage.indexOf('public string ScanWithJournal(string systemId, string ruleSetVersion, bool fullRescan, string organization, bool legacyImport)'),storage.indexOf('public string CommitSyncJournals'));
 assert.match(scan,/EnumerateDirectoryEntries\(root, current\.Item1\)/);
 assert.match(scan,/directoryEntry\.HasMetadata/);
 assert.doesNotMatch(scan,/EnumerateScanFiles\(root, current\.Path\)/);
});

test('compression stays in the protected local workspace and deletes its source only after ZIP verification',()=>{
 assert.match(storage,/if \(!IsLocalWorkspaceRoot\(systemId, root\)\) throw new InvalidOperationException\("Loose PDFs are compressed only in the protected local workspace/);
 const compression=storage.slice(storage.indexOf('private string CompressEvidenceFile(string systemId, string root, string source, bool allowManaged, out bool alreadyCompleted)'),storage.indexOf('public string StoreEvidence'));
 assert.match(compression,/LocalPerformanceCacheDirectory\(root, "Compression Staging"\)/);
 assert.match(compression,/TryValidateEvidenceFile\(stagedPdf/);
 assert.match(compression,/File\.Open\(stagedZip[\s\S]*?OpenCompatibleFileStream\(networkTemporary/);
 assert.match(compression,/TryValidateEvidenceFile\(networkTemporary[\s\S]*?EvidencePdfSha256\(networkTemporary\)/);
 assert.match(compression,/DeleteCompressedSource\(systemId, root, source, destination, sourcePdfHash\);CompleteTransaction/);
 assert.match(compression,/TryValidateEvidenceFile\(destination[\s\S]*?EvidencePdfSha256\(destination\)[\s\S]*?File\.Delete\(source\)/);
});

test('each mapped system has an independent launcher operation queue',()=>{
 assert.match(launcher,/Dictionary<string, SemaphoreSlim> storageOperations/);
 assert.match(launcher,/StorageQueue\(systemId\)/);
 assert.match(storage,/\[ThreadStatic\] private static JavaScriptSerializer threadJson/);
 assert.doesNotMatch(launcher,/new SemaphoreSlim\(1, 1\);\s*\/\/ all storage/i);
});

test('startup uses a protected verified local cache while shared verification runs',()=>{
 assert.match(storage,/ProtectedData\.Protect[\s\S]*?DataProtectionScope\.CurrentUser/);
 assert.match(storage,/ReadLocalManifestCache/);
 assert.match(page,/readMappings\(true\)/);
 assert.match(page,/Showing the protected local read cache while the selected shared folder is verified/);
 assert.match(page,/accessModeCanWrite\(accessMode\)&&sessionState==='active'/);
});

test('VPN startup reads only the selected system and reuses its verified manifest',()=>{
 const startup=page.slice(page.indexOf('// This effect intentionally runs once after hydration'),page.indexOf('// Persist only the actively leased system'));
 assert.match(startup,/const restored=localResult\?\?applyMappings\(await readMappings\(false\)\)/);
 assert.match(startup,/if\(verification\.manifest\)await applyVerifiedSystemManifest\(target,verification\.manifest\)/);
 assert.match(startup,/unrelated system folders were not opened/);
 assert.match(storage,/SaveLocalManifestCache\(Root\(systemId\), json\.Serialize\(manifestDatabase\), manifestSha256\)/);
 assert.match(storage,/\{ "manifest", manifestDatabase \}/);
});

test('rapid UI edits are coalesced before background shared-drive saves',()=>{
 assert.match(page,/backgroundSaveDebounceMs=5000/);
 assert.match(page,/window\.setTimeout\(\(\)=>void save\(\),backgroundSaveDebounceMs\)/);
 assert.match(page,/systemPayloadCache=useRef\(new SystemCommitPayloadCache\(\)\)/);
 assert.match(systemCommitService,/this\.entry\.systems===systems&&this\.entry\.users===users&&this\.entry\.aliases===aliases&&this\.entry\.systemId===systemId/);
 assert.match(systemCommitService,/buildCsv\(state\.scopedUsers,state\.scopedSystems\)/);
});

test('verified state is marked committed before React can schedule a redundant startup save',()=>{
 assert.match(page,/async function applyVerifiedSystemManifest[\s\S]*?committedStateHashes\.current\.set\(systemId,stateHash\)[\s\S]*?setSystems/);
});

test('routine Archive Preflight stays within Incoming and Rework',()=>{
 const preflight=storage.slice(storage.indexOf('public string ProcessReworkRetention(string systemId, string ruleSetVersion, bool forceFull, string organization, bool legacyImport)'),storage.indexOf('public string CommitSyncJournals'));
 assert.match(preflight,/fastDaily = !forceFull && !legacyImport/);
 assert.match(preflight,/fastDaily && !current\.Item5 && !current\.Item6/);
 assert.match(preflight,/IsIncomingStorageDirectory/);
 assert.match(preflight,/if \(!fastDaily\)[\s\S]*markerPath/);
});

test('portable Sync combines preflight and discovery while reusing directory metadata',()=>{
 assert.match(launcher,/action == "sync-pipeline"[\s\S]*?RunSyncPipeline/);
 assert.match(page,/portableRequest\(h,query,\{method:'POST',signal:controller\.signal\}\)[\s\S]*?portablePipelineScan=pipeline\.scan/);
 assert.match(page,/scan\(scanRoot[\s\S]*?legacyImport,portablePipelineScan\)/);
 const pipeline=storage.slice(storage.indexOf('public string RunSyncPipeline'),storage.indexOf('private static bool IsReworkStorageDirectory'));
 assert.match(pipeline,/BeginEnumerationSnapshot/);
 assert.match(pipeline,/ProcessReworkRetention[\s\S]*?ScanWithJournal/);
 assert.match(pipeline,/enumerationCacheHits/);
});

test('changed evidence is staged locally once and validated with adaptive bounded concurrency',()=>{
 assert.match(storage,/private EvidenceValidationResult ValidateEvidenceFromLocalStage/);
 assert.match(storage,/EvidenceValidationCacheDirectory/);
 assert.match(storage,/Parallel\.ForEach\(validations\.Skip\(1\)/);
 assert.match(storage,/AdaptiveValidationConcurrency/);
 assert.match(storage,/if \(IsNetworkRoot\(root\)\) return probeMilliseconds >= 1500 \? 2 : 4/);
 assert.match(storage,/if \(count <= 1 \|\| probeMilliseconds >= 3000\) return 1;/,'a very slow first file still drops validation to one file at a time');
 assert.match(storage,/ReadRelativeFile[\s\S]*?StagedEvidencePath[\s\S]*?File\.ReadAllBytes\(staged\)/);
 assert.match(storage,/PruneEvidenceValidationCache\(root, true\)/);
 assert.match(launcher,/action == "sync-cache-clear"[\s\S]*?ClearEvidenceValidationCache/);
 assert.match(page,/finally\{if\(isPortableRoot\(h\)\)await portableRequest\(h,'sync-cache-clear'/);
});

test('unchanged database state avoids redundant shared writes and daily CSV rewrites',()=>{
 assert.match(storage,/String\.Equals\(StateHash\(existing\), requestedStateHash[\s\S]*?"unchanged", true/);
 assert.match(storage,/bool csvUnchanged = unchanged && File\.Exists\(csvPath\)/);
 assert.match(page,/committedStateHashes=useRef\(new Map<string,string>\(\)\)/);
 assert.match(page,/if\(knownHash===stateHash\)return\{saved:previousSaved,backup:previousBackup,unchanged:true\}/);
});

test('database snapshots and CSV backups are coalesced but force-flushed before shutdown',()=>{
 assert.match(storage,/BackupCoalesceSeconds = 30/);
 assert.match(storage,/new Timer\(delegate \{ try \{ FlushDueBackups\(false\)/);
 assert.match(storage,/public void FinalizeMappedBackups\(\)[\s\S]*?FlushDueBackups\(true\)/);
 assert.match(storage,/public void Dispose\(\)[\s\S]*?FlushDueBackups\(true\)/);
 assert.match(storage,/public void FinalizePendingBackups\(\)[\s\S]*?FlushDueBackups\(true\)/);
 const shutdownFinalizer=launcher.slice(launcher.indexOf('private void StartBackupFinalization'),launcher.indexOf('private void MarkShutdownReady'));
 assert.match(shutdownFinalizer,/FinalizePendingBackups\(\)/);
 assert.doesNotMatch(shutdownFinalizer,/FinalizeMappedBackups\(\)/);
});

test('audit appends reuse a protected verified checkpoint while explicit verification stays full-chain',()=>{
 assert.match(storage,/LocalAuditCheckpointFilename = "verified-audit-head\.cache"/);
 assert.match(storage,/AppendAuditBatch[\s\S]*?VerifyAuditChainIncrementalWithRetry/);
 assert.match(storage,/ProtectedData\.Protect[\s\S]*?AuditCheckpointEntropy/);
 assert.match(storage,/public string VerifyAuditLogs[\s\S]*?VerifyAuditChainWithRetry/);
});

test('startup reuses a recently fully verified audit checkpoint; explicit checks stay full-chain',()=>{
 const lastLogon=fs.readFileSync(new URL('../portable-launcher/PortableLastLogon.cs',import.meta.url),'utf8');
 assert.match(storage,/AuditState audit = startup \? VerifyAuditChainForStartup\([^;]*\) : VerifyAuditChain\(/);
 assert.match(storage,/"fullVerifiedAtUtc", state\.Incremental \? state\.FullVerifiedAtUtc \?\? "" : DateTime\.UtcNow/,'only a complete chain verification refreshes the full-verification time');
 assert.match(lastLogon,/StartupAuditFullVerificationDays = 7/);
 assert.match(lastLogon,/now - fullyVerified < TimeSpan\.FromDays\(StartupAuditFullVerificationDays\)/);
 assert.match(launcher,/VerifyLatest\(systemId, QueryValue\(target, "logical"\), String\.Equals\(QueryValue\(target, "audit"\), "startup", StringComparison\.Ordinal\)\)/);
 assert.match(page,/verify\?logical=\$\{encodeURIComponent\(systemId\)\}\$\{startup\?'&audit=startup':''\}/);
 assert.equal((page.match(/verifyMappedStorageHealth\([^)]*,true,true\)/g)??[]).length,5,'the five startup, reconnect, and Full Access paths use the startup check');
 for(const explicit of ['async function verifyStorage',"updateProcessing('Verifying Restored Database And Audit Chain'"]){const start=page.indexOf(explicit);assert.ok(start>=0,explicit);assert.match(page.slice(start,start+1500),/verifyMappedStorageHealth\(root,systemId,true\)/,`${explicit} keeps the full-chain check`)}
});

test('Windows change notifications are advisory hints with overflow fallback to authoritative scans',()=>{
 assert.match(storage,/new FileSystemWatcher\(organizations\)/);
 assert.match(storage,/watcher\.Error \+= failed/);
 assert.match(storage,/state\.Overflowed = true/);
 assert.match(storage,/SuggestedChangeHintOrganization/);
 assert.match(storage,/CompleteChangeHintScan/);
 assert.match(storage,/PrioritizedDirectories/);
 const pipeline=storage.slice(storage.indexOf('public string RunSyncPipeline'),storage.indexOf('private static bool IsReworkStorageDirectory'));
 assert.doesNotMatch(pipeline,/if\s*\(noHintChanges\)/);
});

test('manifest refresh uses checksum and metadata before rereading the shared database',()=>{
 const reader=storage.slice(storage.indexOf('private string ReadManifestOptimized'),storage.indexOf('public string SaveManifest'));
 assert.match(reader,/ReadManifestChecksumHash/);
 assert.match(reader,/cached\.SharedSha256/);
 assert.match(reader,/info\.Length == cached\.SharedLength/);
 assert.match(reader,/cacheHit = true;return cached\.Manifest/);
});

test('authoritative database is organization-sharded while the launcher preserves the logical manifest contract',()=>{
 assert.match(storage,/ManifestStorageFormat = "organization-sharded-v1"/);
 assert.match(storage,/private byte\[\] BuildShardedManifest/);
 assert.match(storage,/private Dictionary<string, object> ReadDatabaseManifest/);
 assert.match(storage,/userShards/);
 assert.match(storage,/hash\.Substring\(0, 24\)/);
 assert.match(storage,/if \(File\.Exists\(path\)\)/);
 assert.match(storage,/A database organization shard failed its SHA-256 integrity check/);
 assert.match(storage,/SaveLocalManifestCache\(root, logical, actualHash\)/);
});

test('portable backups are compressed locally and remain compatible with legacy JSON snapshots',()=>{
 assert.match(storage,/\.json\.gz/);
 assert.match(storage,/CompressGzip/);
 assert.match(storage,/DecompressGzip/);
 assert.match(storage,/path\.EndsWith\("\.json"[\s\S]*?path\.EndsWith\("\.json\.gz"/);
 assert.match(storage,/The decompressed backup exceeds the safety limit/);
});

test('Sync still reports its own phase timing, counts, staging, and concurrency in its response',()=>{
 for(const metric of ['enumerationDurationMs','validationDurationMs','stagedBytes','validationConcurrency','slowValidationFiles','maxValidationDurationMs'])assert.match(storage,new RegExp(`"${metric}"`));
 assert.match(storage,/return json\.Serialize\(new Dictionary<string, object> \{ \{ "retention", retention \}, \{ "scan", scan \}, \{ "diagnostics", diagnostics \} \}\);/);
});

test('Performance Diagnostics and Release Health are removed with everything that existed only for them',()=>{
 const header=fs.readFileSync(new URL('../app/components/OperatorDashboardHeader.tsx',import.meta.url),'utf8'),panels=fs.readFileSync(new URL('../app/components/OperationalPanels.tsx',import.meta.url),'utf8'),guide=fs.readFileSync(new URL('../app/user-guide/page.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(header,/>Performance<|>Release Health<|onPerformance|onReleaseHealth/);
 assert.doesNotMatch(page,/openPerformanceReport|downloadPerformanceReport|downloadDiagnosticBundle|openReleaseHealth|downloadReleaseHealth|PerformanceModal|ReleaseHealthModal|'performance'|'health'/);
 assert.doesNotMatch(panels,/PerformanceModal|ReleaseHealthModal|PerformanceReport|ReleaseHealthRecord/);
 assert.doesNotMatch(guide,/Release Health/);
 for(const removed of ['app/diagnostic-bundle.ts','app/infrastructure/network-qualification.ts','portable-launcher/PortableNetworkQualification.cs'])assert.equal(fs.existsSync(new URL(`../${removed}`,import.meta.url)),false,removed);
 assert.doesNotMatch(storage,/AppendPerformanceDiagnostic|ReadPerformanceDiagnostics|ReadSanitizedDiagnostics|DiagnosticContextCategory|PerformanceDuration|transferTimer|preparationTimer/);
 assert.doesNotMatch(launcher,/action == "(performance|diagnostics|network-qualification)"/);
 assert.doesNotMatch(policy,/"performance"|"diagnostics"/);
 // The timing logs Performance Diagnostics kept in each Windows profile are deleted when a folder is mapped, in either access mode.
 const cleanup=storage.slice(storage.indexOf('private void RemoveRetiredPerformanceLogs()'),storage.indexOf('private static byte[] ManifestCacheEntropy'));
 assert.match(cleanup,/Path\.Combine\(LocalCacheParent\(\), "performance-cache"\)/);
 assert.match(cleanup,/foreach \(string rootCache in Directory\.EnumerateDirectories\(cache\)\)/,'logs keyed by the shared folder and by the local workspace are both removed');
 assert.match(cleanup,/FileAttributes\.ReparsePoint\) == 0[\s\S]*?FileAttributes\.ReparsePoint\) == 0\) Directory\.Delete\(directory, true\)/,'a linked folder is never followed');
 assert.doesNotMatch(cleanup,/CreateDirectory/,'cleanup never creates a folder');
 assert.match(storage,/Map\(systemId, full\);RemoveRetiredPerformanceLogs\(\);return true;/);
 assert.match(storage,/if \(localWorkspaceRemapped\) ResetLocalWorkspaceWatcher\(systemId\);\r?\n        RemoveRetiredPerformanceLogs\(\);/);
});

test('workspace publication streams evidence and appends bounded progress without routine tree walks',()=>{
 const publish=storage.slice(storage.indexOf('public string PublishWorkspace'),storage.indexOf('private PublicationEvidence PreparePublicationDestination'));
 assert.match(publish,/recoverUnindexedLocalEvidence && Directory\.Exists\(localOrganizations\)/);
 assert.match(publish,/if \(!databaseChangePending && evidenceFastPath\)/);
 assert.match(publish,/evidenceFastPath \? new Dictionary<string, string>[\s\S]*?: PrepareLocalPublicationEvidence/);
 assert.match(publish,/"noChanges", true/);
 assert.match(page,/Checking Local Changes/);
 assert.doesNotMatch(page,/Compressing and Verifying Local Evidence/);
 assert.match(publicationRecovery,/StreamVerifiedEvidenceCopy\(item\.Source, temporary/);
 assert.doesNotMatch(publish,/File\.ReadAllBytes\(item\.Source\)/);
 assert.match(workspacePublicationProgress,/AppendPublicationProgress/);
 assert.match(storage + workspacePublicationProgress,/workspace-publication-progress\.jsonl/);
 assert.match(workspacePublicationProgress,/FileMode\.Append/);
});

test('Session Commit preflight is constant-time local metadata and never opens the shared drive',()=>{
 const status=workspaceStatus.slice(workspaceStatus.indexOf('public string WorkspaceStatus'));
 assert.ok(status.length>0,'WorkspaceStatus must be isolated in its local-only storage boundary.');
 assert.match(status,/LocalWorkspaceRoot\(systemId\)/);
 assert.match(status,/databaseChangePending/);
 assert.match(status,/pendingEvidenceCount/);
 assert.match(status,/interruptedRecovery/);
 assert.match(status,/evidenceWorkPending/);
 assert.doesNotMatch(status,/\bRoot\(systemId\)/,'Local preflight must not resolve or touch the mapped shared-drive root.');
 assert.doesNotMatch(status,/ReadLocalWorkspaceDatabase|ReadLocalEvidenceMap|PrepareLocalPublicationEvidence|Directory\.Enumerate|EnumerateDirectoryEntries|FileHashWithRetry|Sha256Stream/,'Local preflight must use its bounded status record rather than scan, decrypt, enumerate, or hash records and evidence.');
 assert.match(policy,/workspace-status/,'The launcher policy must explicitly classify local Session Commit preflight.');
 const serialization=policy.slice(policy.indexOf('StorageActionRequiresSerialization'),policy.indexOf('StorageActionRequiresLease'));
 assert.match(serialization,/workspace-status/,'Local Session Commit preflight must not wait behind network storage serialization.');
});

test('publication receipts are sharded per organization and file hashes stream with per-operation reuse',()=>{
 assert.match(storage,/PublicationIndexStorageFormat = "organization-sharded-v1"/);
 assert.match(storage,/WritePublishedEvidenceShard/);
 assert.match(storage,/LoadPublishedEvidence\(sharedRoot, cleanOrganization\)/);
 assert.match(storage,/class PublicationHashCache/);
 assert.match(storage,/FileHashWithRetry[\s\S]*?Sha256Stream/);
 assert.match(storage,/hashCache\.Container/);
});

