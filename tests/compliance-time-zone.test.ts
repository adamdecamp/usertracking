import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
test('cached date formatting gives the same calendar days as a fresh formatter, in every zone and order',()=>{
 const fresh=(at:Date,timeZone:string)=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at),part=(type:string)=>parts.find(item=>item.type===type)?.value??'';return`${part('year')}-${part('month')}-${part('day')}`};
 const zones=['America/Denver','Pacific/Guam','UTC','Asia/Tokyo','America/New_York'],moments=['2026-01-01T00:30:00Z','2026-03-08T09:59:59Z','2026-11-01T07:00:00Z','2026-12-31T23:59:59Z','2027-02-28T12:00:00Z'].map(value=>new Date(value));
 // Interleaved zones and repeated moments exercise both the per-zone formatter and the last-result reuse.
 for(let round=0;round<3;round++)for(const at of moments)for(const zone of zones){assert.equal(calendarDateIn(at,zone),fresh(at,zone),`${at.toISOString()} in ${zone}`);assert.equal(calendarDateIn(at,zone),fresh(at,zone))}
 assert.equal(calendarDateIn(moments[0],'Not/AZone'),fresh(moments[0],'UTC'),'an unknown zone still falls back to UTC');
 assert.equal(isValidTimeZone('Not/AZone'),false);assert.equal(isValidTimeZone('America/Denver'),true);
 const source=readFileSync(new URL('../app/compliance-time-zone.ts',import.meta.url),'utf8');
 assert.equal((source.match(/new Intl\.DateTimeFormat\('en-US',\{timeZone,year:'numeric'/g)??[]).length,1,'the date formatter is built in one cached place');
 const started=performance.now(),at=new Date('2026-11-27T12:00:00Z');for(let index=0;index<20000;index++)calendarDateIn(at,zones[index%zones.length]);
 assert.ok(performance.now()-started<1000,'twenty thousand status dates take well under a second');
});
