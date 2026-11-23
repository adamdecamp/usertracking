import assert from'node:assert/strict';
import test from'node:test';
import{recognizeEvidence,normalizedRecognitionPattern}from'../app/application/evidence-recognition-service.ts';
import{approveRecognitionAlias,editRecognitionAlias,revokeRecognitionAlias}from'../app/application/recognition-alias-service.ts';
import{buildTrackerFilename}from'../app/document-renamer-utils.ts';
import type{RecognitionAlias,UserRecord}from'../app/domain/tracker-models.ts';

const user=(id:string,last:string,first:string,organization='LM'):UserRecord=>({id,systemId:'s1',organization,affiliatedOrganizations:[],last,first,middle:'',email:`${first}.${last}@example.test`,disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[],changes:[],exceptions:[]});
const canonical=(proposal:Parameters<typeof buildTrackerFilename>[0])=>buildTrackerFilename(proposal);

test('automatically proposes a canonical filename only above the score and margin thresholds',()=>{
 const result=recognizeEvidence({filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',authoritativeOrganization:'LM',users:[user('u1','Brown','Jacob')],canonicalFilename:proposal=>canonical({kind:proposal.artifactKind??'',first:proposal.identity?.first??'',last:proposal.identity?.last??'',organization:proposal.organization??'',date:proposal.date??'',role:proposal.role??'',privilegedType:proposal.privilegedType??''})});
 assert.equal(result.automatic,true);assert.equal(result.score,0.98);assert.equal(result.proposal?.canonicalFilename,'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf');assert.deepEqual(result.vetoes,[]);
});

test('vetoes cross-organization names, ambiguous dates, conflicting PDF values, and multiple kinds',()=>{
 const users=[user('u1','Brown','Jacob','LM'),user('u2','Brown','Jacob','GOV')];
 const result=recognizeEvidence({filename:'Brown_Jacob_(LM)_User_Agreement_DoD_Cyber_Cert_03-04-2026.pdf',authoritativeOrganization:'LM',users,pdfIdentity:{last:'Smith',first:'Maria'},pdfDate:'2026-04-03',pdfArtifactKinds:['DoD Cyber Cert']});
 assert.equal(result.automatic,false);assert.match(result.vetoes.join(' '),/ambiguous numeric date/i);assert.match(result.vetoes.join(' '),/same identity exists/i);assert.match(result.vetoes.join(' '),/conflicts with PDF identity/i);assert.match(result.vetoes.join(' '),/multiple artifact types/i);
});

test('uses same-organization fuzzy candidates first and exposes the top three with reasons',()=>{
 const result=recognizeEvidence({filename:'Smith_Bob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',authoritativeOrganization:'LM',users:[user('robert','Smith','Robert','LM'),user('other','Smith','Bob','GOV')]});
 assert.equal(result.candidates[0]?.userId,'robert');assert.match(result.candidates[0]?.reasons.join(' ')??'',/nickname|First Name/i);assert.ok(result.candidates.length<=3);
});

test('approved aliases are editable, revocable, audited metadata and revocation flags affected evidence',()=>{
 const filename='Brown_Jacob_(LM)_Awareness_26AUG2026.pdf',pattern=normalizedRecognitionPattern(filename),alias:RecognitionAlias={id:'a1',systemId:'s1',normalizedPattern:pattern,organization:'LM',userId:'u1',artifactKind:'DoD Cyber Cert',operator:'DOMAIN\\operator',createdAtUtc:'2026-11-22T12:00:00.000Z',originalFilename:filename,affectedFilenames:['Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf.zip']};
 let aliases=approveRecognitionAlias([],alias);aliases=editRecognitionAlias(aliases,'a1',{organization:'LM',userId:'u1',artifactKind:'DoD Cyber Cert'});assert.equal(aliases[0].artifactKind,'DoD Cyber Cert');
 const tracked={...user('u1','Brown','Jacob'),artifacts:[{kind:'DoD Cyber Cert',filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf.zip',recognitionAliasId:'a1'}]},revoked=revokeRecognitionAlias(aliases,[tracked],'a1','DOMAIN\\reviewer','2026-11-22T13:00:00.000Z');
 assert.equal(revoked.aliases[0].revokedBy,'DOMAIN\\reviewer');assert.equal(revoked.affected,1);assert.equal(revoked.users[0].artifacts[0].recognitionReviewRequired,true);
});

test('operator alias never bypasses encrypted-PDF strict filename validation',()=>{
 const filename='Brown Jacob awareness 26AUG2026.pdf',alias:RecognitionAlias={id:'a1',systemId:'s1',normalizedPattern:normalizedRecognitionPattern(filename),organization:'LM',userId:'u1',artifactKind:'DoD Cyber Cert',operator:'operator',createdAtUtc:'2026-11-22T12:00:00.000Z',originalFilename:filename,affectedFilenames:[]};
 const result=recognizeEvidence({filename,authoritativeOrganization:'LM',users:[user('u1','Brown','Jacob')],aliases:[alias],encryptedPdf:true});
 assert.equal(result.automatic,false);assert.match(result.vetoes.join(' '),/encrypted PDF/i);
});

test('a recognition proposal cannot bypass the strict evidence storage gate',()=>{
 const result=recognizeEvidence({filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',authoritativeOrganization:'LM',users:[user('u1','Brown','Jacob')],canonicalFilename:()=> 'not-a-valid-evidence-name.pdf'});
 assert.equal(result.automatic,false);assert.match(result.vetoes.join(' '),/strict evidence storage gate/i);
});

test('duplicate content hashes under another identity always require review',()=>{
 const result=recognizeEvidence({filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',authoritativeOrganization:'LM',users:[user('u1','Brown','Jacob')],duplicateSha256Identity:'Smith, Maria',canonicalFilename:proposal=>canonical({kind:proposal.artifactKind??'',first:proposal.identity?.first??'',last:proposal.identity?.last??'',organization:proposal.organization??'',date:proposal.date??'',role:proposal.role??'',privilegedType:proposal.privilegedType??''})});
 assert.equal(result.automatic,false);assert.match(result.vetoes.join(' '),/SHA-256.*Smith, Maria/i);
});

test('old-versus-new fixture comparison reports disagreements and prioritizes automatic precision',()=>{
 const fixtures=['Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf','Brown_Jacob_(LM)_User_Agreement_03-04-2026.pdf','Van_Der_Berg_Hans_(LM)_DoD_Cyber_Cert_26AUG2026.pdf','Brown_Jacob_(LM)_User_Agreement_DoD_Cyber_Cert_26AUG2026.pdf'];
 const users=[user('u1','Brown','Jacob'),user('u2','Van Der Berg','Hans')],disagreements:string[]=[];let automatic=0,correctAutomatic=0;
 const legacyAutomatic=(filename:string)=>/^\w+[_ ]\w+.*(?:\d{2}[A-Z]{3}\d{4}|\d{1,2}[-_. ]\d{1,2}[-_. ]\d{4})/i.test(filename)&&/(?:AGREEMENT|CYBER)/i.test(filename);
 for(const filename of fixtures){const old=legacyAutomatic(filename),next=recognizeEvidence({filename,authoritativeOrganization:'LM',users,canonicalFilename:proposal=>canonical({kind:proposal.artifactKind??'',first:proposal.identity?.first??'',last:proposal.identity?.last??'',organization:proposal.organization??'',date:proposal.date??'',role:proposal.role??'',privilegedType:proposal.privilegedType??''})});if(old!==next.automatic)disagreements.push(`${filename}: ${old?'Automatic':'Review'} -> ${next.automatic?'Automatic':'Review'}`);if(next.automatic){automatic++;if(next.proposal?.canonicalFilename)correctAutomatic++}}
 const precision=automatic?correctAutomatic/automatic:1;assert.equal(precision,1,`Auto-correct precision: ${precision}; disagreements: ${disagreements.join(' | ')}`);assert.ok(disagreements.some(value=>value.includes('03-04-2026')));assert.ok(disagreements.some(value=>value.includes('User_Agreement_DoD')));
});

test('recognition remains bounded and deterministic for malformed filename input',()=>{
 const oversized=`Brown_${'X'.repeat(10000)}_(LM)_DoD_Cyber_Cert_26AUG2026.pdf`,first=recognizeEvidence({filename:oversized,authoritativeOrganization:'LM',users:[]}),second=recognizeEvidence({filename:oversized,authoritativeOrganization:'LM',users:[]});assert.deepEqual(first,second);assert.equal(first.automatic,false);assert.ok(first.normalizedPattern.length<=oversized.length);
});
