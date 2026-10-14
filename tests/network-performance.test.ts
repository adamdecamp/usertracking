import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page=fs.readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const storage=fs.readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
const launcher=fs.readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');

test('portable database and CSV backup use one serialized launcher commit',()=>{
 assert.match(page,/portableRequest\(h,'state-commit'[\s\S]*?JSON\.stringify\(\{database,csv:csvRows/);
 assert.match(launcher,/action == "state-commit"[\s\S]*?SaveSystemState/);
 assert.match(storage,/public string SaveSystemState[\s\S]*?SaveManifest[\s\S]*?SaveCsv/);
});

test('Sync keeps resumable journals and a verified index mirror in the local performance cache',()=>{
 assert.match(storage,/SyncJournalBatchEntryLimit = 64/);
 assert.match(storage,/AppendSyncJournalLines[\s\S]*?FlushCompatible/);
 assert.match(storage,/LocalPerformanceCacheDirectory\(Root\(systemId\), "Sync Journals"\)/);
 assert.match(storage,/LocalPerformanceCacheDirectory\(root, "Sync Index"\)/);
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

test('compression stages and validates locally before one verified shared-folder transfer',()=>{
 const compression=storage.slice(storage.indexOf('private string CompressEvidenceFile(string root, string source, bool allowManaged, out bool alreadyCompleted)'),storage.indexOf('public string StoreEvidence'));
 assert.match(compression,/LocalPerformanceCacheDirectory\(root, "Compression Staging"\)/);
 assert.match(compression,/TryValidateEvidenceFile\(stagedPdf/);
 assert.match(compression,/File\.Open\(stagedZip[\s\S]*?OpenCompatibleFileStream\(networkTemporary/);
 assert.match(compression,/TryValidateEvidenceFile\(networkTemporary[\s\S]*?EvidencePdfSha256\(networkTemporary\)/);
 assert.match(compression,/File\.Delete\(source\);CompleteTransaction/);
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
 assert.match(page,/Showing the protected local read cache while the shared folder is verified/);
 assert.match(page,/accessModeCanWrite\(accessMode\)&&sessionState==='active'/);
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
 assert.match(storage,/if \(IsNetworkRoot\(root\)\) return probeMilliseconds >= 750 \? 1 : 2/);
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

test('manifest refresh uses checksum and metadata before rereading the shared database',()=>{
 const reader=storage.slice(storage.indexOf('private string ReadManifestOptimized'),storage.indexOf('public string SaveManifest'));
 assert.match(reader,/ReadManifestChecksumHash/);
 assert.match(reader,/cached\.SharedSha256/);
 assert.match(reader,/info\.Length == cached\.SharedLength/);
 assert.match(reader,/cacheHit = true;return cached\.Manifest/);
});

test('performance diagnostics record phase timing, counts, staging, and concurrency locally',()=>{
 assert.match(storage,/AppendPerformanceDiagnostic/);
 assert.match(storage,/performance-" \+ DateTime\.UtcNow\.ToString\("yyyy-MM-dd"/);
 assert.match(storage,/"enumerationDurationMs"/);
 assert.match(storage,/"validationDurationMs"/);
 assert.match(storage,/"stagedBytes"/);
 assert.match(storage,/"validationConcurrency"/);
 assert.match(storage,/"slowValidationFiles"/);
 assert.match(storage,/"maxValidationDurationMs"/);
});
