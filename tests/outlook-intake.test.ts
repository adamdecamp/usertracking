import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeOutlookFolderResult,decodeOutlookHeldList,decodeOutlookIntakeCheck,decodeOutlookIntakeResult,decodeOutlookSendFrom,type OutlookHeldItem,type OutlookIntakeResult} from '../app/infrastructure/outlook-intake-contract.ts';
import {outlookFolderPrompt,outlookHeldCorrection,outlookHeldDraft,outlookHeldFilename,outlookIntakeLead,outlookIntakeLookbackChoices,outlookIntakeRequest,outlookIntakeSenders,outlookIntakeSummary,outlookIntakeWindow,sentOnBehalf} from '../app/application/outlook-intake.ts';
import {readPageSource} from './page-source.ts';

const users=[
 {systemId:'s1',email:' Vivian.Shaw@Example.mil ',last:'Shaw',first:'Vivian'},
 {systemId:'s1',email:'vivian.shaw@example.mil',last:'Shaw',first:'Vivian'},
 {systemId:'s1',email:'supervisor@example.mil',last:'Ng',first:'Lee'},
 {systemId:'s1',email:'',last:'Blank',first:'Email'},
 {systemId:'s2',email:'other@example.mil',last:'Other',first:'System'},
];
const saved={filename:'Shaw_Vivian_(GOV)_DTA_Training_26AUG2026.pdf',sender:'vivian.shaw@example.mil',receivedUtc:'2026-11-20T15:00:00.0000000Z',organization:'GOV'};
const skipped={filename:'scan001.pdf',sender:'vivian.shaw@example.mil',receivedUtc:'2026-11-20T15:00:00.0000000Z',reason:'The filename does not follow Last_First_(ORG)_Document_DDMMMYYYY.pdf.'};
const result:OutlookIntakeResult={cancelled:false,folder:'RAPTOR Intake',scanned:7,previouslyProcessed:2,withoutPdf:1,alreadyRecorded:0,duplicates:0,saved:[saved],skipped:[skipped]};

test('only Official Emails of users in the selected system become approved senders',()=>{
 assert.deepEqual(outlookIntakeSenders(users,'s1'),['supervisor@example.mil','vivian.shaw@example.mil']);
 assert.deepEqual(JSON.parse(outlookIntakeRequest(users,'s1')),{senders:['supervisor@example.mil','vivian.shaw@example.mil'],days:7});
 assert.throws(()=>outlookIntakeRequest(users,'empty'),/no approved sender/);
});

test('Check Outlook offers 1 day, 3 days, and 1 to 4 weeks, sends the choice, and reports the period it read',()=>{
 assert.deepEqual(outlookIntakeLookbackChoices.map(choice=>`${choice.label}=${choice.days}`),['1 day=1','3 days=3','1 week=7','2 weeks=14','3 weeks=21','4 weeks=28']);
 for(const choice of outlookIntakeLookbackChoices)assert.equal(JSON.parse(outlookIntakeRequest(users,'s1',choice.days)).days,choice.days);
 assert.ok(outlookIntakeLookbackChoices.every(choice=>choice.days>=1&&choice.days<=90),'every choice is within what the launcher accepts');
 assert.throws(()=>outlookIntakeRequest(users,'s1',30),/how far back/);
 assert.equal(outlookIntakeWindow(1),'the last day');
 assert.equal(outlookIntakeWindow(3),'the last 3 days');
 assert.equal(outlookIntakeWindow(7),'the last week');
 assert.equal(outlookIntakeWindow(21),'the last 3 weeks');
 assert.match(outlookIntakeSummary(result,3),/Read 7 messages from the last 3 days \(2 already checked\)/);
 assert.match(outlookIntakeLead(result,1),/Read 7 messages from the last day, 2 of them already checked\.$/);
 const panel=readFileSync(new URL('../app/components/OutlookIntakePanel.tsx',import.meta.url),'utf8');
 assert.match(panel,/outlookIntakeRequest\(users,systemId,days\)/,'the chosen period is sent to the launcher');
 assert.match(panel,/setResult\(checked\);setResultDays\(days\)/,'the result names the period that was actually read');
 assert.match(panel,/<OutlookIntakeResults result=\{result\} days=\{resultDays\}/);
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
 assert.equal(outlookIntakeSummary(result),'Copied 1 PDF from RAPTOR Intake into organization intake. Start Daily Sync to review it; no user record changes until you approve. Read 7 messages from the last week (2 already checked); 1 attachment skipped.');
 assert.equal(outlookIntakeSummary({...result,saved:[],skipped:[],previouslyProcessed:0,scanned:1}),'No new evidence was found in RAPTOR Intake. Read 1 message from the last week.');
});

