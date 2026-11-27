import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {complianceOn,decodeComplianceLog,recordCompliance,complianceLogLimit} from '../app/domain/compliance-log.ts';
import {complianceTrend,recordComplianceHistory,trendRanges} from '../app/application/compliance-trend.ts';
import {registerSystemTimeZones} from '../app/compliance-time-zone.ts';
import type {UserRecord} from '../app/domain/tracker-models.ts';

// Synthetic records only; no operational data.
registerSystemTimeZones([{id:'s1',timeZone:'UTC'}]);
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const user=(id:string,dates:{saar?:string;cyber?:string;agreement?:string},extra:Partial<UserRecord>={}):UserRecord=>({id,systemId:'s1',organization:'GOV',affiliatedOrganizations:[],last:id,first:'Test',middle:'',email:`${id}@example.test`,disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[
 ...(dates.saar?[{kind:'SAAR',filename:`${id}_Test_(GOV)_GEN_SAAR_${dates.saar}.pdf.zip`}]:[]),
 ...(dates.cyber?[{kind:'DoD Cyber Cert',filename:`${id}_Test_(GOV)_DoD_Cyber_Cert_${dates.cyber}.pdf.zip`}]:[]),
 ...(dates.agreement?[{kind:'User Agreement',filename:`${id}_Test_(GOV)_User_Agreement_${dates.agreement}.pdf.zip`}]:[]),
],...extra});
const now=new Date('2026-11-27T12:00:00Z'),systems=new Set(['s1']);
const current={saar:'01OCT2026',cyber:'01OCT2026',agreement:'01OCT2026'};

test('a compliance history is small, ordered, and safe to read back',()=>{
 let log=recordCompliance(undefined,'2026-11-01',false);
 assert.deepEqual(log,[{on:'2026-11-01',compliant:false}]);
 assert.equal(recordCompliance(log,'2026-11-05',false),log,'repeating the current state adds nothing');
 log=recordCompliance(log,'2026-11-10',true);
 assert.deepEqual(log,[{on:'2026-11-01',compliant:false},{on:'2026-11-10',compliant:true}]);
 assert.equal(recordCompliance(log,'2026-11-09',false),log,'a clock set back never rewrites history');
 assert.deepEqual(recordCompliance(log,'2026-11-10',false),[{on:'2026-11-01',compliant:false}],'a change undone the same day leaves no entry');
 assert.equal(recordCompliance(log,'not-a-date',false),log);
 assert.equal(complianceOn(log,'2026-10-31'),undefined,'no history before the first entry');
 assert.equal(complianceOn(log,'2026-11-09'),false);assert.equal(complianceOn(log,'2026-11-10'),true);assert.equal(complianceOn(log,'2027-01-01'),true);
 assert.deepEqual(decodeComplianceLog(log),log);
 assert.equal(decodeComplianceLog([{on:'2026-11-10',compliant:true},{on:'2026-11-01',compliant:false}]),undefined,'dates must increase');
 assert.equal(decodeComplianceLog([{on:'2026-02-30',compliant:true}]),undefined,'dates must be real');
 assert.equal(decodeComplianceLog([{on:'2026-11-01',compliant:'yes'}]),undefined);
 assert.equal(decodeComplianceLog(Array.from({length:complianceLogLimit+1},(_,index)=>({on:new Date(Date.UTC(2020,0,1+index)).toISOString().slice(0,10),compliant:index%2===0}))),undefined);
});

test('recording adds an entry only when a user’s state changed, and leaves everyone else untouched',()=>{
 const users=[user('Ames',current),user('Birch',{saar:'01OCT2026'}),user('Cole',current,{disabled:true}),{...user('Drake',current),systemId:'other'}];
 const first=recordComplianceHistory(users,systems,now);
 assert.deepEqual(first.map(item=>item.complianceLog),[[{on:'2026-11-27',compliant:true}],[{on:'2026-11-27',compliant:false}],undefined,undefined],'disabled users and other systems are not recorded');
 assert.equal(recordComplianceHistory(first,systems,now),first,'nothing changed, so the same records come back');
 assert.equal(first[2],users[2]);
 // Birch's missing documents are stored a week later. (Their dates are in the past: evidence dated after the real clock never counts.)
 const later=new Date('2026-12-04T12:00:00Z'),fixed=first.map(item=>item.id==='Birch'?{...user('Birch',{saar:'01OCT2026',cyber:'20NOV2026',agreement:'20NOV2026'}),complianceLog:item.complianceLog}:item);
 const second=recordComplianceHistory(fixed,systems,later);
 assert.deepEqual(second[1].complianceLog,[{on:'2026-11-27',compliant:false},{on:'2026-12-04',compliant:true}]);
 assert.equal(second[0],fixed[0],'an unchanged user keeps the same record object');
});

test('a lapse from an expired document is dated to the day it began, even if the app was not open',()=>{
 // The cyber certificate dated 10 DEC 2025 is current through 10 DEC 2026, so the lapse began 11 DEC 2026.
 const ames={...user('Ames',{saar:'01OCT2025',cyber:'10DEC2025',agreement:'01OCT2026'}),complianceLog:[{on:'2026-11-27',compliant:true}]};
 const recorded=recordComplianceHistory([ames],systems,new Date('2026-12-20T12:00:00Z'));
 assert.deepEqual(recorded[0].complianceLog,[{on:'2026-11-27',compliant:true},{on:'2026-12-11',compliant:false}]);
});

