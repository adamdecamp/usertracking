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
