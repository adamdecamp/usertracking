import test from 'node:test';
import assert from 'node:assert/strict';
import {artifactStorageFolder,canRecoverNewUserSaarFromForm,canonicalArtifactKind,canonicalEvidenceFilename,canonicalValidatedSaarFilename,disabledSaarFilename,filenameIdentityMatches,filenameMatchesKind,identityFromFilename,looksLikeEvidenceFilename,normalizeFilenameDate,organizationFrom,parseDate,preserveEvidenceExtension,validateNewUserSaarFilename} from '../app/filename-utils.ts';

const dod='Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf';
const general='Brown_Jacob_(LM)_GEN_User_Agreement_26AUG2026.pdf';
const spacedDod='Brown, Jacob (LM) DoD Cyber Cert 26AUG2026.pdf';
const extraSpaceGeneral='  Brown  _   Jacob   (LM)   GEN   User   Agreement   26AUG2026.pdf';

test('maps canonical evidence kinds to organization document-type folders',()=>{
 assert.equal(artifactStorageFolder('SAAR'),'SAAR');
 assert.equal(artifactStorageFolder('GEN and PRIV Agreement'),'User Agreement');
 assert.equal(artifactStorageFolder('DoD Cyber Cert'),'DoD Cyber Cert');
 assert.equal(artifactStorageFolder('8140 Cert Memo'),'8140 Certification Memo');
 assert.equal(artifactStorageFolder('Privileged User Training Cert'),'Privileged User Training');
 assert.equal(artifactStorageFolder('DTA Training Cert'),'DTA Training');
 assert.equal(artifactStorageFolder('Unknown'),undefined);
});

test('recognizes the reported DoD Cyber certificate filename',()=>{
 assert.equal(looksLikeEvidenceFilename(dod),true);
 assert.equal(filenameMatchesKind(dod,'DoD Cyber Cert'),true);
 assert.equal(filenameIdentityMatches(dod,{last:'Brown',first:'Jacob'}),true);
 assert.deepEqual(identityFromFilename(dod),{last:'Brown',first:'Jacob'});
 assert.equal(organizationFrom(dod),'LM');
 assert.equal(parseDate(dod)?.toISOString(),'2026-08-26T00:00:00.000Z');
});

test('recognizes Cyber Awareness filename wording as DoD Cyber evidence',()=>{
 for(const filename of [
  'Brown_Jacob_(LM)_Cyber_Awareness_Challenge_Certificate_08262026.pdf',
  'Brown, Jacob (LM) Cyber Awareness Certificate AUG262026.pdf',
  'Brown Jacob (LM) Awareness Challenge Certificate 26 AUG 26.pdf',
 ]){
  assert.equal(filenameMatchesKind(filename,'DoD Cyber Cert'),true,filename);
  assert.equal(looksLikeEvidenceFilename(filename),true,filename);
 }
});

test('never treats a certificate title as a Last Name and First Name',()=>{
 for(const filename of [
  'Cyber_Awareness_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',
  'Awareness Challenge (GOV) DoD Cyber Cert 26AUG2026.pdf',
  'DoD_Cyber_(NGC)_Cyber_Awareness_Challenge_Certificate_26AUG2026.pdf.zip',
 ]){
  assert.equal(identityFromFilename(filename),undefined,filename);
 }
});

test('canonicalizes every recognized evidence filename from parsed metadata',()=>{
 const cases:[string,string][]=[
  ['Brown, Jacob (LM) Cyber Awareness Challenge Certificate 2026-08-26.pdf','Brown_Jacob_(GDMS)_DoD_Cyber_Cert_26AUG2026.pdf'],
  ['Brown_Jacob_(LM)_GEN_User_Agreement_08262026.pdf','Brown_Jacob_(GDMS)_User_Agreement_26AUG2026.pdf'],
  ['Brown Jacob (LM) 8140 Memo AUG262026.pdf','Brown_Jacob_(GDMS)_8140_Cert_Memo_26AUG2026.pdf'],
  ['Brown_Jacob_(LM)_PRIV_User_Training_26 AUG 26.pdf','Brown_Jacob_(GDMS)_Privileged_User_Training_Cert_26AUG2026.pdf'],
  ['Brown_Jacob_(LM)_DTA_Training_20260826.pdf','Brown_Jacob_(GDMS)_DTA_Training_Cert_26AUG2026.pdf'],
  ['Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf','Brown_Jacob_(GDMS)_GEN_SAAR_26AUG2026.pdf'],
  ['Brown_Jacob_(LM)_PRIV_admin_SAAR_26AUG2026.pdf.zip','Brown_Jacob_(GDMS)_PRIV_ADMIN_SAAR_26AUG2026.pdf.zip'],
 ];
 for(const[filename,expected]of cases)assert.equal(canonicalEvidenceFilename(filename,'GDMS'),expected,filename);
});

