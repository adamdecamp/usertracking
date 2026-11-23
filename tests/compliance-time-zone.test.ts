import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDateIn,complianceTimeZoneFor,dayNumberOfCalendarDate,fallbackTimeZone,isValidTimeZone,registerSystemTimeZones,timeZoneLabel,timeZoneOptions} from '../app/compliance-time-zone.ts';
import {activeComplianceException} from '../app/workflow-utils.ts';
import type {ComplianceException} from '../app/domain/tracker-models.ts';

test('accepts IANA zones and rejects anything else',()=>{
 for(const zone of ['America/Denver','Pacific/Guam','UTC','Asia/Tokyo'])assert.equal(isValidTimeZone(zone),true,zone);
 for(const zone of ['','Mars/Olympus','America/Denver\n',42,undefined,'x'.repeat(65)])assert.equal(isValidTimeZone(zone),false,String(zone));
});

test('reads the calendar date in a given zone',()=>{
 const instant=new Date('2026-11-23T01:08:00.000Z');
 assert.equal(calendarDateIn(instant,'America/Denver'),'2026-11-22');
 assert.equal(calendarDateIn(instant,'UTC'),'2026-11-23');
 assert.equal(calendarDateIn(instant,'Asia/Tokyo'),'2026-11-23');
});

test('validates calendar dates strictly',()=>{
 assert.equal(dayNumberOfCalendarDate('1970-01-02'),1);
 assert.equal(dayNumberOfCalendarDate('2026-02-31'),undefined);
 assert.equal(dayNumberOfCalendarDate('2026-2-3'),undefined);
});

test('looks up each system zone and falls back to this computer',()=>{
 registerSystemTimeZones([{id:'east',timeZone:'America/New_York'},{id:'bad',timeZone:'Not/AZone'},{id:'unset'}]);
 assert.equal(complianceTimeZoneFor('east'),'America/New_York');
 assert.equal(complianceTimeZoneFor('bad'),fallbackTimeZone());
 assert.equal(complianceTimeZoneFor('unset'),fallbackTimeZone());
 assert.equal(complianceTimeZoneFor(undefined),fallbackTimeZone());
 registerSystemTimeZones([]);
 assert.equal(complianceTimeZoneFor('east'),fallbackTimeZone());
});

test('lists common zones first and labels them with their offset',()=>{
 const options=timeZoneOptions();
 assert.equal(options[0],'America/New_York');
 assert.equal(new Set(options).size,options.length);
 assert.ok(options.every(isValidTimeZone));
 assert.match(timeZoneLabel('America/Denver',new Date('2026-01-15T12:00:00Z')),/^America\/Denver \(GMT-7\)$/);
});

test('keeps an exception active through the end of its expiration date in the system zone',()=>{
 const exceptions:ComplianceException[]=[{id:'e1',artifact:'User Agreement',reason:'Pending signature',approvedBy:'ISSM',createdAt:'2026-11-01T00:00:00Z',createdBy:'operator',expiresOn:'2026-11-22'}];
 // 10 PM Mountain on Nov 22 is Nov 23 in UTC; the exception still applies locally.
 const lateLocal=new Date('2026-11-23T05:00:00.000Z');
 assert.equal(activeComplianceException(exceptions,'User Agreement',lateLocal,'America/Denver')?.id,'e1');
 assert.equal(activeComplianceException(exceptions,'User Agreement',lateLocal,'UTC'),undefined);
 assert.equal(activeComplianceException(exceptions,'User Agreement',new Date('2026-11-23T07:00:00.000Z'),'America/Denver'),undefined);
});
