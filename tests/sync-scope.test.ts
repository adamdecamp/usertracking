import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const syncScopeComponent=readFileSync(new URL('../app/components/TrackerViewParts.tsx',import.meta.url),'utf8');
const syncUi=`${page}\n${syncScopeComponent}`;
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');

test('does not start Sync while restoring, mapping, or selecting a system',()=>{
 const restore=page.slice(page.indexOf("if(!hydrated||!trackerWindow().__portableHost||mappingRestoreStarted.current)"),page.indexOf('// Persist only the actively leased system'));
 const mapping=page.slice(page.indexOf('async function mapFolder'),page.indexOf('async function scan'));
 const selection=page.slice(page.indexOf('async function selectInformationSystem'),page.indexOf('function openUser'));
 assert.doesNotMatch(restore,/syncMapped\s*\(/);
 assert.doesNotMatch(mapping,/syncMapped\s*\(/);
 assert.doesNotMatch(selection,/syncMapped\s*\(/);
 assert.match(syncUi,/Sync never starts automatically/);
});

test('offers only entire-system or immediate-organization Sync scope',()=>{
 assert.match(syncUi,/<option value="daily">Daily Sync — Fast and Strict<\/option>/);
 assert.match(syncUi,/<option value="legacy">Legacy Import — Historical Recovery<\/option>/);
 assert.match(syncUi,/<option value="system">Entire Information System<\/option>/);
 assert.match(syncUi,/<option value="organization"[^>]*>One Organization<\/option>/);
 assert.match(syncUi,/deeper subfolders cannot be selected as a separate scope/);
 assert.match(syncUi,/place new evidence directly in the applicable organization folder and corrected evidence in its Rework folder/);
 assert.match(syncUi,/Full Rescan — Inspect Active Document Folders and Ignore Cached Validation/);
 assert.match(page,/dailyIncomingOnly=!legacyImport&&!forceFull/);
 assert.match(page,/Checking organization-root intake files and Rework/);
 assert.doesNotMatch(page,/onClick=\{\(\)=>void sync\(true\)\}/);
});

test('allows another scoped Sync while earlier review results are pending',()=>{
 const openScope=page.slice(page.indexOf('async function openSyncScope'),page.indexOf('function stopSync'));
 assert.doesNotMatch(openScope,/if\(pendingSync\).*sync-review/);
 assert.match(openScope,/setModal\(null\);setSyncScopeOpen\(true\)/);
 assert.match(syncUi,/Previous Results Remain Available/);
 assert.match(syncUi,/hasPendingResults\?`Start Another \$\{syncModeLabel\(syncMode\)\}`:`Start \$\{syncModeLabel\(syncMode\)\}`/);
 assert.match(page,/tracker:start-another-sync/);
 assert.match(page,/>Start Another Sync<\/button>/);
 assert.doesNotMatch(page,/setSyncText\('Review Matches'\)/);
});

test('passes the validated organization scope to every launcher discovery stage',()=>{
 assert.match(launcher,/ScanWithJournal\([^\r\n]+OptionalQueryValue\(target, "organization"\)[^\r\n]+OptionalQueryValue\(target, "legacy"\)/);
 assert.match(launcher,/ListEvidenceLocations\(systemId, OptionalQueryValue\(target, "organization"\), String\.Equals\(OptionalQueryValue\(target, "full"\)/);
 assert.match(launcher,/ProcessReworkRetention\([^\r\n]+OptionalQueryValue\(target, "organization"\)/);
 assert.match(launcher,/ProcessReworkRetention\([^\r\n]+OptionalQueryValue\(target, "legacy"\)/);
 assert.match(page,/processReworkRetention\(h,controller\.signal,forceFull,organization,legacyImport\)/);
});

test('Daily Sync retains renaming while same-year supporting discovery applies to both modes',()=>{
 const syncFlow=page.slice(page.indexOf('async function syncMapped'),page.indexOf('async function sync(forceFull'));
 assert.match(syncFlow,/legacyImport=isLegacyImport\(syncMode\)/);
 assert.match(syncFlow,/normalizableByPath=new Map[\s\S]*?for\(const item of scanResult\.evidence\)/);
 assert.match(syncFlow,/syncRenamerCandidates=scanResult\.evidence\.filter\(item=>shouldReadPdfForFilenameNormalization\(syncMode,item\.unchanged\)/);
 assert.match(syncFlow,/saarPreparations=legacyImport\?/);
 assert.match(syncFlow,/sameYearSupportingEvidenceEligible\(item\.filename,scanDate\)/);
 assert.doesNotMatch(syncFlow,/if\(legacyImport\)\{for\(const item of activeEvidence\)/);
 assert.match(syncFlow,/requiresSaarFormClassification\(item\.filename\)&&\(legacyImport\|\|!item\.unchanged/);
});


test('launch discovers new local organization folders without starting Sync',()=>{
 const startup=page.slice(page.indexOf('// This effect intentionally runs once after hydration'),page.indexOf('// Persist only the actively leased system'));
 assert.match(startup,/setSyncOrganizations\(await organizationFolderNames\(root\)\)/);
 assert.ok(startup.indexOf('setSyncOrganizations(await organizationFolderNames(root))')<startup.indexOf("if(accessMode==='read-only')"));
 assert.doesNotMatch(startup,/syncMapped\s*\(/);
});