test('normalizes any non-SAAR 8140 evidence marker to the required memo filename',()=>{
 const cases:[string,string][]=[
  ['Brown Jacob draft 8140 08-26-2026.pdf','Brown_Jacob_(GDMS)_8140_Cert_Memo_26AUG2026.pdf'],
  ['Brown_Jacob_old_8140_document_20260826.zip','Brown_Jacob_(GDMS)_8140_Cert_Memo_26AUG2026.pdf.zip'],
  ['Brown, Jacob (WRONG) 8140 qualification 26 AUG 26.PDF','Brown_Jacob_(GDMS)_8140_Cert_Memo_26AUG2026.pdf'],
 ];
 for(const[filename,expected]of cases){
  assert.equal(filenameMatchesKind(filename,'8140 Cert Memo'),true,filename);
  assert.equal(canonicalEvidenceFilename(filename,'GDMS'),expected,filename);
 }
});

test('recognizes the reported General User Agreement filename',()=>{
 assert.equal(looksLikeEvidenceFilename(general),true);
 assert.equal(filenameMatchesKind(general,'User Agreement'),true);
 assert.equal(filenameIdentityMatches(general,{last:'Brown',first:'Jacob'}),true);
 assert.equal(filenameMatchesKind(general,'DoD Cyber Cert'),false);
});

test('recognizes the stored one-PDF ZIP form of both filenames',()=>{
 assert.equal(filenameMatchesKind(`${dod}.zip`,'DoD Cyber Cert'),true);
 assert.equal(filenameMatchesKind(`${general}.zip`,'User Agreement'),true);
 const bareZip='Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.zip';
 assert.equal(looksLikeEvidenceFilename(bareZip),true);
 assert.equal(filenameIdentityMatches(bareZip,{last:'Brown',first:'Jacob'}),true);
 assert.equal(parseDate(bareZip)?.toISOString(),'2026-08-26T00:00:00.000Z');
 assert.equal(canonicalEvidenceFilename(bareZip,'LM'),'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf.zip');
});

test('tolerates commas, missing underscores, and additional spaces',()=>{
 assert.equal(looksLikeEvidenceFilename(spacedDod),true);
 assert.equal(filenameMatchesKind(spacedDod,'DoD Cyber Cert'),true);
 assert.equal(filenameIdentityMatches(spacedDod,{last:'Brown',first:'Jacob'}),true);
 assert.deepEqual(identityFromFilename(spacedDod),{last:'Brown',first:'Jacob'});
 assert.equal(organizationFrom(spacedDod),'LM');
 assert.equal(looksLikeEvidenceFilename(extraSpaceGeneral),true);
 assert.equal(filenameMatchesKind(extraSpaceGeneral,'User Agreement'),true);
 assert.equal(filenameIdentityMatches(extraSpaceGeneral,{last:'Brown',first:'Jacob'}),true);
});

test('tolerates omitted separators inside artifact and SAAR role markers',()=>{
 const generalSaar='Brown_Jacob_(GDMS)_GENSAAR_26AUG2026.pdf';
 assert.equal(filenameMatchesKind(generalSaar,'SAAR'),true);
 assert.deepEqual(validateNewUserSaarFilename(generalSaar),{valid:true,identity:{last:'Brown',first:'Jacob'},organization:'GDMS',role:'General',privilegedTypes:[]});
 assert.equal(filenameMatchesKind('Brown_Jacob_(GDMS)_DoDCyberCert_26AUG2026.pdf','DoD Cyber Cert'),true);
 assert.equal(filenameMatchesKind('Brown_Jacob_(GDMS)_GENUserAgreement_26AUG2026.pdf','User Agreement'),true);
 assert.equal(filenameMatchesKind('Brown_Jacob_(GDMS)_PRIVUserTrainingCert_26AUG2026.pdf','Privileged User Training Cert'),true);
 assert.equal(filenameMatchesKind('Brown_Jacob_(GDMS)_DTAUserTrainingCert_26AUG2026.pdf','DTA Training Cert'),true);
 assert.deepEqual(validateNewUserSaarFilename('Brown_Jacob_(GDMS)_PRIVadminSAAR_26AUG2026.pdf'),{valid:true,identity:{last:'Brown',first:'Jacob'},organization:'GDMS',role:'Privileged',privilegedTypes:['ADMIN']});
});