const people=[
 {id:'u1',systemId:'s1',email:'vivian.shaw@example.mil',last:'Shaw',first:'Vivian',organization:'GOV',privilegedTypes:['DBA']},
 {id:'u2',systemId:'s1',email:'lee.ng@example.mil',last:'Ng',first:'Lee',organization:'Acme Corp',privilegedTypes:[]},
 {id:'u3',systemId:'s2',email:'other@example.mil',last:'Shaw',first:'Vivian',organization:'GOV',privilegedTypes:[]},
];
const organizations=['GOV','Acme Corp'];
const held=(reason:OutlookHeldItem['reason'],filename:string,extra:Partial<OutlookHeldItem>={}):OutlookHeldItem=>({id:'0123456789abcdef0123456789abcdef',reason,detail:'Needs attention.',filename,code:'',organization:'',sender:'vivian.shaw@example.mil',receivedUtc:'2026-11-20T15:00:00.0000000Z',...extra});

test('Needs Attention responses are decoded strictly',()=>{
 const list={held:[held('organization','Shaw_Vivian_(XYZ)_DTA_Training_26AUG2026.pdf',{code:'XYZ'})],organizations};
 assert.deepEqual(decodeOutlookHeldList(list),list);
 assert.throws(()=>decodeOutlookHeldList({...list,held:[{...list.held[0],reason:'other'}]}),/known Needs Attention reason/);
 assert.throws(()=>decodeOutlookHeldList({...list,held:[{...list.held[0],id:'../x'}]}),/Needs Attention id/);
 assert.equal(decodeOutlookIntakeResult({...result,skipped:[{...skipped,held:'0123456789abcdef0123456789abcdef'}]}).skipped[0].held,'0123456789abcdef0123456789abcdef');
 assert.equal(outlookIntakeSummary({...result,skipped:[{...skipped,held:'0123456789abcdef0123456789abcdef'}]}),'Copied 1 PDF from RAPTOR Intake into organization intake. Start Daily Sync to review it; no user record changes until you approve. Read 7 messages from the last week (2 already checked); 1 attachment added to Needs Attention.');
});

test('each mismatch is prefilled from the filename and sender so only the failing field needs a choice',()=>{
 const organization=held('organization','Shaw_Vivian_(XYZ)_DTA_Training_26AUG2026.pdf',{code:'XYZ'});
 assert.deepEqual(outlookHeldDraft(organization,people,'s1',organizations),{userId:'u1',organization:'GOV',kind:'DTA Training',date:'2026-08-26',role:'',privilegedType:''},'the user organization is offered when the filename code is unknown');
 assert.equal(outlookHeldCorrection(organization,{...outlookHeldDraft(organization,people,'s1',organizations),organization:'Acme Corp'},people),JSON.stringify({id:organization.id,organization:'Acme Corp'}));
 const scan=held('filename','scan001.pdf');
 const scanDraft=outlookHeldDraft(scan,people,'s1',organizations);
 assert.deepEqual(scanDraft,{userId:'u1',organization:'GOV',kind:'',date:'',role:'',privilegedType:''},'the sender identifies the user when the filename cannot');
 assert.deepEqual(outlookHeldFilename(scanDraft,people),{problem:'Choose the artifact type.'});
 assert.deepEqual(outlookHeldFilename({...scanDraft,kind:'User Agreement',date:'2099-01-01'},people),{problem:'The document date cannot be in the future.'});
 assert.deepEqual(outlookHeldFilename({...scanDraft,kind:'SAAR',date:'2026-08-26'},people),{problem:'Choose whether the SAAR is General or Privileged.'});
 assert.deepEqual(outlookHeldFilename({...scanDraft,kind:'SAAR',role:'PRIV',privilegedType:'DBA',date:'2026-08-26'},people),{filename:'Shaw_Vivian_(GOV)_PRIV_DBA_SAAR_26AUG2026.pdf'});
 assert.deepEqual(JSON.parse(outlookHeldCorrection(scan,{...scanDraft,kind:'User Agreement',date:'2026-08-26'},people)),{id:scan.id,organization:'GOV',filename:'Shaw_Vivian_(GOV)_User_Agreement_26AUG2026.pdf',forUser:'Shaw, Vivian'});
 const stranger=held('sender','Ng_Lee_(Acme_Corp)_DoD_Cyber_Cert_26AUG2026.pdf',{sender:'lee.personal@example.com',code:'Acme_Corp'});
 const strangerDraft=outlookHeldDraft(stranger,people,'s1',organizations);
 assert.equal(strangerDraft.userId,'u2','an unknown sender is matched to the user named in the filename');
 assert.deepEqual(JSON.parse(outlookHeldCorrection(stranger,strangerDraft,people)),{id:stranger.id,organization:'Acme Corp',filename:'Ng_Lee_(Acme_Corp)_DoD_Cyber_Cert_26AUG2026.pdf',forUser:'Ng, Lee'});
 const conflict=held('conflict','Shaw_Vivian_(GOV)_DTA_Training_26AUG2026.pdf',{organization:'GOV',code:'GOV'});
 assert.equal(outlookHeldCorrection(conflict,outlookHeldDraft(conflict,people,'s1',organizations),people),JSON.stringify({id:conflict.id,organization:'GOV'}));
 assert.throws(()=>outlookHeldCorrection(held('invalid','Form.docx'),scanDraft,people),/not a usable PDF/);
 assert.throws(()=>outlookHeldCorrection(scan,{...scanDraft,userId:''},people),/Choose the user/);
});

