import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {organizationContactEmails,organizationEmailPlan,organizationEmailRecipientLimit,organizationReportBody,organizationReportSubject,outlookDraftBusy,whileOutlookDraftBusy} from '../app/application/organization-report-email.ts';
import type {OrganizationContact} from '../app/domain/organization-contacts.ts';
import {readPageSource} from './page-source.ts';

// Synthetic contacts only; no operational data.
const contact=(id:string,organization:string,position:string,name:string,...emails:string[]):OrganizationContact=>({id,organization,position,name,methods:emails.length?emails.map(value=>({type:'Email' as const,value})):[{type:'Phone',value:'(555) 555-0100'}]});
const contacts=[
 contact('1','Alpha','ISSO','Pat Example','isso@alpha.example'),
 contact('2','alpha','ISSM','Sam Example','ISSM@alpha.example','isso@alpha.example'),
 contact('3','Alpha','Program Manager','Lee Example','pm@alpha.example'),
 contact('4','Bravo','ISSO','Phone Only'),
 contact('5','Charlie','Security Lead','Kim Example','lead@charlie.example')
];

test('contact emails match the organization and positions without regard to case, and repeat addresses are removed',()=>{
 assert.deepEqual(organizationContactEmails(contacts,'ALPHA',['isso','ISSM']),['isso@alpha.example','issm@alpha.example']);
 assert.deepEqual(organizationContactEmails(contacts,'Alpha',['Program Manager']),['pm@alpha.example']);
 assert.deepEqual(organizationContactEmails(contacts,'Bravo',['ISSO']),[],'a phone-only contact has no email');
 assert.deepEqual(organizationContactEmails(contacts,'Charlie',['Security Lead']),['lead@charlie.example'],'custom positions work');
});

test('the plan gives one draft per organization and reports organizations with nobody to email',()=>{
 const plan=organizationEmailPlan(['Alpha','Bravo','Delta'],contacts,['ISSO','ISSM']);
 assert.deepEqual(plan.map(item=>[item.organization,item.recipients.length]),[['Alpha',2],['Bravo',0],['Delta',0]]);
 assert.deepEqual(plan[0].contacts,['Pat Example (ISSO)','Sam Example (ISSM)']);
 assert.equal(plan[0].overLimit,false);
});

test('the To line is capped at the launcher limit',()=>{
 const many=Array.from({length:organizationEmailRecipientLimit+3},(_,index)=>contact(`m${index}`,'Echo','ISSO',`Person ${index}`,`person${index}@echo.example`));
 const [plan]=organizationEmailPlan(['Echo'],many,['ISSO']);
 assert.equal(plan.recipients.length,organizationEmailRecipientLimit);
 assert.equal(plan.overLimit,true);
});

test('subject and body identify the organization, report, and checksum',()=>{
 const subject=organizationReportSubject(['System One','System Two'],'Alpha');
 assert.equal(subject,'For Review — System One, System Two — Compliance Snapshot — Alpha');
 assert.ok(organizationReportSubject(['x'.repeat(300)],'Alpha').length<=200);
 const body=organizationReportBody({organization:'Alpha',systemNames:['System One'],reportingDate:'2026-11-24',userCount:1,reportId:'RPT-1',sha256:'a'.repeat(64)});
 assert.match(body,/Compliance Snapshot for Alpha as of 2026-11-24/);
 assert.match(body,/1 active user on System One/);
 assert.match(body,/Report RPT-1\nSHA-256 a{64}/);
});

test('a busy Outlook draft is retried until the earlier draft opens; other errors are not retried',async()=>{
 const sleeps:number[]=[];let calls=0;
 const result=await whileOutlookDraftBusy(async()=>{calls++;if(calls<3)throw new Error('Another Outlook draft is still being prepared. Wait for it to open before trying again.');return 'OP'},{waitMs:5,sleep:async ms=>{sleeps.push(ms)}});
 assert.equal(result,'OP');assert.equal(calls,3);assert.deepEqual(sleeps,[5,5]);
 let other=0;
 await assert.rejects(whileOutlookDraftBusy(async()=>{other++;throw new Error('The Outlook To address is invalid.')},{sleep:async()=>{}}),/To address/);
 assert.equal(other,1);
 await assert.rejects(whileOutlookDraftBusy(async()=>{throw new Error('Another Outlook draft is still being prepared.')},{attempts:2,sleep:async()=>{}}),/Another Outlook draft/);
 assert.equal(outlookDraftBusy('text'),false);
});

test('Compliance Snapshot emails each organization from its own stored, audited report',()=>{
 const page=readPageSource(),program=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8'),attachment=readFileSync(new URL('../portable-launcher/OutlookReportAttachment.cs',import.meta.url),'utf8');
 assert.match(page,/const scopes=emailing\?emailable\.map\(item=>\(\{organizations:\[item\.organization\],recipients:item\.recipients\}\)\)/);
 // The draft is queued only after the report copy is stored and both audit entries are written.
 const store=page.indexOf('const stored=await storeComplianceReport(root,filename,bytes)'),audit=page.indexOf('PREPARE ORGANIZATION COMPLIANCE EMAIL'),draft=page.indexOf('organizationServices.draft(systemId,{to:scope.recipients.join');
 assert.ok(store>0&&store<audit&&audit<draft);
 assert.match(page,/reportFilename:stored\.filename,reportSha256:stored\.sha256/);
 assert.match(program,/storage\.StageOutlookReportAttachment\(systemId, reportFilename, reportSha256\)/);
 assert.match(program,/Only one kind of attachment/);
 assert.match(attachment,/Compliance-Snapshot_\[A-Za-z0-9_-\]\{1,160\}\\\.pdf\$/);
 assert.match(attachment,/changed after it was generated/);
});