test('consolidates legacy agreement filenames into one User Agreement requirement',()=>{
 for(const filename of [
  'Brown_Jacob_(LM)_GEN_User_Agreement_26AUG2026.pdf',
  'Brown_Jacob_(LM)_GEN_and_PRIV_Agreement_26AUG2026.pdf',
  'Brown_Jacob_(LM)_DTA_Agreement_26AUG2026.pdf',
  'Brown_Jacob_(LM)_User_Agreements_26AUG2026.pdf',
 ])assert.equal(filenameMatchesKind(filename,'User Agreement'),true,filename);
 for(const kind of ['GEN User Agreement','GEN and PRIV Agreement','DTA Agreement'])assert.equal(canonicalArtifactKind(kind),'User Agreement');
 assert.equal(filenameMatchesKind('Brown_Jacob_(LM)_PRIV_admin_SAAR_26AUG2026.pdf','User Agreement'),false);
});

test('still rejects a reversed First-Last identity for the expected user',()=>{
 assert.equal(filenameIdentityMatches('Jacob Brown (LM) DoD Cyber Cert 26AUG2026.pdf',{last:'Brown',first:'Jacob'}),false);
});

test('admits only complete GEN or PRIV SAAR filenames for automatic new-user discovery',()=>{
 assert.deepEqual(validateNewUserSaarFilename('Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf'),{
  valid:true,identity:{last:'Brown',first:'Jacob'},organization:'LM',role:'General',privilegedTypes:[],
 });
 assert.deepEqual(validateNewUserSaarFilename('Brown, Jacob (LM) PRIV admin SAAR 26AUG2026.pdf'),{
  valid:true,identity:{last:'Brown',first:'Jacob'},organization:'LM',role:'Privileged',privilegedTypes:['ADMIN'],
 });
});

test('rejects template and incomplete SAAR filenames before automatic new-user discovery',()=>{
 const invalid=[
  'Last_First_(Org)_GEN_SAAR_26AUG2026.pdf',
  'Brown_Jacob_GEN_SAAR_26AUG2026.pdf',
  'Brown_Jacob_(LM)_SAAR_26AUG2026.pdf',
  'Brown_Jacob_(LM)_GEN_PRIV_SAAR_26AUG2026.pdf',
  'Brown_Jacob_(LM)_PRIV_TYPE_SAAR_26AUG2026.pdf',
  'Brown_Jacob_(LM)_PRIV_SAAR_26AUG2026.pdf',
  'Brown_Jacob_(LM)_GEN_SAAR_31FEB2026.pdf',
 ];
 for(const filename of invalid)assert.equal(validateNewUserSaarFilename(filename).valid,false,filename);
});

test('uses fillable-PDF identity and organization only when filename values are unavailable',()=>{
 assert.deepEqual(validateNewUserSaarFilename('Last_First_(Org)_GEN_SAAR_26AUG2026.pdf',{identity:{last:'Shaw',first:'Vivian'},organization:'GOV'}),{
  valid:true,identity:{last:'Shaw',first:'Vivian'},organization:'GOV',role:'General',privilegedTypes:[],
 });
 assert.deepEqual(validateNewUserSaarFilename('Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf',{identity:{last:'Wrong',first:'Person'},organization:'Wrong'}),{
  valid:true,identity:{last:'Brown',first:'Jacob'},organization:'LM',role:'General',privilegedTypes:[],
 });
});

test('canonicalizes a fallback-matched SAAR before it seeds a new user',()=>{
 const validation=validateNewUserSaarFilename('Last_First_(ORG)_GEN_SAAR_26AUG2026.pdf.zip',{identity:{last:'Shaw',first:'Vivian'},organization:'GOV'});
 assert.equal(validation.valid,true);
 if(validation.valid)assert.equal(canonicalValidatedSaarFilename('Last_First_(ORG)_GEN_SAAR_26AUG2026.pdf.zip',validation),'Shaw_Vivian_(GOV)_GEN_SAAR_26AUG2026.pdf.zip');
 const privileged=validateNewUserSaarFilename('PRIV_dta_SAAR_20260826.pdf',{identity:{last:'Brown',first:'Jacob'},organization:'LM'});
 assert.equal(privileged.valid,true);
 if(privileged.valid)assert.equal(canonicalValidatedSaarFilename('PRIV_dta_SAAR_20260826.pdf',privileged),'Brown_Jacob_(LM)_PRIV_DTA_SAAR_26AUG2026.pdf');
});

