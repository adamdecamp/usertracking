import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const storage=readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');

test('startup requires an explicit Read-Only or Full Access choice',()=>{
 assert.match(page,/Choose Your Access/);
 assert.match(page,/chooseAccessMode\('read-only'\)/);
 assert.match(page,/chooseAccessMode\('full'\)/);
 assert.match(page,/Multiple viewers · No editor lock · 15-minute inactivity timeout/);
 assert.match(page,/Required startup health check · One exclusive editor/);
});

test('Read-Only sessions never acquire or renew the editor lease',()=>{
 assert.match(page,/if\(accessMode==='read-only'\)\{lastActivity/);
 assert.match(page,/if\(!root\|\|accessMode!=='full'\|\|leaseRenewPending\.current\)return/);
 assert.match(page,/if\(accessMode==='full'\)\{if\(!\(await acquireLease\(root,sessionId\)\)\)/);
});

test('Full Access requires startup integrity verification and safely falls back to Read-Only',()=>{
 assert.match(page,/verifyMappedStorageHealth\(root,target,true\)/);
 assert.match(page,/verifyMappedStorageHealth\(h,mappedSystemId,true\)/);
 assert.match(page,/verifyMappedStorageHealth\(root,systemId,true\)/);
 assert.match(page,/Full Access was not opened because startup integrity verification failed\. Read-Only Access remains available\./);
 assert.match(page,/trackerWindow\(\)\.__trackerAccessMode='read-only'/);
});

test('Read-Only controls expose lookup without mutation workflows',()=>{
 assert.match(page,/canWrite&&<button[\s\S]{0,300}openSyncScope/);
 assert.match(page,/canWrite&&<div className="directory-actions"/);
 assert.match(page,/system\.archived\|\|trackerWindow\(\)\.__trackerAccessMode==='read-only'/);
 assert.match(page,/accessMode==='read-only'\)\{setStatusFilter\(state\)/);
});

test('portable requests carry access mode and the launcher rejects Read-Only mutations',()=>{
 assert.match(page,/headers\.set\('X-RAPTOR-Access-Mode'/);
 assert.match(launcher,/ReadOnlyStorageActionAllowed\(action, parts\[0\]\)/);
 assert.match(launcher,/Read-Only Access cannot modify the mapped information system/);
 assert.match(launcher,/action, "audit-batch"/);
 assert.match(launcher,/action, "manifest"/);
});

test('Read-Only mapping avoids shared-folder initialization and all session boundaries are audited',()=>{
 const mapReadOnly=storage.slice(storage.indexOf('public void MapReadOnly'),storage.indexOf('public string CachedMappings'));
 assert.doesNotMatch(mapReadOnly,/MigrateSupportDirectories|EnsureOrganizationDocumentFolders|ProbeMappedFolder/);
 assert.match(page,/READ-ONLY SESSION START/);
 assert.match(page,/READ-ONLY SESSION END: inactivity timeout after 15 minutes/);
 assert.match(page,/READ-ONLY SESSION END: operator logoff/);
 assert.match(storage,/audit-chain\.lock/);
});

test('the live JSON database has an independently verified SHA-256 sidecar',()=>{
 assert.match(page,/manifestChecksumFilename=checksumFilename\(manifestFilename\)/);
 assert.match(page,/verifyBrowserManifestChecksum\(directory,text\)/);
 assert.match(page,/writeTextFile\(operational,manifestChecksumFilename/);
 assert.match(storage,/ManifestChecksumFilename = ManifestFilename \+ "\.sha256"/);
 assert.match(storage,/WriteManifestChecksum\(manifest, destinationHash\)/);
 assert.match(storage,/VerifyManifestChecksum\(manifestPath, false\)/);
 assert.match(storage,/live database failed its SHA-256 integrity check/i);
});
