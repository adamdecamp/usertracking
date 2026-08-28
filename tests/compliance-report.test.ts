import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {createComplianceSnapshotPdf,summarizeCompliance,type ComplianceReportInput} from '../app/compliance-report.ts';

const input:ComplianceReportInput={
 reportId:'RPT-TEST-001',generatedAtUtc:'2026-08-26T12:00:00.000Z',operator:'DOMAIN\\operator',applicationVersion:'1.0.0',ruleSetVersion:'2026.08.26-1',reportingDate:'2026-08-26',recordStatus:'All',selectedSystems:['System Alpha'],selectedOrganizations:['GOV'],
 users:[
  {id:'u1',systemId:'s1',systemName:'System Alpha',organization:'GOV',disabled:false,roles:['General'],privilegedTypes:[]},
  {id:'u2',systemId:'s1',systemName:'System Alpha',organization:'GOV',disabled:false,roles:['Privileged'],privilegedTypes:['DTA']},
 ],
 requirements:[
  {userId:'u1',systemId:'s1',systemName:'System Alpha',organization:'GOV',roles:['General'],privilegedTypes:[],artifact:'SAAR',status:'Current',daysOverdue:0},
  {userId:'u1',systemId:'s1',systemName:'System Alpha',organization:'GOV',roles:['General'],privilegedTypes:[],artifact:'DoD Cyber Cert',status:'Missing',daysOverdue:0},
  {userId:'u2',systemId:'s1',systemName:'System Alpha',organization:'GOV',roles:['Privileged'],privilegedTypes:['DTA'],artifact:'SAAR',status:'Current',daysOverdue:0},
  {userId:'u2',systemId:'s1',systemName:'System Alpha',organization:'GOV',roles:['Privileged'],privilegedTypes:['DTA'],artifact:'8140 Cert Memo',status:'Overdue',daysOverdue:45,exceptionThrough:'2026-09-30',exceptionApprover:'AO'},
  {userId:'u2',systemId:'s1',systemName:'System Alpha',organization:'GOV',roles:['Privileged'],privilegedTypes:['DTA'],artifact:'DTA Agreement',status:'Overdue',daysOverdue:95},
 ],
};

test('calculates counts, breakdowns, and aging',()=>{
 const summary=summarizeCompliance(input);
 assert.equal(summary.users,2);assert.equal(summary.generalUsers,1);assert.equal(summary.privilegedUsers,1);
 assert.equal(summary.current,2);assert.equal(summary.missing,1);assert.equal(summary.overdue,2);
 assert.equal(summary.exceptions,1);
 assert.equal(summary.aging['31-60 days'],1);assert.equal(summary.aging['Over 90 days'],1);
 assert.equal(summary.byPrivilegedType[0].label,'DTA');
});

test('generates a readable multi-section PDF',async()=>{
 const progress:{phase:string;processed:number;total:number}[]=[],bytes=await createComplianceSnapshotPdf(input,(phase,processed,total)=>progress.push({phase,processed,total})),document=await PDFDocument.load(bytes);
 assert.ok(bytes.length>3000);assert.ok(document.getPageCount()>=2);assert.equal(document.getTitle(),'Compliance Snapshot RPT-TEST-001');
 assert.equal(progress[0].processed,0);assert.equal(progress.at(-1)?.processed,8);assert.equal(progress.at(-1)?.phase,'PDF Ready');
});
