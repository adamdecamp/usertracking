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
