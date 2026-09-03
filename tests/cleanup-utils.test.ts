import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEvidenceCollision,collisionArchiveFilename,distinctByPath,retainUnfinishedCleanup,selectLoosePdfCleanupCandidates,selectSupersededEvidence,supersedingEvidenceApproval} from '../app/cleanup-utils.ts';

type Item={path:string;date:string;current:boolean};
const select=(items:Item[])=>selectSupersededEvidence(items,item=>new Date(item.date),item=>item.current,item=>item.path);

test('offers older and duplicate evidence only when the selected newest file is current',()=>{
 const result=select([
  {path:'older.pdf',date:'2025-08-24T00:00:00Z',current:false},
  {path:'current.pdf',date:'2026-08-24T00:00:00Z',current:true},
  {path:'duplicate-current.pdf',date:'2026-08-24T00:00:00Z',current:true},
 ]);
 assert.equal(result.current?.path,'current.pdf');
 assert.deepEqual(result.superseded.map(item=>item.path),['duplicate-current.pdf','older.pdf']);
});

test('does not offer cleanup when the newest evidence is not current',()=>{
 const result=select([
  {path:'newer-overdue.pdf',date:'2024-08-24T00:00:00Z',current:false},
  {path:'older.pdf',date:'2023-08-24T00:00:00Z',current:false},
 ]);
 assert.equal(result.current,undefined);
 assert.deepEqual(result.superseded,[]);
});

test('prefers an already normalized filename when duplicate dates are equal',()=>{
 const items=[{path:'NGC/Brown_Jacob_(TEST)_DoD_Cyber_Cert_26AUG2026.pdf',date:new Date('2026-08-26'),normalized:false},{path:'NGC/Brown_Jacob_(NGC)_DoD_Cyber_Cert_26AUG2026.pdf',date:new Date('2026-08-26'),normalized:true}];
 const result=selectSupersededEvidence(items,item=>item.date,()=>true,item=>item.path,item=>item.normalized);
 assert.equal(result.current?.path,'NGC/Brown_Jacob_(NGC)_DoD_Cyber_Cert_26AUG2026.pdf');
 assert.deepEqual(result.superseded.map(item=>item.path),['NGC/Brown_Jacob_(TEST)_DoD_Cyber_Cert_26AUG2026.pdf']);
});

test('deduplicates cleanup actions by case-insensitive Windows path',()=>{
 const result=distinctByPath([
  {path:'User Evidence/GOV/Shaw/file.pdf',kind:'first'},
  {path:'user evidence\\gov\\shaw\\FILE.PDF',kind:'duplicate'},
  {path:'User Evidence/GOV/Shaw/other.pdf',kind:'other'},
 ]);
 assert.deepEqual(result.map(item=>item.kind),['first','other']);
});

test('offers loose PDF compression only for an existing matching directory user',()=>{
 const items=[
  {path:'User Evidence/LM/Brown/Brown_Jacob_DoD.pdf',filename:'Brown_Jacob_DoD.pdf',identity:'Brown/Jacob'},
  {path:'Incoming/Unknown_User_DoD.pdf',filename:'Unknown_User_DoD.pdf',identity:'Unknown/User'},
  {path:'Incoming/Brown_Jacob_Old.pdf',filename:'Brown_Jacob_Old.pdf',identity:'Brown/Jacob'},
  {path:'Incoming/Brown_Jacob.zip',filename:'Brown_Jacob.zip',identity:'Brown/Jacob'},
 ];
 const result=selectLoosePdfCleanupCandidates(items,[{identity:'Brown/Jacob'}],(item,user)=>item.identity===user.identity,['Incoming/Brown_Jacob_Old.pdf']);
 assert.deepEqual(result.map(item=>item.filename),['Brown_Jacob_DoD.pdf']);
});

test('reuses first-scan evidence for cleanup immediately after a verified user is ingested',()=>{
 const scanned=[{path:'Incoming/Shaw_Vivian_(LM)_DoD_Cyber_Cert_24AUG2026.pdf',filename:'Shaw_Vivian_(LM)_DoD_Cyber_Cert_24AUG2026.pdf',identity:'Shaw/Vivian'}],matches=(item:{identity:string},user:{identity:string})=>item.identity===user.identity;
 assert.equal(selectLoosePdfCleanupCandidates(scanned,[],matches).length,0);
 assert.deepEqual(selectLoosePdfCleanupCandidates(scanned,[{identity:'Shaw/Vivian'}],matches).map(item=>item.path),[scanned[0].path]);
});

test('retains deferred and failed cleanup actions after successful actions are removed',()=>{
 const items=[{id:'archive-1'},{id:'zip-1'},{id:'rework-1'}];
 assert.deepEqual(retainUnfinishedCleanup(items,['zip-1']).map(item=>item.id),['archive-1','rework-1']);
});

test('classifies canonical destination collisions by validated PDF hashes',()=>{
 assert.equal(classifyEvidenceCollision('A'.repeat(64),'a'.repeat(64)),'Exact Duplicate');
 assert.equal(classifyEvidenceCollision('a'.repeat(64),'b'.repeat(64)),'Same-Name Conflict');
 assert.equal(classifyEvidenceCollision(undefined,'b'.repeat(64)),'Hash Unavailable');
 assert.equal(classifyEvidenceCollision('',''),'Hash Unavailable');
});

test('gives a non-authoritative conflicting copy a traceable archive filename',()=>{
 assert.equal(collisionArchiveFilename('Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf','abcdef123456'),'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026_CONFLICT_ABCDEF12.pdf');
 assert.equal(collisionArchiveFilename('Brown_Jacob_(LM)_SAAR_26AUG2026.pdf.zip'),'Brown_Jacob_(LM)_SAAR_26AUG2026_CONFLICT_REVIEW.pdf.zip');
 assert.ok(collisionArchiveFilename(`${'A'.repeat(180)}.pdf`,'1'.repeat(64)).length<=180);
});

test('archives an older file only after the newest replacement is stored or explicitly approved',()=>{
 assert.deepEqual(supersedingEvidenceApproval('Thomas_Greg_SAAR_01JAN2026.pdf.zip','Thomas_Greg_SAAR_01JAN2026.pdf.zip'),{});
 assert.deepEqual(supersedingEvidenceApproval('Thomas_Greg_SAAR_01JAN2024.pdf.zip','Thomas_Greg_SAAR_01JAN2026.pdf.zip','thomas:saar'),{requiresCandidateId:'thomas:saar'});
 assert.equal(supersedingEvidenceApproval('Thomas_Greg_SAAR_01JAN2024.pdf.zip','Thomas_Greg_SAAR_01JAN2026.pdf.zip'),undefined);
});
