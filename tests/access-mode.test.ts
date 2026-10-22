import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
const sessionPanels=readFileSync(new URL('../app/components/SessionPanels.tsx',import.meta.url),'utf8');
const directoryHeader=readFileSync(new URL('../app/components/DirectoryHeader.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const policy=readFileSync(new URL('../portable-launcher/LauncherPolicy.cs',import.meta.url),'utf8');
const storage=readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
const workspaceReconciliation=readFileSync(new URL('../portable-launcher/PortableWorkspaceReconciliation.cs',import.meta.url),'utf8');
const portableEntry=readFileSync(new URL('../portable/src/main.tsx',import.meta.url),'utf8');

test('startup requires an explicit Read-Only or Full Access choice',()=>{
 assert.match(sessionPanels,/Choose Your Access/);
 assert.match(page,/chooseAccessMode\('read-only'\)/);
 assert.match(page,/chooseAccessMode\('full'\)/);
 assert.match(sessionPanels,/Multiple viewers · No editor lock · 15-minute inactivity timeout/);
 assert.match(sessionPanels,/Required startup health check · One exclusive editor/);
});

test('Read-Only sessions never acquire or renew the editor lease',()=>{
 assert.match(page,/if\(accessMode==='read-only'\)\{[\s\S]*?setSessionState\('active'\)/);
 assert.match(page,/if\(!root\|\|accessMode!=='full'\|\|leaseRenewPending\.current\)return/);
 assert.match(page,/if\(accessMode==='full'\)\{if\(!\(await acquireLease\(root,sessionId\)\)\)/);
});

test('the dashboard can switch between Read-Only and Full Access without restarting',()=>{
 assert.match(page,/async function switchAccessMode\(\)/);
 assert.match(page,/Switch to Read-Only Access/);
 assert.match(page,/Switch to Full Access/);
 assert.match(page,/upgradeLauncherSession\(\)/);
 assert.match(page,/downgradeLauncherSession\(\)/);
 assert.match(launcher,/path == "\/api\/session-upgrade"/);
 assert.match(styles,/\.mode-switch \.secondary\{background:#fff;color:#17654f/);
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
 assert.match(directoryHeader,/props\.canWrite&&<div className="directory-actions"/);
 assert.match(page,/system\.archived\|\|trackerWindow\(\)\.__trackerAccessMode==='read-only'/);
 assert.match(page,/accessMode==='read-only'\)\{setStatusFilter\(state\)/);
});

test('portable requests carry an authenticated launcher session and the launcher rejects Read-Only mutations',()=>{
 assert.match(page,/headers\.set\('X-RAPTOR-Session-Token'/);
 assert.match(page,/headers\.set\('X-RAPTOR-Lease-Session'/);
 assert.match(launcher,/SessionTokenMatches\(presentedToken\)/);
 assert.match(launcher,/OpenSession\(mode\)/);
 assert.match(launcher,/DowngradeSessionAndReleaseLeases\(\)/);
 assert.match(launcher,/ReadOnlyStorageActionAllowed\(action, parts\[0\]\)/);
 assert.match(launcher,/Read-Only Access cannot modify the mapped information system/);
 assert.match(policy,/action, "audit-batch"/);
 assert.match(policy,/action, "manifest"/);
 assert.match(launcher,/CreateSessionToken\(\)/);
 assert.match(launcher,/#session=/);
 assert.match(portableEntry,/history\.replaceState\(null,'',`\$\{location\.pathname\}\$\{location\.search\}`\)/);
 assert.match(portableEntry,/X-RAPTOR-Session-Token/);
 assert.match(portableEntry,/portableWindow\.__portableHost=true;[\s\S]*?loadLauncherSessionToken\(\)/);
});

test('every protected mutation is authorized by the backend lease owner',()=>{
 assert.match(launcher,/StorageActionRequiresLease\(action, parts\[0\]\)/);
 assert.match(launcher,/storage\.OwnsLease\(systemId, leaseSession\)/);
 assert.match(launcher,/storage\.MapForFullSession\(systemId, selected, leaseSession\)/);
 assert.match(launcher,/The exclusive Full Access lease is missing or is owned by another session/);
 assert.match(storage,/public bool OwnsLease\(string systemId, string sessionId\)/);
 assert.match(storage,/public bool MapForFullSession\(string systemId, string path, string sessionId\)/);
 assert.match(policy,/String\.Equals\(action, "lease-release", StringComparison\.Ordinal\)/);
 assert.match(launcher,/The Full Access session ended while this operation was waiting to begin/);
});

test('Read-Only mapping avoids shared-folder initialization and all session boundaries are audited',()=>{
 const mapReadOnly=storage.slice(storage.indexOf('public void MapReadOnly'),storage.indexOf('public string CachedMappings'));
 assert.doesNotMatch(mapReadOnly,/MigrateSupportDirectories|EnsureOrganizationDocumentFolders|ProbeMappedFolder/);
 assert.match(page,/READ-ONLY SESSION START/);
 assert.match(page,/READ-ONLY SESSION END: inactivity timeout after 15 minutes/);
 assert.match(page,/READ-ONLY SESSION END: operator logoff/);
 assert.match(storage,/audit-chain\.lock/);
});

test('the dashboard opens the selected protected local workspace in File Explorer',()=>{
 assert.match(page,/Open Local Workspace/);
 assert.match(page,/portableRequest\(root,'workspace-open',\{method:'POST'\}\)/);
 assert.match(launcher,/action == "workspace-open"[\s\S]*?LocalWorkspacePath\(systemId\)[\s\S]*?Process\.Start\("explorer\.exe"/);
});

test('Full Access User Record evidence controls open the verified folder location instead of a browser preview',()=>{
 assert.match(page,/async function openEvidenceLocation\(user:UserRecord,artifact:Artifact\)/);
 assert.match(page,/portableRequest\(root,`file-location\?path=\$\{encodeURIComponent\(path\)\}`,\{method:'POST'\}\)/);
 assert.match(page,/>Open File Location<\/button>/);
 assert.doesNotMatch(page,/onPreview=\{\(user,artifact\)=>void openEvidence\(/);
 assert.match(styles,/access-mode-badge\.read-only\) \.artifact-card>button\{display:none\}/);
 assert.doesNotMatch(policy,/String\.Equals\(action, "file-location", StringComparison\.Ordinal\) && String\.Equals\(method, "POST", StringComparison\.Ordinal\)\) return true/);
 assert.match(policy,/String\.Equals\(action, "error-report", StringComparison\.Ordinal\) && String\.Equals\(method, "POST", StringComparison\.Ordinal\)\) return true/);
 assert.match(launcher,/action == "file-location"[\s\S]*?EvidenceLocation\(systemId,[\s\S]*?explorer\.exe[\s\S]*?\/select/);
});

test('blocked sessions always offer a safe exit that preserves recovery state',()=>{
 assert.match(sessionPanels,/state==='blocked'&&<button type="button" onClick=\{\(\)=>void onEndSession\(\)\}>End Session Safely<\/button>/);
 assert.match(page,/async function endBlockedSession\(\)[\s\S]*?backup-failed[\s\S]*?shutdown-ready/);
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

test('the local working database is Windows-user protected and publication is journaled',()=>{
 assert.match(storage,/ProtectedData\.Protect\(clear, LocalWorkspaceEntropy\(purpose\), DataProtectionScope\.CurrentUser\)/);
 assert.match(workspaceReconciliation,/HardenLocalWorkspaceAcl\(workspace\)/);
 assert.match(storage,/WritePublicationJournal\(workspaceRoot, "prepared"/);
 assert.match(storage,/WritePublicationJournal\(workspaceRoot, "evidence-verified"/);
 assert.match(storage,/WritePublicationJournal\(workspaceRoot, "manifest-committed"/);
 assert.match(storage,/DeletePublicationJournal\(workspaceRoot\)/);
});

test('backend schema validation runs before local or shared database writes',()=>{
 assert.match(storage,/SaveSystemState[\s\S]*?ValidateDatabaseObject\(database\)/);
 assert.match(storage,/PublishWorkspace[\s\S]*?ValidateDatabaseObject\(requestedDatabase\)/);
 assert.match(storage,/duplicate system ID/);
 assert.match(storage,/user references an unknown information system/);
 assert.match(storage,/artifact contains an invalid SHA-256 value/);
 assert.match(storage,/artifact contains an invalid stored path/);
});