test('the trend is weekly, ends today with the live status, and leaves out users with no history yet',()=>{
 assert.deepEqual([...trendRanges],[3,6,9,12]);
 const ames={...user('Ames',current),complianceLog:[{on:'2026-10-01',compliant:false},{on:'2026-11-10',compliant:true}]},birch={...user('Birch',{saar:'01OCT2026'}),complianceLog:[{on:'2026-11-20',compliant:false}]},cole=user('Cole',current,{disabled:true});
 const trend=complianceTrend([ames,birch,cole],3,now),at=(date:string)=>trend.points.find(point=>point.date===date)!;
 assert.equal(trend.points.at(-1)!.date,'2026-11-27');
 assert.ok(trend.points.every((point,index)=>index===0||point.day-trend.points[index-1].day===7),'one point per week');
 assert.equal(trend.points[0].day-trend.startDay<7,true);assert.equal(trend.historyStartedOn,'2026-10-01');
 assert.deepEqual([at('2026-11-27').known,at('2026-11-27').compliant,at('2026-11-27').percent],[2,1,50],'today is the live status of the active users');
 assert.deepEqual([at('2026-11-13').known,at('2026-11-13').compliant,at('2026-11-13').percent],[1,1,100],'Birch has no history yet on 13 NOV, so only Ames is counted');
 assert.deepEqual([at('2026-11-06').known,at('2026-11-06').percent],[1,0]);
 assert.equal(at('2026-09-04').percent,undefined,'before any history there is no value rather than a guess');
 assert.equal(complianceTrend([],6,now).points.at(-1)!.percent,undefined);
 assert.equal(complianceTrend([ames],12,now).points.length>complianceTrend([ames],3,now).points.length,true);
});

test('a document that had already expired counts as not compliant even where the history says otherwise',()=>{
 // History was last recorded (compliant) on 1 OCT; the cyber certificate expired after 10 NOV 2026 with nobody recording it.
 const ames={...user('Ames',{saar:'01OCT2025',cyber:'10NOV2025',agreement:'01OCT2026'}),complianceLog:[{on:'2026-10-01',compliant:true}]};
 const trend=complianceTrend([ames],3,now),at=(date:string)=>trend.points.find(point=>point.date===date)!;
 assert.equal(at('2026-11-06').percent,100);
 assert.equal(at('2026-11-13').percent,0);assert.equal(at('2026-11-27').percent,0);
});

test('the dashboard chart follows the directory filters and history is recorded only when the app may save',()=>{
 const page=read('../app/page.tsx'),chart=read('../app/components/ComplianceTrendChart.tsx');
 assert.match(page,/const trendUsers=useMemo\(\(\)=>visible\.filter\(u=>!u\.disabled\),\[visible\]\);/);
 assert.match(page,/<ComplianceTrendChart users=\{trendUsers\} filtered=\{trendUsers\.length!==stats\.activeUsers\} statusFile=\{Boolean\(snapshotView\)\}\/>/);
 assert.match(chart,/const historyNote=statusFile\?'An Organization Status File holds today(?:\\u2019|’)s status only, so this chart has no history\.':/,'a status file never claims history is being recorded');
 assert.match(page,/if\(!automaticSaveAllowed\(hydrated,sessionState,syncRunning,accessMode\)\|\|!system\|\|system\.archived\)return;queueMicrotask\(\(\)=>setUsers\(current=>\{const next=recordComplianceHistory\(current,new Set\(\[effectiveSelected\]\)\);return next===current\?current:\[\.\.\.next\]\}\)\)/);
 assert.match(chart,/role="group" aria-label="Months Shown">\{trendRanges\.map\(/);
 assert.match(chart,/aria-pressed=\{months===value\}/);
 assert.match(chart,/<details className="compliance-trend-table"><summary>Show the Numbers<\/summary><table>/,'the numbers are available as a table');
 assert.match(chart,/onKeyDown=\{step\}/,'weeks can be stepped through with the keyboard');
});

test('the database format carries the history: decoded strictly, validated by the launcher, never a merge conflict',()=>{
 const service=read('../app/application/manifest-service.ts'),validation=read('../portable-launcher/PortableManifestValidation.cs'),storage=read('../portable-launcher/PortableStorage.cs'),merge=read('../portable-launcher/PortableWorkspaceReconciliation.cs');
 assert.match(service,/const complianceLog=u\.complianceLog===undefined\?undefined:decodeComplianceLog\(u\.complianceLog\);if\(u\.complianceLog!==undefined&&!complianceLog\)return;/);
 assert.match(storage,/if \(version == 9\) \{ value\["version"\] = 10;version = 10; \}/);
 assert.match(storage,/ValidateUserComplianceLog\(user\);/);
 assert.match(validation,/internal const int ComplianceLogLimit = 500;/);assert.equal(complianceLogLimit,500);
 assert.match(validation,/DateTime\.TryParseExact\(on, "yyyy-MM-dd"[\s\S]{0,160}?String\.CompareOrdinal\(on, previous\) <= 0/);
 assert.match(merge,/baseCore = WithoutComplianceLog\(baseItem\), localCore = WithoutComplianceLog\(localItem\), sharedCore = WithoutComplianceLog\(sharedItem\)/);
 assert.match(merge,/CombinedComplianceLog\(localItem, sharedItem\)/);
});
