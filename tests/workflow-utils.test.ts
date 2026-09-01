import test from 'node:test';
import assert from 'node:assert/strict';
import {activeComplianceException,applySyncArtifactProvenance,committedRecordWithExceptions,duplicateContentGroups,notificationRecipientBatches,proposedNewUserArtifacts,reconcileEvidence} from '../app/workflow-utils.ts';

test('groups exact duplicate PDF content hashes without trusting filenames',()=>{
 const same='a'.repeat(64),groups=duplicateContentGroups([{filename:'one.pdf',path:'GOV/one.pdf',sha256:same},{filename:'different-name.pdf.zip',path:'GOV/different-name.pdf.zip',sha256:same.toUpperCase()},{filename:'unique.pdf',path:'GOV/unique.pdf',sha256:'b'.repeat(64)},{filename:'invalid.pdf',path:'GOV/invalid.pdf',sha256:'not-a-hash'}]);
 assert.deepEqual(groups,[{sha256:same,files:[{filename:'different-name.pdf.zip',path:'GOV/different-name.pdf.zip'},{filename:'one.pdf',path:'GOV/one.pdf'}]}]);
});

test('returns only an active, unrevoked compliance exception',()=>{
 const exceptions=[{id:'old',artifact:'8140 Cert Memo',reason:'old',approvedBy:'A',createdAt:'2026-01-01T00:00:00Z',createdBy:'B',expiresOn:'2026-01-31'},{id:'active',artifact:'8140 Cert Memo',reason:'temporary',approvedBy:'A',createdAt:'2026-08-01T00:00:00Z',createdBy:'B',expiresOn:'2026-09-30'}];
 assert.equal(activeComplianceException(exceptions,'8140 Cert Memo',new Date('2026-08-28T12:00:00Z'))?.id,'active');
 assert.equal(activeComplianceException(exceptions,'SAAR',new Date('2026-08-28T12:00:00Z')),undefined);
});

test('deduplicates and splits notification recipients by count and encoded length',()=>{
 assert.deepEqual(notificationRecipientBatches(['A@example.mil','a@example.mil','b@example.mil'],1),[['a@example.mil'],['b@example.mil']]);
 assert.deepEqual(notificationRecipientBatches(['one@example.mil','two@example.mil'],40,20),[['one@example.mil'],['two@example.mil']]);
});

test('commits exception changes without leaking unrelated draft edits',()=>{
 const committed={id:'u1',roles:['General'],exceptions:[]},draft={...committed,roles:['Privileged']},exception={id:'e1',artifact:'DoD Cyber Cert',reason:'temporary',approvedBy:'AO',createdAt:'2026-08-28T12:00:00Z',createdBy:'operator',expiresOn:'2026-09-30'};
 const updated=committedRecordWithExceptions(committed,[exception]);
 assert.deepEqual(updated.roles,['General']);assert.deepEqual(updated.exceptions,[exception]);assert.deepEqual(draft.roles,['Privileged']);
});

test('adds provenance only to Sync-touched artifacts',()=>{
 const users=[{id:'u1',last:'Brown',first:'Jacob',artifacts:[{kind:'SAAR',filename:'Brown_Jacob_(GOV)_GEN_SAAR_26AUG2026.pdf.zip'},{kind:'DoD Cyber Cert',filename:'Brown_Jacob_(GOV)_DoD_Cyber_Cert_26AUG2026.pdf.zip'}]}],hash='a'.repeat(64),storedAt='2026-08-28T12:00:00Z';
 const updated=applySyncArtifactProvenance(users,new Set(['u1:SAAR']),[{filename:users[0].artifacts[0].filename,path:'User Evidence/GOV/Brown_Jacob/saar.zip',sha256:hash}],storedAt,'operator');
 assert.deepEqual(updated[0].artifacts[0],{...users[0].artifacts[0],sha256:hash,path:'User Evidence/GOV/Brown_Jacob/saar.zip',storedAt,storedBy:'operator',source:'Sync'});assert.deepEqual(updated[0].artifacts[1],users[0].artifacts[1]);
});

test('seeds a new user from the SAAR before matching supporting evidence',()=>{
 const saar='Brown_Jacob_(GDMS)_GENSAAR_26AUG2026.pdf',files=[
  saar,
  'Brown_Jacob_(GDMS)_DoDCyberCert_26AUG2026.pdf',
  'Brown_Jacob_(GDMS)_GENUserAgreement_26AUG2026.pdf',
  'Someone_Else_(GDMS)_DoDCyberCert_26AUG2026.pdf',
 ];
 assert.deepEqual(proposedNewUserArtifacts(files,{last:'Brown',first:'Jacob'},['SAAR','DoD Cyber Cert','User Agreement'],saar),[
  {kind:'SAAR',filename:saar},
  {kind:'DoD Cyber Cert',filename:'Brown_Jacob_(GDMS)_DoDCyberCert_26AUG2026.pdf'},
  {kind:'User Agreement',filename:'Brown_Jacob_(GDMS)_GENUserAgreement_26AUG2026.pdf'},
 ]);
});

test('scopes supporting evidence for a new SAAR user to the same organization',()=>{
 const saar='Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf',files=[saar,'Brown_Jacob_(GOV)_DoD_Cyber_Cert_30AUG2026.pdf','Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf'];
 assert.deepEqual(proposedNewUserArtifacts(files,{last:'Brown',first:'Jacob',organization:'LM'},['SAAR','DoD Cyber Cert'],saar),[
  {kind:'SAAR',filename:saar},
  {kind:'DoD Cyber Cert',filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf'},
 ]);
});

test('reconciles missing, orphaned, conflicting, duplicate, and rejected evidence',()=>{
 const users=[{id:'u1',last:'Brown',first:'Jacob',email:'shared@example.mil',organization:'LM',artifacts:[{kind:'SAAR',filename:'Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf.zip'}]},{id:'u2',last:'Brown',first:'Jacob',email:'shared@example.mil',organization:'GOV',artifacts:[{kind:'DoD Cyber Cert',filename:'Brown_Jacob_(GOV)_DoD_Cyber_Cert_26AUG2026.pdf.zip',sha256:'a'.repeat(64)}]}];
 const evidence=[{filename:'Brown_Jacob_(GOV)_DoD_Cyber_Cert_26AUG2026.pdf.zip',path:'User Evidence/GOV/Brown_Jacob/cert.zip',sha256:'b'.repeat(64)},{filename:'Smith_Jill_(LM)_GEN_SAAR_26AUG2026.pdf.zip',path:'User Evidence/LM/Smith_Jill/file.zip'}];
 const issues=reconcileEvidence(users,evidence,[{filename:'bad.pdf',reason:'Unreadable',path:'bad.pdf'}]);
 assert.ok(issues.some(issue=>issue.category==='Missing File'));assert.ok(issues.some(issue=>issue.category==='Content Changed'));assert.ok(issues.some(issue=>issue.category==='Orphan Evidence'));assert.ok(issues.some(issue=>issue.category==='Organization Conflict'));assert.ok(issues.some(issue=>issue.category==='Duplicate Identity'));assert.ok(issues.some(issue=>issue.category==='Duplicate Email'));assert.ok(issues.some(issue=>issue.category==='Rejected Evidence'));
});
