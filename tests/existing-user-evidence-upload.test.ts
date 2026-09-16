import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const picker=page.slice(page.indexOf('function EvidenceFilePicker('),page.indexOf('function AddUser('));
const userModal=page.slice(page.indexOf('function UserModal('),page.indexOf('function MessageAutomation('));

test('shared evidence picker supports drag and drop plus File Explorer',()=>{
 assert.match(picker,/onDrop=\{drop\}/);
 assert.match(picker,/event\.dataTransfer\.files\?\.\[0\]/);
 assert.match(picker,/input\.current\?\.click\(\)/);
 assert.match(picker,/accept=\{evidenceAccept\}/);
 assert.match(picker,/required\?['"]Required['"]:['"]Optional['"]/);
});

test('existing-user evidence replacement uses the shared drag-and-drop picker',()=>{
 assert.match(userModal,/<EvidenceFilePicker kind=\{reactivating\?['"]New Reactivation Evidence['"]:['"]Replace Evidence['"]\}/);
 assert.match(userModal,/file=\{uploads\[k\]\}/);
 assert.match(userModal,/required=\{reactivating\|\|changeKinds\.includes\(k\)\}/);
 assert.doesNotMatch(userModal,/<label>\{reactivating\?['"]New Reactivation Evidence['"]:['"]Replace Evidence['"]\}<input/);
});

test('updated SAAR workflow supports drag and drop and clears its override',()=>{
 assert.match(userModal,/<EvidenceFilePicker kind="Updated SAAR" file=\{saar\}/);
 assert.match(userModal,/onFile=\{file=>\{setSaar\(file\);setAccessOverride\(false\)\}\}/);
 assert.doesNotMatch(userModal,/<label>Updated SAAR<input/);
});
