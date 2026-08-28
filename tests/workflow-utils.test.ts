import test from 'node:test';
import assert from 'node:assert/strict';
import {activeComplianceException,notificationRecipientBatches,reconcileEvidence} from '../app/workflow-utils.ts';

test('returns only an active, unrevoked compliance exception',()=>{
 const exceptions=[{id:'old',artifact:'8140 Cert Memo',reason:'old',approvedBy:'A',createdAt:'2026-01-01T00:00:00Z',createdBy:'B',expiresOn:'2026-01-31'},{id:'active',artifact:'8140 Cert Memo',reason:'temporary',approvedBy:'A',createdAt:'2026-08-01T00:00:00Z',createdBy:'B',expiresOn:'2026-09-30'}];
 assert.equal(activeComplianceException(exceptions,'8140 Cert Memo',new Date('2026-08-28T12:00:00Z'))?.id,'active');
 assert.equal(activeComplianceException(exceptions,'SAAR',new Date('2026-08-28T12:00:00Z')),undefined);
});

test('deduplicates and splits notification recipients by count and encoded length',()=>{
 assert.deepEqual(notificationRecipientBatches(['A@example.mil','a@example.mil','b@example.mil'],1),[['a@example.mil'],['b@example.mil']]);
 assert.deepEqual(notificationRecipientBatches(['one@example.mil','two@example.mil'],40,20),[['one@example.mil'],['two@example.mil']]);
});

test('reconciles missing, orphaned, conflicting, duplicate, and rejected evidence',()=>{
 const users=[{id:'u1',last:'Brown',first:'Jacob',email:'shared@example.mil',organization:'LM',artifacts:[{kind:'SAAR',filename:'Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf.zip'}]},{id:'u2',last:'Brown',first:'Jacob',email:'shared@example.mil',organization:'GOV',artifacts:[{kind:'DoD Cyber Cert',filename:'Brown_Jacob_(GOV)_DoD_Cyber_Cert_26AUG2026.pdf.zip',sha256:'a'.repeat(64)}]}];
 const evidence=[{filename:'Brown_Jacob_(GOV)_DoD_Cyber_Cert_26AUG2026.pdf.zip',path:'User Evidence/GOV/Brown_Jacob/cert.zip',sha256:'b'.repeat(64)},{filename:'Smith_Jill_(LM)_GEN_SAAR_26AUG2026.pdf.zip',path:'User Evidence/LM/Smith_Jill/file.zip'}];
 const issues=reconcileEvidence(users,evidence,[{filename:'bad.pdf',reason:'Unreadable',path:'bad.pdf'}]);
 assert.ok(issues.some(issue=>issue.category==='Missing File'));assert.ok(issues.some(issue=>issue.category==='Content Changed'));assert.ok(issues.some(issue=>issue.category==='Orphan Evidence'));assert.ok(issues.some(issue=>issue.category==='Organization Conflict'));assert.ok(issues.some(issue=>issue.category==='Duplicate Identity'));assert.ok(issues.some(issue=>issue.category==='Duplicate Email'));assert.ok(issues.some(issue=>issue.category==='Rejected Evidence'));
});