test('uses a verified requester signature date to canonicalize an otherwise complete SAAR',()=>{
 const requestDate=new Date('2026-08-26T00:00:00.000Z'),filename='Brown_Jacob_(LM)_GEN_SAAR.pdf',validation=validateNewUserSaarFilename(filename,{requestDate});
 assert.equal(validation.valid,true);
 if(validation.valid)assert.equal(canonicalValidatedSaarFilename(filename,validation,requestDate),'Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf');
});

test('rejects an invalid requester signature date fallback',()=>{
 assert.equal(validateNewUserSaarFilename('Brown_Jacob_(LM)_GEN_SAAR.pdf',{requestDate:new Date(Number.NaN)}).valid,false);
});

test('opens only SAARs whose missing filename fields can be recovered from the form',()=>{
 assert.equal(canRecoverNewUserSaarFromForm('Last_First_(ORG)_GEN_SAAR_26AUG2026.pdf',{organization:'GDMS'}),true);
 assert.equal(canRecoverNewUserSaarFromForm('Brown_Jacob_GEN_SAAR_26AUG2026.pdf',{organization:'GDMS'}),false);
 assert.equal(validateNewUserSaarFilename('Brown_Jacob_GEN_SAAR_26AUG2026.pdf',{organization:'GDMS'}).valid,true);
 assert.equal(canRecoverNewUserSaarFromForm('Brown_Jacob_(GDMS)_SAAR_26AUG2026.pdf',{organization:'GDMS'}),false);
 assert.equal(canRecoverNewUserSaarFromForm('Brown_Jacob_(GDMS)_PRIV_TYPE_SAAR_26AUG2026.pdf',{organization:'GDMS'}),false);
});

test('treats a standalone DISABLED marker on a SAAR as archive-only evidence',()=>{
 const disabled='Brown_Jacob_(LM)_GEN_SAAR_DISABLED_26AUG2026.pdf';
 assert.equal(disabledSaarFilename(disabled),true);
 assert.equal(validateNewUserSaarFilename(disabled).valid,false);
 assert.equal(validateNewUserSaarFilename(disabled,{allowDisabled:true}).valid,true);
 assert.equal(canRecoverNewUserSaarFromForm(disabled,{organization:'LM'}),false);
 assert.equal(disabledSaarFilename('Disabledson_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf'),false);
 assert.equal(disabledSaarFilename('Brown_Jacob_(LM)_GEN_SAAR_NOTDISABLED_26AUG2026.pdf'),false);
});

test('recognizes common date formats and normalizes them to DDMMMYYYY',()=>{
 const variants=['20260826','08262026','AUG262026','082626','26-08-2026','2026.8.26','26 AUG 26'];
 for(const value of variants){
  const filename=`Brown_Jacob_(LM)_GEN_User_Agreement_${value}.pdf`,result=normalizeFilenameDate(filename);
  assert.equal(parseDate(filename)?.toISOString(),'2026-08-26T00:00:00.000Z',filename);
  assert.equal(result?.normalized,'Brown_Jacob_(LM)_GEN_User_Agreement_26AUG2026.pdf',filename);
  assert.equal(result?.changed,true,filename);
 }
 assert.equal(normalizeFilenameDate('Brown_Jacob_(LM)_GEN_User_Agreement_26AUG2026.pdf')?.changed,false);
});

test('rejects impossible dates rather than normalizing them',()=>{
 for(const value of ['20260230','13322026','31FEB2026','000000','2026-32-13']){
  const filename=`Brown_Jacob_(LM)_GEN_User_Agreement_${value}.pdf`;
  assert.equal(parseDate(filename),undefined,filename);
  assert.equal(normalizeFilenameDate(filename),undefined,filename);
 }
});

test('preserves the source evidence extension for every normalized target',()=>{
 assert.equal(preserveEvidenceExtension('Brown_Jacob.pdf','Brown_Jacob_Normalized.pdf'),'Brown_Jacob_Normalized.pdf');
 assert.equal(preserveEvidenceExtension('Brown_Jacob.pdf.zip','Brown_Jacob_Normalized.pdf'),'Brown_Jacob_Normalized.pdf.zip');
 assert.equal(preserveEvidenceExtension('Brown_Jacob.pdf','Brown_Jacob_Normalized.pdf.zip'),'Brown_Jacob_Normalized.pdf');
});
