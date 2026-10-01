import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {createReconciliationReportPdf,type ReconciliationReportInput} from '../app/reconciliation-report.ts';

const input:ReconciliationReportInput={reportId:'REC-TEST-001',generatedAtUtc:'2026-09-30T12:00:00.000Z',operator:'DOMAIN\\operator',applicationVersion:'1.2.68',ruleSetVersion:'2026.09.30-1',informationSystem:'System Alpha',mappedFolder:'C:\\Evidence\\System Alpha',issues:[
 {id:'1',category:'File Collision',severity:'High',summary:'A recorded filename appears in two active locations.',detail:'Review both files and retain one authoritative copy.',path:'Organizations/GOV/GOV SAAR/Example.pdf.zip',userId:'u1'},
 {id:'2',category:'Organization Conflict',severity:'Medium',summary:'Folder and record organizations differ.',detail:'The organization folder is authoritative.',path:'Organizations/LM/Example.pdf.zip'},
]};

test('generates a readable reconciliation correction report',async()=>{
 const bytes=await createReconciliationReportPdf(input),document=await PDFDocument.load(bytes);
 assert.ok(bytes.length>2500);
 assert.ok(document.getPageCount()>=1);
 assert.equal(document.getTitle(),'Reconciliation Report REC-TEST-001');
 assert.equal(document.getAuthor(),'DOMAIN\\operator');
});

test('generates a clean report when no issues were found',async()=>{
 const bytes=await createReconciliationReportPdf({...input,reportId:'REC-CLEAN-001',issues:[]}),document=await PDFDocument.load(bytes);
 assert.ok(bytes.length>2000);
 assert.equal(document.getTitle(),'Reconciliation Report REC-CLEAN-001');
});
