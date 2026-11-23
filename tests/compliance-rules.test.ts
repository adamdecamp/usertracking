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
 assert.equal(evidenceStatusAt('8140 Cert Memo',evidenceDate,new Date('2026-10-05T23:59:59.999Z'),'UTC'),'Current');
 // The due date itself is still Current (Due Today); Overdue starts the next calendar day.
 assert.equal(evidenceStatusAt('8140 Cert Memo',evidenceDate,new Date('2026-10-06T23:59:59.999Z'),'UTC'),'Current');
 assert.equal(evidenceDaysUntilDue('8140 Cert Memo',evidenceDate,new Date('2026-10-06T12:00:00.000Z'),'UTC'),0);
 assert.equal(evidenceStatusAt('8140 Cert Memo',evidenceDate,new Date('2026-10-07T00:00:00.001Z'),'UTC'),'Overdue');
 assert.equal(evidenceDaysOverdue('8140 Cert Memo',evidenceDate,new Date('2026-10-07T00:00:00.001Z'),'UTC'),1);
 assert.equal(evidenceDaysUntilDue('8140 Cert Memo',evidenceDate,new Date('2026-09-07T00:00:00.000Z'),'UTC'),29);
});

test('counts due dates in the system time zone rather than UTC',()=>{
 const evidenceDate=new Date('2025-11-22T00:00:00.000Z'),zone='America/Denver';
 // 5:01 PM Mountain on the day before the due date is already Nov 22 in UTC.
 const eveningBefore=new Date('2026-11-22T00:01:00.000Z');
 assert.equal(evidenceStatusAt('DoD Cyber Cert',evidenceDate,eveningBefore,zone),'Current');
 assert.equal(evidenceDaysUntilDue('DoD Cyber Cert',evidenceDate,eveningBefore,zone),1);
 assert.equal(evidenceStatusAt('DoD Cyber Cert',evidenceDate,eveningBefore,'UTC'),'Current');
 assert.equal(evidenceDaysUntilDue('DoD Cyber Cert',evidenceDate,eveningBefore,'UTC'),0);
 // Late on the due date in Mountain time is still Current there but Overdue in UTC.
 const lateOnDueDate=new Date('2026-11-23T05:30:00.000Z');
 assert.equal(evidenceStatusAt('DoD Cyber Cert',evidenceDate,lateOnDueDate,zone),'Current');
 assert.equal(evidenceStatusAt('DoD Cyber Cert',evidenceDate,lateOnDueDate,'UTC'),'Overdue');
 // One local day late is exactly one day overdue, regardless of the hour.
 assert.equal(evidenceDaysOverdue('DoD Cyber Cert',evidenceDate,new Date('2026-11-24T06:59:00.000Z'),zone),1);
 assert.equal(evidenceDaysOverdue('DoD Cyber Cert',evidenceDate,new Date('2026-11-23T07:00:00.000Z'),zone),1);
 // East of UTC the local day starts earlier.
 assert.equal(evidenceStatusAt('DoD Cyber Cert',evidenceDate,new Date('2026-11-22T15:30:00.000Z'),'Asia/Tokyo'),'Overdue');
});

test('keeps due-date day counts exact across daylight-saving changes',()=>{
 const evidenceDate=new Date('2025-03-20T00:00:00.000Z'),zone='America/New_York';
 // US clocks spring forward on 2026-03-08; the count must not drift by an hour into an extra day.
 assert.equal(evidenceDaysUntilDue('User Agreement',evidenceDate,new Date('2026-03-01T15:00:00.000Z'),zone),19);
 assert.equal(evidenceDaysUntilDue('User Agreement',evidenceDate,new Date('2026-03-09T03:30:00.000Z'),zone),12);
});

test('keeps SAARs non-expiring while annual kinds share the one-year gate',()=>{
 const evidenceDate=new Date('2020-01-01T00:00:00.000Z'),asOf=new Date('2026-10-06T00:00:00.000Z');
 assert.equal(requirementDueDate('SAAR',evidenceDate),undefined);
 assert.equal(evidenceStatusAt('SAAR',evidenceDate,asOf),'Current');
 assert.equal(evidenceDaysOverdue('SAAR',evidenceDate,asOf),0);
 assert.equal(evidenceDaysUntilDue('SAAR',evidenceDate,asOf),undefined);
 for(const kind of annualRevalidationKinds)assert.equal(evidenceStatusAt(kind,evidenceDate,asOf),'Overdue',kind);
});
