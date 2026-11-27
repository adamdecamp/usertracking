import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {organizationCsv,organizationCsvEmail,organizationStatusEmail,organizationStatusFilename,organizationStatusPayload} from '../app/application/organization-share-email.ts';
import type {SystemRecord,UserRecord} from '../app/domain/tracker-models.ts';

// Synthetic records only; no operational data.
const system:SystemRecord={id:'s1',name:'Test System',type:'Test',organization:'GOV',archived:false};
const user=(id:string,last:string,organization:string,disabled=false):UserRecord=>({id,systemId:'s1',organization,affiliatedOrganizations:[],last,first:'Test',middle:'',email:`${id}@example.test`,disabled,roles:['General'],privilegedTypes:[],privilegedUsernames:[],artifacts:[{kind:'SAAR',filename:`${last}_Test_(${organization})_GEN_SAAR_01OCT2026.pdf.zip`,path:`Organizations/${organization}/${organization} SAAR/x.pdf.zip`}],exceptions:[]} as unknown as UserRecord);
const users=[user('u1','Ames','GOV'),user('u2','Birch','GOV',true),user('u3','Cole','LM'),user('u4','Drake','GOV')];
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const asOf=new Date('2026-11-26T12:00:00.000Z');

test('each organization gets a spreadsheet of only its own active users',()=>{
 const gov=organizationCsv(system,users,['GOV'],asOf);
 assert.equal(gov.rowCount,2,'the disabled GOV user and the LM user are excluded');
 assert.equal(gov.filename,'Test System_GOV_Compliance_20261126.csv');
 assert.match(gov.csv,/"Ames"/);assert.match(gov.csv,/"Drake"/);assert.doesNotMatch(gov.csv,/"Birch"|"Cole"/);
 assert.equal(organizationCsv(system,users,['GOV','LM'],asOf).filename,'Test System_Compliance_20261126.csv','several organizations keep the combined name');
 const email=organizationCsvEmail(system,'GOV',asOf,gov.rowCount,gov.notCompliant);
 assert.equal(email.subject,'For Review — Test System — Compliance Spreadsheet — GOV');
 assert.match(email.body,/compliance spreadsheet for GOV on Test System as of 2026-11-26\. It lists 2 active users/);
 assert.match(email.body,/Disabled users and other organizations are not included\./);
});

test('the spreadsheet starts with exactly the header the launcher requires before it will attach a CSV',()=>{
 const launcher=read('../portable-launcher/Program.cs'),required=launcher.match(/attachmentText\.StartsWith\("((?:[^"\\]|\\.)*)", StringComparison\.Ordinal\)\) throw new InvalidDataException\("The organization CSV attachment/);
 assert.ok(required,'the launcher checks the CSV header');
 const prefix=required[1].replace(/\\uFEFF/g,'﻿').replace(/\\"/g,'"');
 assert.ok(organizationCsv(system,users,['GOV'],asOf).csv.startsWith(prefix),`the CSV starts with ${JSON.stringify(prefix)}`);
 assert.match(launcher,/organizationCsv = attachOrganizationSnapshot && attachmentFilename\.EndsWith\("\.csv", StringComparison\.OrdinalIgnoreCase\)/);
 assert.match(launcher,/!\(attachmentFilename\.EndsWith\("\.raptor-status\.json", StringComparison\.OrdinalIgnoreCase\) \|\| organizationCsv\)/,'only a status file or a CSV can be attached this way');
 assert.match(launcher,/else \{ Dictionary<string, object> package;[\s\S]{0,900}?"RAPTOR Organization Status"/,'a status file is still checked as a valid snapshot');
});

test('each organization gets its own Status File with its active and disabled users',()=>{
 const payload=organizationStatusPayload(system,users,'GOV',asOf);
 assert.deepEqual(payload.users.map(item=>[item.last,item.disabled]),[['Ames',false],['Birch',true],['Drake',false]]);
 assert.equal(payload.organization,'GOV');assert.equal(payload.generatedAtUtc,'2026-11-26T12:00:00.000Z');
 assert.equal(JSON.stringify(payload).includes('Organizations/'),false,'no shared-folder paths are included');
 assert.equal(organizationStatusFilename(system,'GOV',asOf),'Test System_GOV_RAPTOR_Status_20261126.raptor-status.json');
 assert.throws(()=>organizationStatusPayload(system,users,'NONE',asOf),/has User Directory records/);
 const email=organizationStatusEmail(system,'GOV',{total:3,active:2,disabled:1},payload.generatedAtUtc,false);
 assert.equal(email.subject,'For Review — Test System — User Status Snapshot — GOV');
 assert.match(email.body,/contains 3 user records \(2 active and 1 disabled\)/);
 assert.doesNotMatch(email.body,/passphrase/);
 assert.match(organizationStatusEmail(system,'GOV',{total:3,active:2,disabled:1},payload.generatedAtUtc,true).body,/passphrase-encrypted/);
});

test('Share with Organizations emails each organization the CSV or Status File as its own audited draft',()=>{
 const share=read('../app/components/ShareWithOrganizationsModal.tsx');
 assert.equal((share.match(/>Email Each Organization<\/button>/g)??[]).length,3,'PDF, CSV, and Status File each offer it');
 assert.match(share,/onClick=\{\(\)=>void emailEach\('csv'\)\}>Email Each Organization/);
 assert.match(share,/onClick=\{\(\)=>void emailEach\('status'\)\}>Email Each Organization/);
 assert.match(share,/const emailPositions=\['ISSM','ISSO'\]/);
 assert.match(share,/plan=organizationEmailPlan\(chosen,contacts,emailPositions\),emailable=plan\.filter\(item=>item\.recipients\.length\)/);
 const body=share.slice(share.indexOf('async function emailEach'),share.indexOf('const emailHint'));
 assert.ok(body.indexOf('services.audit(')<body.indexOf('services.draft('),'each draft is audited before it opens');
 assert.match(body,/throw new Error\(`The audit record for the \$\{organization\} email could not be written, so its draft was not opened\.`\)/);
 assert.match(body,/whileOutlookDraftBusy\(\(\)=>services\.draft\(system\.id,\{to:item\.recipients\.join\('; '\)/);
 assert.match(body,/attachmentFilename:attachment\.filename,attachmentText:attachment\.text/);
 assert.match(body,/createOrganizationStatusPackage\(payload\)/,'emailed status files are integrity-protected');
 assert.match(body,/Not emailed \(no ISSM\/ISSO email\)/,'organizations without an address are reported, not silently dropped');
 assert.match(body,/if\(!services\.mapped\(system\.id\)\)/);
});
