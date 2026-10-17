import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const picker=page.slice(page.indexOf('function EvidenceFilePicker('),page.indexOf('function AddUser('));
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
