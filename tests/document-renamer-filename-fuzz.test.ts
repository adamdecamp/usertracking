import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeDocumentText,buildTrackerFilename} from '../app/document-renamer-utils.ts';

const users=[{last:'Brown',first:'Jacob',organization:'LM',roles:['General','Privileged'],privilegedTypes:['admin']}];
const labels:[label:string,target:string][]= [
 ['Awareness','DoD_Cyber_Cert'],
 ['Cyber Awareness','DoD_Cyber_Cert'],
 ['Cyber Awareness Challenge','DoD_Cyber_Cert'],
 ['Cyber Awareness Challenge Certificate','DoD_Cyber_Cert'],
 ['DoD Cyber Awareness','DoD_Cyber_Cert'],
 ['DoD Cyber Awareness Certificate','DoD_Cyber_Cert'],
 ['Information Assurance Annual Awareness','DoD_Cyber_Cert'],
 ['Awareness Challenge Certification','DoD_Cyber_Cert'],
 ['User Agreement','User_Agreement'],
 ['General User Agreement','User_Agreement'],
 ['GEN and PRIV Agreement','User_Agreement'],
 ['DTA User Agreement','User_Agreement'],
 ['User Agreements','User_Agreement'],
 ['Acceptable Use','User_Agreement'],
 ['Acceptable Use Policy','User_Agreement'],
 ['8140','8140_Cert_Memo'],
 ['8140 Memo','8140_Cert_Memo'],
 ['8140 Certification','8140_Cert_Memo'],
 ['8140 Certification Memorandum','8140_Cert_Memo'],
 ['DoD 8140 Qualification Memo','8140_Cert_Memo'],
 ['Cyber Workforce 8140 Certification','8140_Cert_Memo'],
 ['Responsibilities','Privileged_User_Training_Cert'],
 ['Course','Privileged_User_Training_Cert'],
 ['Course Completion','Privileged_User_Training_Cert'],
 ['PRIV Training','Privileged_User_Training_Cert'],
 ['Privileged User Training','Privileged_User_Training_Cert'],
 ['Privileged Access Training','Privileged_User_Training_Cert'],
 ['Privileged User Cybersecurity Responsibilities','Privileged_User_Training_Cert'],
 ['DTA Training','DTA_Training'],
 ['DTA Course','DTA_Training'],
 ['DTA Responsibilities','DTA_Training'],
 ['Delegated Trusted Agent Training','DTA_Training'],
 ['Delegated Trusted Agent Course','DTA_Training'],
 ['GEN DD Form 2875','GEN_SAAR'],
 ['GEN System Authorization Access Request','GEN_SAAR'],
 ['GEN System Access Request','GEN_SAAR'],
 ['GEN SAAR','GEN_SAAR'],
 ['PRIV admin DD Form 2875','PRIV_admin_SAAR'],
 ['PRIV admin System Access Request','PRIV_admin_SAAR'],
 ['PRIV admin SAAR','PRIV_admin_SAAR'],
];
const identities=['Brown_Jacob','Brown, Jacob','Brown Jacob','Brown__Jacob'];
const dates=['26AUG2026','20260826','08_26_2026','AUG 26 2026','26 AUG 2026','082626'];
const separators=['_',' ',' - '];

test('fuzzes more than seventy recognizable filename variants through the complete renamer target',()=>{
 let checked=0;
 for(const[label,target]of labels)for(let variation=0;variation<2;variation++){
  const identity=identities[(checked+variation)%identities.length],date=dates[(checked+variation)%dates.length],separator=separators[(checked+variation)%separators.length],sourceLabel=variation?label.toLowerCase():label.replaceAll(' ','_'),filename=`${identity}${separator}(WRONG)${separator}${sourceLabel}${separator}${date}.pdf`,analysis=analyzeDocumentText('',filename,users,'LM'),proposed=buildTrackerFilename({...analysis,organization:'LM'}),expected=`Brown_Jacob_(LM)_${target}_26AUG2026.pdf`;
  assert.equal(analysis.confidence,'High',`${filename}: ${JSON.stringify(analysis)}`);
  assert.equal(proposed?.toUpperCase(),expected.toUpperCase(),filename);
  checked++;
 }
 assert.ok(checked>=80,`Expected at least 80 variations, checked ${checked}.`);
});

test('keyword tolerance does not relabel unrelated third-party certificates',()=>{
 const unrelated=['Brown_Jacob_(LM)_CompTIA_Security_Plus_26AUG2026.pdf','Brown_Jacob_(LM)_Network_Courseware_26AUG2026.pdf','Brown_Jacob_(LM)_Access_Control_Policy_26AUG2026.pdf'];
 for(const filename of unrelated){const analysis=analyzeDocumentText('',filename,users,'LM');assert.equal(analysis.kind,'',filename);assert.equal(buildTrackerFilename(analysis),undefined,filename)}
});
