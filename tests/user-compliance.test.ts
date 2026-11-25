import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {complianceFilterAll,complianceLabels,matchesComplianceFilter,userComplianceLabel,userIsCompliant} from '../app/application/user-compliance.ts';
import {dashboardStats} from '../app/application/dashboard-stats.ts';
import {outlookIntakeLead,outlookIntakeRows} from '../app/application/outlook-intake.ts';
import type {OutlookIntakeResult} from '../app/infrastructure/outlook-intake-contract.ts';
import type {Artifact,UserRecord} from '../app/domain/tracker-models.ts';

// Synthetic records only; no operational data.
const user=(id:string,last:string,artifacts:Artifact[],extra:Partial<UserRecord>={}):UserRecord=>({id,systemId:'s1',organization:'GOV',affiliatedOrganizations:[],last,first:'Test',middle:'',email:`${id}@example.test`,disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts,...extra});
const file=(last:string,kind:string,token:string,date:string):Artifact=>({kind,filename:`${last}_Test_(GOV)_${token}_${date}.pdf`});
const complete=(last:string,date:string)=>[file(last,'SAAR','GEN_SAAR',date),file(last,'DoD Cyber Cert','DoD_Cyber_Cert',date),file(last,'User Agreement','User_Agreement',date)];
const asOf=new Date('2026-11-22T18:00:00.000Z');

test('one compliance rule: every required item current, due soon still counts, disabled is its own label',()=>{
 const current=user('a','Current',complete('Current','01OCT2026')),soon=user('b','Soon',complete('Soon','01DEC2025')),late=user('c','Late',complete('Late','01JAN2025')),none=user('d','Nothing',[]),gone=user('e','Gone',complete('Gone','01OCT2026'),{disabled:true});
 assert.equal(userIsCompliant(current,asOf),true);
 assert.equal(userIsCompliant(soon,asOf),true);
 assert.equal(userIsCompliant(late,asOf),false);
 assert.equal(userComplianceLabel(none,asOf),complianceLabels.notCompliant);
 assert.equal(userComplianceLabel(gone,asOf),complianceLabels.disabled);
 assert.equal(matchesComplianceFilter(late,complianceFilterAll,asOf),true);
 assert.equal(matchesComplianceFilter(late,complianceLabels.notCompliant,asOf),true);
 assert.equal(matchesComplianceFilter(current,complianceLabels.notCompliant,asOf),false);
 const active=[current,soon,late,none];
 assert.equal(dashboardStats(active,asOf).compliantUsers,active.filter(item=>matchesComplianceFilter(item,complianceLabels.compliant,asOf)).length,'the directory filter and the dashboard tile agree');
});

test('the User Directory shows a Compliance column, filters by it, and the dashboard tiles open that filter',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8'),header=readFileSync(new URL('../app/components/DirectoryHeader.tsx',import.meta.url),'utf8');
 assert.match(page,/<th>Account Status<\/th><th>Compliance<\/th>/);
 assert.match(page,/<td><ComplianceBadge user=\{u\} asOf=\{directoryAsOf\}\/><\/td>/);
 assert.match(page,/\.filter\(u=>matchesComplianceFilter\(u,complianceFilter,asOf\)\)/);
 assert.match(page,/setComplianceFilter\(complianceFilterAll\);setQuery\(''\)/,'Reset Filters clears the compliance filter');
 assert.match(page,/onClick=\{\(\)=>showCompliance\(complianceLabels\.compliant\)\}><span>Compliant Users/);
 assert.match(page,/onClick=\{\(\)=>showCompliance\(complianceLabels\.notCompliant\)\}><span>Non-Compliant Users/);
 assert.match(header,/aria-label="User Compliance Filter"/);
 assert.match(header,/props\.complianceFilter!==complianceFilterAll;/,'an active compliance filter enables Reset Filters');
});

test('the snapshot names say what each one produces',()=>{
 const header=readFileSync(new URL('../app/components/DirectoryHeader.tsx',import.meta.url),'utf8'),modal=readFileSync(new URL('../app/components/OrganizationStatusModal.tsx',import.meta.url),'utf8'),page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(header,/>Organization Status File<\/button>/);
 assert.match(page,/modal==='organization-status'\?'Organization Status File'/);
 assert.match(modal,/<h2>Organization Status File<\/h2>/);
 assert.match(modal,/Open Organization Status File \(Open Organization Snapshot in older versions\)/,'the email still helps recipients on older versions');
});

test('Check Outlook results are one row per outcome, always in the same order',()=>{
 const base={filename:'x.pdf',sender:'a@example.test',receivedUtc:'2026-11-20T15:00:00Z'};
 const result:OutlookIntakeResult={cancelled:false,folder:'RAPTOR Intake',scanned:5,previouslyProcessed:2,withoutPdf:0,alreadyRecorded:1,duplicates:1,saved:[{...base,filename:'new.pdf',organization:'GOV'}],skipped:[{...base,filename:'rec.pdf',reason:'Already recorded',recorded:true},{...base,filename:'dup.pdf',reason:'Duplicate',duplicate:true},{...base,filename:'held.pdf',reason:'Unknown sender',held:'0123456789abcdef0123456789abcdef'},{...base,filename:'odd.pdf',reason:'Could not be saved'}]};
 const rows=outlookIntakeRows(result);
 assert.deepEqual(rows.map(row=>[row.key,row.files.map(item=>item.filename)]),[['copied',['new.pdf']],['recorded',['rec.pdf']],['duplicate',['dup.pdf']],['held',['held.pdf']],['skipped',['odd.pdf']]]);
 assert.equal(rows.reduce((total,row)=>total+row.files.length,0),result.saved.length+result.skipped.length,'every attachment appears in exactly one row');
 assert.equal(outlookIntakeLead(result),'Copied 1 PDF from RAPTOR Intake. Start Daily Sync to review it; no user record changes until you approve. Read 5 messages from the last 30 days, 2 of them already checked.');
 assert.equal(outlookIntakeLead({...result,saved:[],scanned:1,previouslyProcessed:0}),'No new evidence was found in RAPTOR Intake. Read 1 message from the last 30 days.');
});
