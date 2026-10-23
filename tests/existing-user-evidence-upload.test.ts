import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {formatDeleteUserCompletionAudit} from '../app/application/user-deletion-service.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const picker=readFileSync(new URL('../app/components/EvidenceFilePicker.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const storage=readFileSync(new URL('../portable-launcher/PortableWorkspaceStatus.cs',import.meta.url),'utf8');
const evidenceExistence=readFileSync(new URL('../app/infrastructure/evidence-existence.ts',import.meta.url),'utf8');
const userModal=page.slice(page.indexOf('function UserModal('),page.indexOf('function MessageAutomation('));
const deleteArchiveFlow=page.slice(page.indexOf('async function archiveAllUserEvidence('),page.indexOf('function archivedCollisionNameMatches('));

test('shared evidence picker supports drag and drop plus File Explorer',()=>{
 assert.match(picker,/onDrop=\{drop\}/);
 assert.match(picker,/event\.dataTransfer\.files\?\.\[0\]/);
 assert.match(picker,/input\.current\?\.click\(\)/);
 assert.match(picker,/accept=\{evidenceAccept\}/);
 assert.match(picker,/required\?['"]Required['"]:['"]Optional['"]/);
});

test('existing-user evidence replacement uses the shared drag-and-drop picker',()=>{
 assert.match(userModal,/<EvidenceFilePicker kind=\{k\}/);
 assert.match(userModal,/file=\{uploads\[k\]\}/);
 assert.match(userModal,/canonicalName=\{uploadTargets\[k\]\}/);
 assert.match(userModal,/required=\{reactivating&&!accessOverride\}/);
 assert.match(userModal,/Will Remain Missing After the Role Change/);
 assert.match(userModal,/newest dated disabled SAAR will be restored from the permanent SAAR Archive/);
 assert.match(userModal,/onFile=\{file=>selectEvidenceUpload\(k,file\)\}/);
});

test('updated SAAR workflow supports drag and drop and clears its override',()=>{
 assert.match(userModal,/<EvidenceFilePicker kind="Updated SAAR" file=\{saar\} canonicalName=\{saarTarget\}/);
 assert.match(userModal,/onFile=\{selectUpdatedSaar\}/);
 assert.match(userModal,/setAccessOverride\(false\)/);
 assert.doesNotMatch(userModal,/<label>Updated SAAR<input/);
});

test('manual evidence selection invokes the Document Renamer filename gate before storage',()=>{
 assert.match(page,/async function validateManualEvidenceSelection/);
 assert.match(userModal,/validateManualEvidenceSelection\(draft,kind,file\)/);
 assert.match(userModal,/Document Renamer could not validate this upload/);
});

test('delete-user discovery never displays an unrelated scanned filename as an archive action',()=>{
 assert.match(deleteArchiveFlow,/scanEvidence\(root,\(processed,total\)=>onProgress\?\.\(processed,total\)\)/);
 assert.doesNotMatch(deleteArchiveFlow,/scanEvidence\(root,onProgress\)/);
 assert.match(deleteArchiveFlow,/onProgress\?\.\(processed,matching\.length,item\.filename\)/);
});

test('delete-user archival tolerates evidence that was already moved or is missing',()=>{
 assert.match(deleteArchiveFlow,/!insideArchiveTree\(item\.path\)/,'Scanned Archive and Superseded files must not be queued for another move.');
 assert.match(deleteArchiveFlow,/insideArchiveTree\(located\.path\).*verifyArchivedEvidenceExists\(located\.path,loadPortableExistence,portableExistenceChecks\)/,'A recorded artifact in permanent Archive storage must be verified without being queued for another move.');
 assert.match(deleteArchiveFlow,/missingErrors/,'Missing evidence should be recorded separately from true archive failures.');
 assert.match(deleteArchiveFlow,/evidence-exists\?path=/,'Portable deletion should use the metadata-only path existence check rather than downloading evidence.');
 assert.match(evidenceExistence,/The archived evidence file no longer exists/,'An absent archived file must be classified through the missing-evidence path.');
 assert.match(launcher,/action == "evidence-exists" && parts\[0\] == "GET"/,'The launcher must expose the metadata-only existence endpoint.');
 assert.match(storage,/public string EvidenceExists\(string systemId, string relative\)[\s\S]*?new FileInfo\(path\)[\s\S]*?\{ "exists", true \}/,'The existence endpoint must inspect metadata without reading the evidence contents.');
 const deleteFlow=page.slice(page.indexOf('async function deleteUserRecord('),page.indexOf('async function openEvidenceLocation('));
 assert.match(deleteFlow,/if\(archived\.blockingErrors\.length\)/,'Only non-missing archive failures may block record deletion.');
 assert.match(deleteFlow,/users\.filter\(item=>item\.id!==user\.id\)/,'The user record must still be removed when evidence is already absent.');
 assert.match(deleteFlow,/formatDeleteUserCompletionAudit/,'The completed deletion must write the structured audit summary.');
 const audit=formatDeleteUserCompletionAudit({last:'User',first:'Test',justification:'Duplicate record',moved:[],missingErrors:['missing.pdf.zip: The archived evidence file no longer exists.']});
 assert.match(audit,/1 already-missing evidence reference was logged without blocking deletion/);
 assert.match(audit,/missing evidence missing\.pdf\.zip: The archived evidence file no longer exists\./,'The deletion audit must retain the missing filename and reason for later review.');
});
