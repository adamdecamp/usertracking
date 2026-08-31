import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDocumentText,buildTrackerFilename,folderOrganizationDiffers,organizationFromFolderPath} from '../app/document-renamer-utils.ts';

const users=[{first:'Jacob',last:'Brown',organization:'LM',roles:['General'],privilegedTypes:[]}];

test('reads a signed general user agreement and builds the ingest filename',()=>{
 const analysis=analyzeDocumentText('GENERAL USER AGREEMENT Name of User: Brown, Jacob Signature Date: 08/26/2026','scan 004.pdf',users);
 assert.equal(analysis.kind,'GEN User Agreement');assert.equal(analysis.date,'2026-08-26');assert.equal(analysis.confidence,'High');
 assert.equal(buildTrackerFilename(analysis),'Brown_Jacob_(LM)_GEN_User_Agreement_26AUG2026.pdf');
});

test('prefers certification date over expiration date for Security+',()=>{
 const analysis=analyzeDocumentText('CompTIA Security+ This is to certify that Jacob Brown Date Certified: August 26, 2026 Expiration Date: August 26, 2029','certificate.pdf',users);
 assert.equal(analysis.kind,'DoD Cyber Cert');assert.equal(analysis.date,'2026-08-26');
 assert.equal(buildTrackerFilename(analysis),'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf');
});

test('requires operator input when a signed date is not labeled',()=>{
 const analysis=analyzeDocumentText('GENERAL USER AGREEMENT Jacob Brown 08/26/2026','agreement.pdf',users);
 assert.equal(analysis.date,'');assert.equal(analysis.confidence,'Manual');
});

test('builds privileged SAAR names with the account type',()=>{
 assert.equal(buildTrackerFilename({kind:'SAAR',first:'Ava',last:'Shaw',organization:'GOV',date:'2026-08-24',role:'PRIV',privilegedType:'DTA'}),'Shaw_Ava_(GOV)_PRIV_DTA_SAAR_24AUG2026.pdf');
});

test('uses the immediate containing folder as the organization',()=>{
 assert.equal(organizationFromFolderPath('Intelligence Group/certificate.pdf','DEFAULT'),'Intelligence Group');
 assert.equal(organizationFromFolderPath('User Evidence/LM/Brown_Jacob/certificate.pdf','DEFAULT'),'Brown_Jacob');
 assert.equal(organizationFromFolderPath('certificate.pdf','DEFAULT'),'DEFAULT');
 assert.equal(folderOrganizationDiffers('GOV/certificate.pdf','LM','DEFAULT'),true);
 assert.equal(folderOrganizationDiffers('GOV/certificate.pdf','gov','DEFAULT'),false);
});