test('Needs Attention lives in the Outlook panel and the launcher validates every correction',()=>{
 const panel=readFileSync(new URL('../app/components/OutlookIntakePanel.tsx',import.meta.url),'utf8'),hold=readFileSync(new URL('../portable-launcher/OutlookIntakeHold.cs',import.meta.url),'utf8');
 assert.match(panel,/<OutlookNeedsAttention systemId=\{systemId\} users=\{users\} request=\{request\} refreshKey=\{checks\}\/>/);
 assert.match(panel,/<OutlookIntakeResults result=\{result\} days=\{resultDays\} users=\{users\} systemId=\{systemId\}\/>/);
 assert.match(readFileSync(new URL('../app/components/OutlookIntakeResults.tsx',import.meta.url),'utf8'),/row\.key!=='held'/,'held files are listed once, in Needs Attention, not again in the results table');
 assert.match(hold,/ValidOutlookIntakeFilename\(text\("filename"\), chosen\)/);
 assert.match(hold,/if \(chosen == null\) throw new InvalidDataException/);
 assert.match(hold,/lock \(RootLock\(systemId\)\)/);
 for(const forbidden of ['OutlookCall(','"Delete"','"Move"'])assert.equal(hold.includes(forbidden),false,'Needs Attention never touches the Outlook mailbox');
});

test('the Outlook check lives in the operator-started Sync window and only in the portable launcher',()=>{
 const page=readPageSource(),parts=readFileSync(new URL('../app/components/TrackerViewParts.tsx',import.meta.url),'utf8');
 assert.match(page,/outlook=\{<OutlookIntakePanel systemId=\{effectiveSelected\} users=\{users\} request=\{outlookRequest\(effectiveSelected\)\}\/>\}/);
 assert.match(page,/return root&&isPortableRoot\(root\)\?/);
 assert.match(parts,/\{outlook\}<button className="primary full"/);
 const launcher=readFileSync(new URL('../portable-launcher/OutlookIntake.cs',import.meta.url),'utf8');
 for(const forbidden of ['"Delete"','"Move"','"Send"','"UnRead"','"Save"'])assert.equal(launcher.includes(`OutlookCall(item, ${forbidden}`),false,`Outlook intake must never call ${forbidden} on a message`);
});

