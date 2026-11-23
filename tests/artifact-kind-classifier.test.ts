import assert from 'node:assert/strict';
import test from 'node:test';
import {artifactKindFromFilename,artifactKinds,filenameMatchesKind,validateNewUserSaarFilename} from '../app/filename-utils.ts';

const cases:[kind:string,aliases:string[]][]= [
 ['SAAR',['GEN SAAR','PRIV dev SAAR','GEN DD Form 2875','PRIV admin DD2875','Form 2875','Access Request','GEN System Access Request','PRIV cyber System Authorization Access Request']],
 ['DoD Cyber Cert',['DoD Cyber Cert','DoD Cyber Certificate','DoW Cyber','DoW Cyber Cert','DoW Cyber Awareness','Cyber Cert','Cyber Certificate','Cyber Awareness','Cyber Awareness Challenge Certificate','Awareness Challenge Certification','Information Assurance Annual Awareness']],
 ['User Agreement',['User Agreement','User Agreements','General Agreement','GEN User Agreement','GEN and PRIV Agreement','DTA Agreement','Acceptable Use Policy']],
 ['8140 Cert Memo',['8140','8140 Cert','8140 Certification','8140 Memo','8140 Letter','Cert Memo','Certification Memo','Cert Letter','Certification Letter','8140 Certification Memorandum','DoD 8140 Qualification Memo','Cyber Workforce 8140 Certification','8570 Qualification']],
 ['Privileged User Training Cert',['PRIV Training','Privileged User Training','Privileged Access Training','Privileged User Cybersecurity Responsibilities','Responsibilities','Course Completion']],
 ['DTA Training',['DTA Training','DTA User Training Cert','DTA Course','DTA Responsibilities','Data Transfer Agent Training','Data Transfer Agent Course']],
];
const separators=['_',' ',' - ','.',', '];

test('maps broad filename spelling and separator variants to one canonical artifact type',()=>{
 let checked=0;
 for(const[kind,aliases]of cases)for(const alias of aliases)for(const separator of separators){
  const rendered=alias.split(' ').join(separator),filename=`Brown${separator}Jacob${separator}(LM)${separator}${checked%2?rendered.toLowerCase():rendered.toUpperCase()}${separator}26AUG2026.pdf${checked%3===0?'.zip':''}`;
  assert.equal(artifactKindFromFilename(filename),kind,filename);
  const matches=artifactKinds.filter(candidate=>filenameMatchesKind(filename,candidate));
  assert.deepEqual(matches,[kind],filename);
  checked++;
 }
 assert.ok(checked>=180,`Expected at least 180 classifier cases, received ${checked}.`);
});

test('uses specific document markers before overlapping legacy aliases',()=>{
 const cases:[string,string][]=[
  ['Brown_Jacob_(LM)_PRIV_CYBER_SAAR_26AUG2026.pdf','SAAR'],
  ['Brown_Jacob_(LM)_DTA_User_Agreement_26AUG2026.pdf','User Agreement'],
  ['Brown_Jacob_(LM)_DTA_Course_26AUG2026.pdf','DTA Training'],
  ['Brown_Jacob_(LM)_Cyber_Workforce_8140_Certification_26AUG2026.pdf','8140 Cert Memo'],
  ['Brown_Jacob_(LM)_Certification_Letter_26AUG2026.pdf','8140 Cert Memo'],
  ['Brown_Jacob_(LM)_Cyber_Cert_26AUG2026.pdf','DoD Cyber Cert'],
  ['Brown_Jacob_(LM)_DoD_Cyber_Awareness_Course_26AUG2026.pdf','DoD Cyber Cert'],
  ['Brown_Jacob_(LM)_Privileged_User_Cybersecurity_Responsibilities_26AUG2026.pdf','Privileged User Training Cert'],
 ];
 for(const[filename,kind]of cases)assert.equal(artifactKindFromFilename(filename),kind,filename);
});

