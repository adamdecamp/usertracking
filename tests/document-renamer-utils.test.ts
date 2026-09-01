import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDocumentText,buildTrackerFilename,folderOrganizationDiffers,normalizeFilenameOrganization,organizationCleanupDirectory,organizationFromFolderPath,organizationStorageLocation} from '../app/document-renamer-utils.ts';
import {canonicalEvidenceFilename} from '../app/filename-utils.ts';

const users=[{first:'Jacob',last:'Brown',organization:'LM',roles:['General'],privilegedTypes:[]}];

test('reads a signed general user agreement and builds the ingest filename',()=>{
 const analysis=analyzeDocumentText('GENERAL USER AGREEMENT Name of User: Brown, Jacob Signature Date: 08/26/2026','scan 004.pdf',users);
 assert.equal(analysis.kind,'User Agreement');assert.equal(analysis.date,'2026-08-26');assert.equal(analysis.confidence,'High');
 assert.equal(buildTrackerFilename(analysis),'Brown_Jacob_(LM)_User_Agreement_26AUG2026.pdf');
});

test('prefers certification date over expiration date for Security+',()=>{
 const analysis=analyzeDocumentText('CompTIA Security+ This is to certify that Jacob Brown Date Certified: August 26, 2026 Expiration Date: August 26, 2029','certificate.pdf',users);
 assert.equal(analysis.kind,'DoD Cyber Cert');assert.equal(analysis.date,'2026-08-26');
 assert.equal(buildTrackerFilename(analysis),'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf');
});

test('recognizes Cyber Awareness Challenge certificates and canonicalizes their filename',()=>{
 for(const title of ['Cyber Awareness Challenge Certificate','Cyber Awareness Certificate','Awareness Challenge Certificate']){
  const analysis=analyzeDocumentText(`${title} This certifies that Jacob Brown Date of Completion: August 26, 2026`,`${title} FY26.pdf`,users);
  assert.equal(analysis.kind,'DoD Cyber Cert',title);assert.equal(analysis.date,'2026-08-26',title);assert.equal(analysis.confidence,'High',title);
  assert.equal(buildTrackerFilename(analysis),'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',title);
 }
});

test('reads a full completion date from a privileged training certificate when its filename has only a year',()=>{
 const analysis=analyzeDocumentText('DCSA Privileged User Cybersecurity Responsibilities Training Certificate. This certifies that Jacob Brown completed the course. August 26, 2023 Certificate Date.','Brown_Jacob_(LM)_PRIV_User_Training_2023.pdf',users);
 assert.equal(analysis.kind,'Privileged User Training Cert');
 assert.equal(analysis.date,'2023-08-26');
 assert.equal(analysis.confidence,'High');
 assert.equal(buildTrackerFilename(analysis),'Brown_Jacob_(LM)_Privileged_User_Training_Cert_26AUG2023.pdf');
});

test('requires operator input when a signed date is not labeled',()=>{
 const analysis=analyzeDocumentText('GENERAL USER AGREEMENT Jacob Brown 08/26/2026','agreement.pdf',users);
 assert.equal(analysis.date,'');assert.equal(analysis.confidence,'Manual');
});

test('builds privileged SAAR names with the account type',()=>{
 assert.equal(buildTrackerFilename({kind:'SAAR',first:'Ava',last:'Shaw',organization:'GOV',date:'2026-08-24',role:'PRIV',privilegedType:'DTA'}),'Shaw_Ava_(GOV)_PRIV_DTA_SAAR_24AUG2026.pdf');
});

test('uses the organization folder while skipping the managed user-evidence identity folder',()=>{
 assert.equal(organizationFromFolderPath('Intelligence Group/certificate.pdf','DEFAULT'),'Intelligence Group');
 assert.equal(organizationFromFolderPath('User Evidence/LM/Brown_Jacob/certificate.pdf','DEFAULT'),'LM');
 assert.equal(organizationFromFolderPath('GDMS/Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf','DEFAULT'),'GDMS');
 assert.equal(organizationFromFolderPath('LM/Brown_Jacob/Brown_Jacob_(GOV)_SAAR_26AUG2026.pdf','DEFAULT'),'LM');
 assert.equal(organizationFromFolderPath('GDMS/Privileged/Brown_Jacob/Brown_Jacob_(TEST)_SAAR_26AUG2026.pdf','DEFAULT'),'GDMS');
 assert.equal(organizationFromFolderPath('Active Evidence/GDMS/Brown_Jacob/Brown_Jacob_(TEST)_SAAR_26AUG2026.pdf','DEFAULT'),'GDMS');
 assert.equal(organizationFromFolderPath('Active Evidence/GDMS/Privileged Users/Brown_Jacob/Brown_Jacob_(TEST)_SAAR_26AUG2026.pdf','DEFAULT'),'GDMS');
 assert.equal(organizationFromFolderPath('GOV/Privileged/Unsorted/Brown_Jacob_(TEST)_SAAR_26AUG2026.pdf','DEFAULT'),'GOV');
 assert.equal(organizationFromFolderPath('Boeing/Hill_Morgan/Last_First_(ORG)_GEN_SAAR_26AUG2026.pdf','DEFAULT',{last:'Hill',first:'Morgan'}),'Boeing');
 assert.equal(organizationFromFolderPath('certificate.pdf','DEFAULT'),'DEFAULT');
 assert.equal(organizationFromFolderPath('Brown_Jacob_(TEST)_SAAR_26AUG2026.pdf','NGC'),'NGC');
 assert.equal(organizationFromFolderPath('Brown_Jacob/Brown_Jacob_(TEST)_SAAR_26AUG2026.pdf','NGC'),'NGC');
 assert.equal(folderOrganizationDiffers('GOV/certificate.pdf','LM','DEFAULT'),true);
 assert.equal(folderOrganizationDiffers('GOV/certificate.pdf','gov','DEFAULT'),false);
});

