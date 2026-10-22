import test from 'node:test';
import assert from 'node:assert/strict';
import {extractionField,mergeExtractionProvenance,saarExtractionProvenance} from '../app/application/extraction-provenance.ts';

const verifiedAtUtc='2026-10-21T12:00:00.000Z';

test('records filename, folder, form, and account-type provenance for a canonical SAAR',()=>{
 const result=saarExtractionProvenance({email:'user@example.invalid',emailSource:'SAAR AcroForm',identity:{last:'Sample',first:'User',middle:''},designation:'CTR',format:'AcroForm',emailRecoveryAttempted:true},'Sample_User_(ORG)_PRIV_dev_SAAR_21OCT2026.pdf','ORG');
 assert.equal(result.identity?.source,'Filename');
 assert.equal(result.organization?.source,'Organization Folder');
 assert.equal(result.officialEmail?.source,'SAAR AcroForm');
 assert.equal(result.designation?.source,'SAAR AcroForm');
 assert.equal(result.accountType?.source,'Filename');
});

test('uses form provenance when a SAAR filename has no usable identity',()=>{
 const result=saarExtractionProvenance({email:'',identity:{last:'Sample',first:'User',middle:''},format:'XFA',emailRecoveryAttempted:true},'dd2875.pdf','ORG');
 assert.equal(result.identity?.source,'DD2875 XFA');
 assert.equal(result.accountType,undefined);
});

test('operator provenance replaces only the field the operator edits',()=>{
 const current={identity:extractionField('Filename','Parsed filename.','Sample_User.pdf',verifiedAtUtc),organization:extractionField('Organization Folder','Mapped folder.','Sample_User.pdf',verifiedAtUtc)};
 const updated=mergeExtractionProvenance(current,{officialEmail:extractionField('Operator','Entered by operator.',undefined,verifiedAtUtc)});
 assert.equal(updated.identity?.source,'Filename');
 assert.equal(updated.officialEmail?.source,'Operator');
});
