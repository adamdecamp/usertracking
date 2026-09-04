import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEvidenceContent} from '../app/evidence-audit-utils.ts';

test('SAAR audit requires a dated Part IV account-action signature',()=>{
 assert.equal(auditEvidenceContent({kind:'SAAR'}).passed,false);
 assert.equal(auditEvidenceContent({kind:'SAAR',createdBySigned:true}).passed,false);
 assert.deepEqual(auditEvidenceContent({kind:'SAAR',createdBySigned:true,createdDate:'2026-08-26'}),{passed:true,reason:'Part IV Created By digital signature and signing date verified.',accountStatus:'Active',accountActionDate:'2026-08-26'});
 assert.deepEqual(auditEvidenceContent({kind:'SAAR',createdBySigned:true,createdDate:'2026-08-20',disabledBySigned:true,disabledDate:'2026-09-01'}),{passed:true,reason:'Part IV Disabled By digital signature and signing date verified.',accountStatus:'Disabled',accountActionDate:'2026-09-01'});
});

test('DoD Cyber audit accepts awareness certificates and rejects third-party credentials',()=>{
 assert.equal(auditEvidenceContent({kind:'DoD Cyber Cert',text:'Cyber Awareness Challenge Certificate'}).passed,true);
 assert.equal(auditEvidenceContent({kind:'DoD Cyber Cert',text:'CompTIA Security+ Continuing Education Certificate'}).passed,false);
 assert.equal(auditEvidenceContent({kind:'DoD Cyber Cert',text:'8570 qualification record'}).passed,false);
});

test('signature-required agreements and 8140 memoranda fail closed',()=>{
 assert.equal(auditEvidenceContent({kind:'User Agreement',text:'General and Privileged User Agreement'}).passed,false);
 assert.equal(auditEvidenceContent({kind:'User Agreement',text:'General and Privileged User Agreement',signedFieldNames:['User Signature']}).passed,true);
 assert.equal(auditEvidenceContent({kind:'8140 Cert Memo',text:'DoD 8140 Certification Memorandum'}).passed,false);
 assert.equal(auditEvidenceContent({kind:'8140 Cert Memo',text:'DoD 8140 Certification Memorandum',signedFieldNames:['Approver Signature']}).passed,true);
});

test('training audit applies document-specific language',()=>{
 assert.equal(auditEvidenceContent({kind:'Privileged User Training Cert',text:'Privileged User Cybersecurity Responsibilities Course'}).passed,true);
 assert.equal(auditEvidenceContent({kind:'DTA Training Cert',text:'Delegated Trusted Agent Training Certificate'}).passed,true);
 assert.equal(auditEvidenceContent({kind:'DTA Training Cert',text:'Privileged User Training'}).passed,false);
});