test('places Rework and Archive inside the authoritative organization folder',()=>{
 assert.deepEqual(organizationStorageLocation('User Evidence/GDMS/Brown_Jacob/file.pdf','SYSTEM'),{organization:'GDMS',relativeDirectory:'User Evidence/GDMS'});
 assert.deepEqual(organizationCleanupDirectory('User Evidence/GDMS/Brown_Jacob/file.pdf','SYSTEM','Rework'),{organization:'GDMS',relativeDirectory:'User Evidence/GDMS',folder:'GDMS Rework',path:'User Evidence/GDMS/GDMS Rework'});
 assert.equal(organizationCleanupDirectory('NGC/Brown_Jacob/Brown_Jacob_(NGC)_SAAR_26AUG2026.pdf','SYSTEM','Archive').path,'NGC/NGC Archive');
 assert.equal(organizationCleanupDirectory('Brown_Jacob/Brown_Jacob_(GDMS)_SAAR_26AUG2026.pdf','GDMS','Rework').path,'GDMS Rework');
 assert.equal(organizationCleanupDirectory('file.pdf','GDMS','Archive').path,'GDMS Archive');
});

test('normalizes the filename organization to its authoritative parent folder',()=>{
 assert.deepEqual(normalizeFilenameOrganization('Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf','GDMS'),{normalized:'Brown_Jacob_(GDMS)_DoD_Cyber_Cert_26AUG2026.pdf',organization:'GDMS',changed:true});
 assert.deepEqual(normalizeFilenameOrganization('Brown, Jacob DoD Cyber Cert 26AUG2026.pdf','GDMS'),{normalized:'Brown, Jacob_(GDMS)_DoD Cyber Cert 26AUG2026.pdf',organization:'GDMS',changed:true});
 assert.equal(normalizeFilenameOrganization('Brown_Jacob_(TEST)_SAAR_26AUG2026.pdf',organizationFromFolderPath('Brown_Jacob_(TEST)_SAAR_26AUG2026.pdf','NGC'))?.normalized,'Brown_Jacob_(NGC)_SAAR_26AUG2026.pdf');
 assert.equal(normalizeFilenameOrganization('Brown_Jacob_(GDMS)_User_Agreement_26AUG2026.pdf','GDMS')?.changed,false);
 assert.deepEqual(normalizeFilenameOrganization('Brown_Jacob_(WRONG)_Unrecognized_Form_26AUG2026.pdf','GOV'),{normalized:'Brown_Jacob_(GOV)_Unrecognized_Form_26AUG2026.pdf',organization:'GOV',changed:true});
});

test('evaluates every artifact in every sibling organization folder',()=>{
 const organizations=['GOV','GDMS','NGC','LM','Boeing','Raytheon','SAIC','Leidos','MITRE','USAF','USN','USA'],filenames=['Brown_Jacob_(WRONG)_GEN_SAAR_26AUG2026.pdf','Brown_Jacob_(WRONG)_DoD_Cyber_Cert_26AUG2026.pdf','Brown_Jacob_(WRONG)_User_Agreement_26AUG2026.pdf','Brown_Jacob_(WRONG)_8140_Cert_Memo_26AUG2026.pdf','Brown_Jacob_(WRONG)_Privileged_User_Training_Cert_26AUG2026.pdf','Brown_Jacob_(WRONG)_DTA_Training_Cert_26AUG2026.pdf'];let checked=0;
 for(const organization of organizations)for(const filename of filenames){const folder=organizationFromFolderPath(`${organization}/Privileged/Brown_Jacob/${filename}`,'SYSTEM'),normalized=normalizeFilenameOrganization(filename,folder)?.normalized,canonical=canonicalEvidenceFilename(filename,folder);assert.equal(folder,organization);assert.ok(normalized?.includes(`_(${organization})_`));assert.ok(canonical?.includes(`_(${organization})_`));checked++}
 assert.equal(checked,organizations.length*filenames.length);
});