test('retains GEN and PRIV account markers while recognizing paired SAAR aliases',()=>{
 const general='Brown_Jacob_(LM)_GEN_Access_Request_26AUG2026.pdf',privileged='Brown_Jacob_(LM)_PRIV_admin_Form_2875_26AUG2026.pdf';
 assert.equal(filenameMatchesKind(general,'SAAR'),true);
 assert.equal(filenameMatchesKind(privileged,'SAAR'),true);
 assert.equal(validateNewUserSaarFilename(general).valid,true);
 assert.equal(validateNewUserSaarFilename(privileged).valid,true);
});

test('maps supported keyword pairs in either order with or without separators',()=>{
 const pairs:[kind:string,left:string,right:string][]= [
  ['SAAR','ACCESS','REQUEST'],['SAAR','FORM','2875'],['SAAR','DD','2875'],
  ['DoD Cyber Cert','DOD','CYBER'],['DoD Cyber Cert','DOW','CYBER'],['DoD Cyber Cert','CYBER','AWARENESS'],['DoD Cyber Cert','AWARENESS','CHALLENGE'],['DoD Cyber Cert','CYBER','CERT'],['DoD Cyber Cert','CYBER','CERTIFICATE'],
  ['User Agreement','USER','AGREEMENT'],['User Agreement','GENERAL','AGREEMENT'],['User Agreement','PRIVILEGED','AGREEMENT'],['User Agreement','ACCEPTABLE','USE'],
  ['8140 Cert Memo','CERT','MEMO'],['8140 Cert Memo','CERTIFICATION','MEMO'],['8140 Cert Memo','CERT','LETTER'],['8140 Cert Memo','CERTIFICATION','LETTER'],
  ['Privileged User Training Cert','PRIV','TRAINING'],['Privileged User Training Cert','PRIVILEGED','COURSE'],['Privileged User Training Cert','PRIV','RESPONSIBILITIES'],['Privileged User Training Cert','PRIV','CERT'],
  ['DTA Training','DTA','TRAINING'],['DTA Training','DTA','COURSE'],['DTA Training','DTA','RESPONSIBILITIES'],['DTA Training','DTA','CERT'],
 ];
 for(const[kind,left,right]of pairs)for(const words of[[left,right],[right,left]])for(const separator of['','_',' - ']){
  const filename=`Brown_Jacob_(LM)_${words.join(separator)}_26AUG2026.pdf`;
  assert.equal(artifactKindFromFilename(filename),kind,filename);
 }
});

test('does not infer the artifact type from folders, identity, organization, or unrelated credentials',()=>{
 const unrelated=[
  'C:/DoD Cyber Cert/Brown_Jacob_(LM)_Unidentified_Form_26AUG2026.pdf',
  'C:/SAAR/Brown_Jacob_(LM)_CompTIA_Security_Plus_26AUG2026.pdf',
  'Brown_Jacob_(8140 OFFICE)_Unidentified_Form_26AUG2026.pdf',
  'User8570_Test8570_(LM)_Unidentified_Form_26AUG2026.pdf',
  'Responsibilities_Course_(LM)_Unidentified_Form_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Network_Courseware_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Access_Control_Policy_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Cybersecurity_Certification_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Cyber_26AUG2026.pdf',
  'Brown_Jacob_(LM)_DoW_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Training_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Certificate_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Access_Control_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Privileged_Network_Courseware_26AUG2026.pdf',
  'Brown_Jacob_(LM)_DTA_Uncertain_Letter_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Uncertain_Memo_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Certification_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Memo_26AUG2026.pdf',
  'Brown_Jacob_(LM)_Letter_26AUG2026.pdf',
 ];
 for(const filename of unrelated){
  assert.equal(artifactKindFromFilename(filename),undefined,filename);
  assert.deepEqual(artifactKinds.filter(kind=>filenameMatchesKind(filename,kind)),[],filename);
 }
});
