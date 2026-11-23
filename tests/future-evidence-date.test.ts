import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalEvidenceFilename,canonicalManualEvidenceFilename,evidenceDateIsInFuture,evidenceFilenamePassesStorageGate} from '../app/filename-utils.ts';
import {newestArtifactFor,statusFor} from '../app/user-status-utils.ts';
import type {UserRecord} from '../app/domain/tracker-models.ts';

const day=(iso:string)=>new Date(`${iso}T00:00:00.000Z`);

test('allows evidence through tomorrow in UTC so zones ahead of UTC can file today',()=>{
 const now=new Date('2026-11-22T18:00:00.000Z');
 assert.equal(evidenceDateIsInFuture(day('2026-11-22'),now),false);
 assert.equal(evidenceDateIsInFuture(day('2026-11-23'),now),false,'UTC+14 is already on Nov 23');
 assert.equal(evidenceDateIsInFuture(day('2026-11-24'),now),true);
 assert.equal(evidenceDateIsInFuture(day('2099-01-01'),now),true);
});

test('future-dated evidence cannot pass the storage gate or receive a canonical name',()=>{
 const future='Brown_Jacob_(LM)_DoD_Cyber_Cert_01JAN2099.pdf',past='Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf';
 assert.equal(evidenceFilenamePassesStorageGate(past),true);
 assert.equal(evidenceFilenamePassesStorageGate(future),false,'Sync routes it to Rework');
 assert.equal(canonicalEvidenceFilename(future),undefined);
 assert.equal(canonicalManualEvidenceFilename({filename:future,kind:'DoD Cyber Cert',last:'Brown',first:'Jacob',organization:'LM'}),undefined,'Manual upload refuses it');
 assert.ok(canonicalManualEvidenceFilename({filename:past,kind:'DoD Cyber Cert',last:'Brown',first:'Jacob',organization:'LM'}));
});

test('a stored future-dated file never counts as current evidence',()=>{
 const user:UserRecord={id:'u1',systemId:'s1',organization:'LM',affiliatedOrganizations:[],last:'Brown',first:'Jacob',middle:'',email:'jacob.brown@example.test',disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[
  {kind:'DoD Cyber Cert',filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_01JAN2099.pdf'},
 ]};
 assert.equal(statusFor(user,'DoD Cyber Cert'),'Missing');
 user.artifacts.push({kind:'DoD Cyber Cert',filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_01JAN2024.pdf'});
 assert.equal(newestArtifactFor(user,'DoD Cyber Cert')?.filename,'Brown_Jacob_(LM)_DoD_Cyber_Cert_01JAN2024.pdf','the older real file is used instead');
 assert.equal(statusFor(user,'DoD Cyber Cert'),'Overdue');
});