test('the Send From mailbox is decoded strictly and shown in the notification window',()=>{
 assert.deepEqual(decodeOutlookSendFrom({address:'compliance@example.mil'}),{address:'compliance@example.mil'});
 assert.deepEqual(decodeOutlookSendFrom({address:''}),{address:''});
 assert.throws(()=>decodeOutlookSendFrom({}),/Outlook Send From/);
 const page=readPageSource();
 assert.match(page,/<h2>\{state\} Artifact Notifications<\/h2><OutlookSendFromSetting request=\{outlookRequest\(/);
});

test('every Outlook draft applies the Send From mailbox and never falls back to a personal address',()=>{
 const program=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8'),sendFrom=readFileSync(new URL('../portable-launcher/OutlookSendFrom.cs',import.meta.url),'utf8');
 const read=program.indexOf('string sendFrom = storage.ReadOutlookSendFrom();'),lock=program.indexOf('Interlocked.CompareExchange(ref outlookDraftActive, 1, 0)');
 assert.ok(read>0&&read<lock,'the mailbox is read before the single-draft lock is taken, so a bad setting cannot leave the lock held');
 assert.match(program,/if \(outlookType == null\) \{ RefuseOutlookFallbackForSendFrom\(sendFrom\);/);
 assert.match(program,/new object\[\] \{ 0 \}\)\);string sentFrom = ApplyOutlookSendFrom\(outlook, message, sendFrom\);/);
 assert.match(program,/OutlookWhenNoDialog\(\(\) => messageType\.InvokeMember\("Display"/,'a draft waits briefly for an open Outlook dialog before failing');
 assert.match(program,/string failure = OutlookDialogOpen\(error\) \? OutlookDialogOpenMessage :/,'an open Outlook dialog is explained in plain language');
 assert.match(program,/"; from " \+ sentFrom \+ "; operator review required before sending"/);
 assert.match(sendFrom,/"SendUsingAccount"/);
 assert.match(sendFrom,/"SentOnBehalfOfName"/);
 assert.equal(sendFrom.includes('"Send"'),false,'drafts are only displayed; the operator still sends them');
});

test('PDFs already recorded in the database are reported separately and never copied',()=>{
 const duplicate={...skipped,filename:'renamed copy.pdf',reason:'Already recorded for Shaw, Vivian (DTA Training). This exact PDF is already in the database, so it was not copied.',recorded:true as const};
 const decoded=decodeOutlookIntakeResult({...result,alreadyRecorded:1,skipped:[skipped,duplicate]});
 assert.equal(decoded.alreadyRecorded,1);
 assert.equal(decoded.skipped[1].recorded,true);
 assert.equal(decodeOutlookIntakeResult({...result,alreadyRecorded:undefined}).alreadyRecorded,0,'a launcher without the duplicate check reports none');
 assert.throws(()=>decodeOutlookIntakeResult({...result,saved:[{...saved,recorded:true}]}),/already-recorded flag/);
 assert.equal(outlookIntakeSummary(decoded),'Copied 1 PDF from RAPTOR Intake into organization intake. Start Daily Sync to review it; no user record changes until you approve. Read 7 messages from the last week (2 already checked); 1 PDF already recorded and not copied; 1 attachment skipped.');
 const intake=readFileSync(new URL('../portable-launcher/OutlookIntake.cs',import.meta.url),'utf8');
 assert.ok(intake.indexOf('recorded.Value.TryGetValue')<intake.indexOf('if (!approvedSender)\r\n')||intake.indexOf('recorded.Value.TryGetValue')<intake.indexOf('if (!approvedSender)\n'),'the duplicate check runs before any hold, so a recorded copy never needs attention');
});

test('PDFs already waiting for Sync, held in Needs Attention, or copied earlier in the check are reported as duplicates',()=>{
 const duplicate={...skipped,filename:'Shaw_Vivian_(GOV)_DTA_Training_06MAY2026.pdf',reason:'Duplicate: this exact PDF is copied earlier in this check as Shaw_Vivian_(GOV)_DTA_Training_05MAY2026.pdf in GOV, so it was not copied again.',duplicate:true as const};
 const decoded=decodeOutlookIntakeResult({...result,duplicates:1,skipped:[skipped,duplicate]});
 assert.equal(decoded.duplicates,1);
 assert.equal(decoded.skipped[1].duplicate,true);
 assert.equal(decodeOutlookIntakeResult({...result,duplicates:undefined}).duplicates,0,'an older launcher reports no duplicates');
 assert.throws(()=>decodeOutlookIntakeResult({...result,saved:[{...saved,duplicate:true}]}),/duplicate flag/);
 assert.equal(outlookIntakeSummary(decoded),'Copied 1 PDF from RAPTOR Intake into organization intake. Start Daily Sync to review it; no user record changes until you approve. Read 7 messages from the last week (2 already checked); 1 duplicate PDF already waiting and not copied again; 1 attachment skipped.');
 const intake=readFileSync(new URL('../portable-launcher/OutlookIntake.cs',import.meta.url),'utf8');
 const recordedCheck=intake.indexOf('OutlookRecordedMatch(recorded.Value'),waitingCheck=intake.indexOf('waiting.Value.Hashes.TryGetValue(pdfHash'),firstHold=intake.indexOf('if (!approvedSender)\r\n')>=0?intake.indexOf('if (!approvedSender)\r\n'):intake.indexOf('if (!approvedSender)\n');
 assert.ok(recordedCheck>0&&recordedCheck<waitingCheck&&waitingCheck<firstHold,'the duplicate check runs after the recorded check and before any hold, so a duplicate never needs attention');
});

test('Check Outlook asks for a folder when none is saved or the saved one is gone',()=>{
 assert.deepEqual(decodeOutlookIntakeCheck({needsFolder:true}),{needsFolder:true});
 assert.deepEqual(decodeOutlookIntakeCheck({needsFolder:true,missing:'RAPTOR'}),{needsFolder:true,missing:'RAPTOR'});
 assert.deepEqual(decodeOutlookIntakeCheck(result),result,'a completed check decodes as before');
 assert.throws(()=>decodeOutlookIntakeCheck({needsFolder:false}),/folder must be chosen/);
 assert.match(outlookFolderPrompt(),/^Choose the Outlook folder to check in the Outlook window\./);
 assert.match(outlookFolderPrompt('RAPTOR'),/can no longer find the saved folder RAPTOR\. Choose it again in the Outlook window\./);
});
