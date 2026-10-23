import assert from 'node:assert/strict';
import test from 'node:test';
import {indexEvidenceByIdentity,matchingEvidenceForUser} from '../app/evidence-match-utils.ts';
import {filenameMatchesKind} from '../app/filename-utils.ts';

test('matches a normalized 8140 memo to the existing privileged user in its organization',()=>{
 const evidence=[
  {filename:"O'Neil_Jacob_(GDMS)_8140_Cert_Memo_23OCT2026.pdf.zip",path:'Organizations/GDMS/GDMS 8140 Certification Memo/file'},
  {filename:"O'Neil_Jacob_(LM)_8140_Cert_Memo_22OCT2026.pdf.zip",path:'Organizations/LM/LM 8140 Certification Memo/file'},
 ];
 const index=indexEvidenceByIdentity(evidence),user={last:"O'Neil",first:'Jacob',organization:' GDMS '},matches=matchingEvidenceForUser(index,user,item=>item.path.split('/')[1]??'');
 assert.equal(matches.length,1);
 assert.equal(filenameMatchesKind(matches[0]!.filename,'8140 Cert Memo'),true);
 assert.equal(matches[0]!.filename,"O'Neil_Jacob_(GDMS)_8140_Cert_Memo_23OCT2026.pdf.zip");
});

test('does not associate a correctly named memo from a different organization',()=>{
 const evidence=[{filename:'Brown_Jacob_(LM)_8140_Cert_Memo_23OCT2026.pdf',path:'Organizations/LM/LM 8140 Certification Memo/file'}],index=indexEvidenceByIdentity(evidence);
 assert.deepEqual(matchingEvidenceForUser(index,{last:'Brown',first:'Jacob',organization:'GOV'},item=>item.path.split('/')[1]??''),[]);
});
