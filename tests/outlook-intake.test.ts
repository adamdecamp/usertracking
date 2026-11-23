import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeOutlookFolderResult,decodeOutlookIntakeResult,type OutlookIntakeResult} from '../app/infrastructure/outlook-intake-contract.ts';
import {outlookIntakeRequest,outlookIntakeSenders,outlookIntakeSummary,sentOnBehalf} from '../app/application/outlook-intake.ts';

const users=[
 {systemId:'s1',email:' Vivian.Shaw@Example.mil ',last:'Shaw',first:'Vivian'},
 {systemId:'s1',email:'vivian.shaw@example.mil',last:'Shaw',first:'Vivian'},
 {systemId:'s1',email:'supervisor@example.mil',last:'Ng',first:'Lee'},
 {systemId:'s1',email:'',last:'Blank',first:'Email'},
 {systemId:'s2',email:'other@example.mil',last:'Other',first:'System'},
];
const saved={filename:'Shaw_Vivian_(GOV)_DTA_Training_26AUG2026.pdf',sender:'vivian.shaw@example.mil',receivedUtc:'2026-11-20T15:00:00.0000000Z',organization:'GOV'};
const skipped={filename:'scan001.pdf',sender:'vivian.shaw@example.mil',receivedUtc:'2026-11-20T15:00:00.0000000Z',reason:'The filename does not follow Last_First_(ORG)_Document_DDMMMYYYY.pdf.'};
const result:OutlookIntakeResult={cancelled:false,folder:'RAPTOR Intake',scanned:7,previouslyProcessed:2,withoutPdf:1,saved:[saved],skipped:[skipped]};

test('only Official Emails of users in the selected system become approved senders',()=>{
 assert.deepEqual(outlookIntakeSenders(users,'s1'),['supervisor@example.mil','vivian.shaw@example.mil']);
 assert.deepEqual(JSON.parse(outlookIntakeRequest(users,'s1')),{senders:['supervisor@example.mil','vivian.shaw@example.mil'],days:30});
 assert.throws(()=>outlookIntakeRequest(users,'empty'),/no approved sender/);
});

test('a file named for someone other than its sender is flagged for review',()=>{
 assert.equal(sentOnBehalf(saved,users,'s1'),false);
 assert.equal(sentOnBehalf({...saved,sender:'supervisor@example.mil'},users,'s1'),true);
 assert.equal(sentOnBehalf({...saved,sender:'other@example.mil'},users,'s1'),false,'a sender outside the system is never reported as on-behalf');
});

test('the launcher response is decoded strictly',()=>{
 assert.deepEqual(decodeOutlookIntakeResult(result),result);
 assert.throws(()=>decodeOutlookIntakeResult({...result,cancelled:true}),/completed check/);
 assert.throws(()=>decodeOutlookIntakeResult({...result,saved:[{...saved,reason:'x'}]}),/no skip reason/);
 assert.throws(()=>decodeOutlookIntakeResult({...result,skipped:[{...skipped,reason:undefined}]}),/skip reason/);
 assert.throws(()=>decodeOutlookIntakeResult({...result,saved:[{...saved,organization:undefined}]}),/destination organization/);
 assert.throws(()=>decodeOutlookIntakeResult({...result,scanned:-1}),/integer/);
 assert.deepEqual(decodeOutlookFolderResult({cancelled:true}),{cancelled:true});
 assert.deepEqual(decodeOutlookFolderResult({cancelled:false,folder:'RAPTOR Intake'}),{cancelled:false,folder:'RAPTOR Intake'});
 assert.throws(()=>decodeOutlookFolderResult({cancelled:false}),/folder/);
});

test('the summary says what was copied, that Sync review comes next, and what was skipped',()=>{
 assert.equal(outlookIntakeSummary(result),'Copied 1 PDF from RAPTOR Intake into organization intake. Start Daily Sync to review it; no user record changes until you approve. Read 7 messages from the last 30 days (2 already checked); 1 attachment skipped.');
 assert.equal(outlookIntakeSummary({...result,saved:[],skipped:[],previouslyProcessed:0,scanned:1}),'No new evidence was found in RAPTOR Intake. Read 1 message from the last 30 days.');
});

test('the Outlook check lives in the operator-started Sync window and only in the portable launcher',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8'),parts=readFileSync(new URL('../app/components/TrackerViewParts.tsx',import.meta.url),'utf8');
 assert.match(page,/outlook=\{<OutlookIntakePanel systemId=\{effectiveSelected\} users=\{users\} request=\{outlookRequest\(effectiveSelected\)\}\/>\}/);
 assert.match(page,/return root&&isPortableRoot\(root\)\?/);
 assert.match(parts,/\{outlook\}<button className="primary full"/);
 const launcher=readFileSync(new URL('../portable-launcher/OutlookIntake.cs',import.meta.url),'utf8');
 for(const forbidden of ['"Delete"','"Move"','"Send"','"UnRead"','"Save"'])assert.equal(launcher.includes(`OutlookCall(item, ${forbidden}`),false,`Outlook intake must never call ${forbidden} on a message`);
});
