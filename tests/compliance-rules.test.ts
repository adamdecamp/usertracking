import test from 'node:test';
import assert from 'node:assert/strict';
import {annualRevalidationKinds,evidenceDaysOverdue,evidenceDaysUntilDue,evidenceStatusAt,isAnnualRevalidationRequirement,requirementDueDate} from '../app/compliance-rules.ts';

test('defines every annual revalidation requirement explicitly, including 8140 memos',()=>{
 assert.deepEqual(annualRevalidationKinds,[
  'DoD Cyber Cert',
  'User Agreement',
  '8140 Cert Memo',
  'Privileged User Training Cert',
  'DTA Training',
 ]);
 for(const kind of annualRevalidationKinds)assert.equal(isAnnualRevalidationRequirement(kind),true,kind);
 assert.equal(isAnnualRevalidationRequirement('SAAR'),false);
});

test('expires an 8140 certification memo one year after its evidence date',()=>{
 const evidenceDate=new Date('2025-10-06T00:00:00.000Z');
 assert.equal(requirementDueDate('8140 Cert Memo',evidenceDate)?.toISOString(),'2026-10-06T00:00:00.000Z');
 assert.equal(evidenceStatusAt('8140 Cert Memo',evidenceDate,new Date('2026-10-05T23:59:59.999Z')),'Current');
 assert.equal(evidenceStatusAt('8140 Cert Memo',evidenceDate,new Date('2026-10-06T00:00:00.001Z')),'Overdue');
 assert.equal(evidenceDaysOverdue('8140 Cert Memo',evidenceDate,new Date('2026-10-06T00:00:00.001Z')),1);
 assert.equal(evidenceDaysUntilDue('8140 Cert Memo',evidenceDate,new Date('2026-09-07T00:00:00.000Z')),29);
});

test('keeps SAARs non-expiring while annual kinds share the one-year gate',()=>{
 const evidenceDate=new Date('2020-01-01T00:00:00.000Z'),asOf=new Date('2026-10-06T00:00:00.000Z');
 assert.equal(requirementDueDate('SAAR',evidenceDate),undefined);
 assert.equal(evidenceStatusAt('SAAR',evidenceDate,asOf),'Current');
 assert.equal(evidenceDaysOverdue('SAAR',evidenceDate,asOf),0);
 assert.equal(evidenceDaysUntilDue('SAAR',evidenceDate,asOf),undefined);
 for(const kind of annualRevalidationKinds)assert.equal(evidenceStatusAt(kind,evidenceDate,asOf),'Overdue',kind);
});
