import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeDocumentText} from '../app/document-renamer-utils.ts';
import {identityFromFilename,normalizeFilenameDate,parseDate} from '../app/filename-utils.ts';

type RenamerUser={first:string;last:string;organization:string;roles:string[];privilegedTypes:string[]};

const user=(last:string,first:string,organization:string):RenamerUser=>({
 last,first,organization,roles:['General'],privilegedTypes:[],
});

test('phase 1 audit: same-name users in different organizations require review',()=>{
 const analysis=analyzeDocumentText(
  '',
  'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',
  [user('Brown','Jacob','GOV'),user('Brown','Jacob','LM')],
  'LM',
 );

 assert.equal(analysis.confidence,'Review','A same-name cross-organization match must not be auto-corrected.');
 assert.equal(analysis.organization,'LM','The authoritative folder organization must not be replaced by the first same-name user.');
});

test('phase 1 audit: ambiguous numeric dates are not auto-normalized',()=>{
 const filename='Brown_Jacob_(LM)_User_Agreement_03-04-2026.pdf';
 assert.equal(normalizeFilenameDate(filename),undefined,'03-04-2026 can mean 3 April or March 4 and requires review.');
});

test('phase 1 audit: identifier digit runs are not treated as YYMMDD dates',()=>{
 const filename='Brown_Jacob_(LM)_User_Agreement_Employee_ID_320826.pdf';
 assert.equal(parseDate(filename),undefined,'A six-digit identifier next to an ID label must not become an evidence date.');
});

test('phase 1 audit: filename and PDF date conflicts retain both values and require review',()=>{
 const analysis=analyzeDocumentText(
  'Cyber Awareness Challenge Certificate Recipient Name: Jacob Brown. Completion Date: August 27, 2026.',
  'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',
  [user('Brown','Jacob','LM')],
  'LM',
 );
 const explanation=analysis.evidence.join(' ');

 assert.equal(analysis.confidence,'Review','Conflicting filename and document dates must veto automatic correction.');
 assert.match(explanation,/26AUG2026/i,'The review explanation must retain the filename date.');
 assert.match(explanation,/(?:27AUG2026|August 27, 2026)/i,'The review explanation must retain the document date.');
});

test('phase 1 audit: filename and PDF identity conflicts retain both identities and require review',()=>{
 const analysis=analyzeDocumentText(
  'Cyber Awareness Challenge Certificate Recipient Name: Maria Smith. Completion Date: August 26, 2026.',
  'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',
  [user('Brown','Jacob','LM'),user('Smith','Maria','LM')],
  'LM',
 );
 const explanation=analysis.evidence.join(' ');

 assert.equal(analysis.confidence,'Review','Conflicting filename and document identities must veto automatic correction.');
 assert.match(explanation,/Brown.*Jacob/i,'The review explanation must retain the filename identity.');
 assert.match(explanation,/Smith.*Maria|Maria.*Smith/i,'The review explanation must retain the PDF identity.');
});

test('phase 1 audit: a one-point user-candidate lead is insufficient for automatic correction',()=>{
 const analysis=analyzeDocumentText(
  'Cyber Awareness Challenge Certificate Recipient Name: Jacob Brown. Reviewer: Brown Jack. Completion Date: August 26, 2026.',
  'scan.pdf',
  [user('Brown','Jacob','LM'),user('Brown','Jack','LM')],
  'LM',
 );

 assert.equal(analysis.confidence,'Review','Closely ranked identity candidates require a minimum score margin.');
});

test('phase 1 audit: filenames matching more than one artifact type require review',()=>{
 const analysis=analyzeDocumentText(
  '',
  'Brown_Jacob_(LM)_User_Agreement_DoD_Cyber_Cert_26AUG2026.pdf',
  [user('Brown','Jacob','LM')],
  'LM',
 );

 assert.equal(analysis.confidence,'Review','Multiple recognized artifact types must veto first-match-wins classification.');
});

test('phase 1 audit: complex identities are either parsed correctly or withheld from High confidence',()=>{
 const cases=[
  {filename:'Van_Der_Berg_Hans_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',last:'Van Der Berg',first:'Hans'},
  {filename:'De_La_Cruz_Maria_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',last:'De La Cruz',first:'Maria'},
  {filename:"O'Brien_Mary_(LM)_DoD_Cyber_Cert_26AUG2026.pdf",last:"O'Brien",first:'Mary'},
  {filename:'MacDonald_Alex_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',last:'MacDonald',first:'Alex'},
  {filename:'Smith-Jones_Ava_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',last:'Smith-Jones',first:'Ava'},
  {filename:'Brown_Jacob_Jr_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',last:'Brown',first:'Jacob'},
  {filename:'Brown_Jacob_Q_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',last:'Brown',first:'Jacob'},
 ] as const;

 for(const item of cases){
  const identity=identityFromFilename(item.filename),analysis=analyzeDocumentText('',item.filename,[],'LM');
  const correct=identity?.last===item.last&&identity.first===item.first;
  assert.ok(correct||analysis.confidence!=='High',`${item.filename} was confidently parsed as ${identity?.last}, ${identity?.first}.`);
 }
});
