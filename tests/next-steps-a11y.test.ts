import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {userNextSteps} from '../app/application/user-next-steps.ts';
import type {Artifact,UserRecord} from '../app/domain/tracker-models.ts';

// Synthetic records only; no operational data.
const user=(id:string,last:string,artifacts:Artifact[],extra:Partial<UserRecord>={}):UserRecord=>({id,systemId:'s1',organization:'GOV',affiliatedOrganizations:[],last,first:'Test',middle:'',email:`${id}@example.test`,disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts,...extra});
const file=(last:string,kind:string,token:string,date:string):Artifact=>({kind,filename:`${last}_Test_(GOV)_${token}_${date}.pdf`});
const complete=(last:string,date:string)=>[file(last,'SAAR','GEN_SAAR',date),file(last,'DoD Cyber Cert','DoD_Cyber_Cert',date),file(last,'User Agreement','User_Agreement',date)];
const asOf=new Date('2026-11-22T18:00:00.000Z');
const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('a user with nothing on file gets one step per missing item and is pointed to the draft',()=>{
 const next=userNextSteps(user('a','Nothing',[]),asOf);
 assert.equal(next.summary,'3 items need attention.');
 assert.deepEqual(next.steps,['SAAR: missing. Ask the user to send it.','DoD Cyber Cert: missing. Ask the user to send it.','User Agreement: missing. Ask the user to send it.','Choose Prepare Outlook Draft below to email the user about these items.']);
});

test('overdue and due-soon items say how long, and a current user is told nothing is needed',()=>{
 const late=userNextSteps(user('b','Late',complete('Late','01JAN2025')),asOf);
 assert.equal(late.summary,'2 items need attention.');
 assert.ok(late.steps.some(step=>/^DoD Cyber Cert: overdue \d+ days\. Ask the user for a current copy\.$/.test(step)));
 const soon=userNextSteps(user('c','Soon',complete('Soon','01DEC2025')),asOf);
 assert.ok(soon.steps.some(step=>/^User Agreement: due in \d+ days?\. Remind the user before then\.$/.test(step)));
 const current=userNextSteps(user('d','Current',complete('Current','01OCT2026')),asOf);
 assert.equal(current.summary,'Nothing is needed now. Every required item is current.');
 assert.ok(current.steps.every(step=>step.startsWith('Next item due:')));
});

test('a missing Official Email, an exception, and a disabled user each get their own advice',()=>{
 const noEmail=userNextSteps(user('e','NoEmail',complete('NoEmail','01OCT2026'),{email:''}),asOf);
 assert.equal(noEmail.summary,'Every required item is current.');
 assert.match(noEmail.steps[0],/Add the user’s Official Email/);
 const blocked=userNextSteps(user('f','Blocked',[],{email:''}),asOf);
 assert.ok(!blocked.steps.some(step=>step.includes('Prepare Outlook Draft')),'no draft is suggested without an address to send it to');
 const excused=userNextSteps(user('g','Excused',[file('Excused','SAAR','GEN_SAAR','01OCT2026'),file('Excused','User Agreement','User_Agreement','01OCT2026')],{exceptions:[{id:'x1',artifact:'DoD Cyber Cert',reason:'Course pending',approvedBy:'Approver',createdAt:'2026-11-01T00:00:00.000Z',createdBy:'Operator',expiresOn:'2026-12-31'}]}),asOf);
 assert.ok(excused.steps.includes('DoD Cyber Cert: missing. Ask the user to send it. An exception is approved through 2026-12-31.'));
 assert.deepEqual(userNextSteps(user('h','Gone',[],{disabled:true}),asOf),{summary:'This user is disabled.',steps:['No compliance action is needed unless the user is reactivated.']});
});

test('the User Record leads with next steps, the read-only banner offers the switch, and keyboard users can skip to the directory',()=>{
 const page=read('app/page.tsx'),header=read('app/components/OperatorDashboardHeader.tsx'),modal=read('app/components/AccessibleModal.tsx');
 assert.match(page,/<UserNextStepsPanel user=\{draft\}\/><UserOrganizationContacts/);
 assert.match(header,/props\.onSwitchAccess&&<button type="button" className="secondary" disabled=\{props\.switchAccessDisabled\} onClick=\{props\.onSwitchAccess\}>Switch to Full Access<\/button>/);
 assert.match(page,/onSwitchAccess=\{\(\)=>void switchAccessMode\(\)\} switchAccessDisabled=\{syncRunning\|\|sessionState!=='active'\|\|!rootFor\(effectiveSelected\)\}/,'the banner button uses the same switch and the same limits as the existing one');
 assert.match(page,/<a className="skip-link" href="#user-directory">Skip to User Directory<\/a>/);
 assert.match(page,/<section className="directory" id="user-directory" tabIndex=\{-1\} aria-label="User Directory">/);
 assert.match(modal,/focusable\.find\(item=>!item\.classList\.contains\('close'\)\)\?\?focusable\[0\]\?\?dialog/,'a window starts on its first real control, not the close button');
 assert.match(modal,/event\.key==='Escape'&&!closeDisabled/,'Esc still closes a window');
 assert.match(modal,/queueMicrotask\(\(\)=>returnFocus\.current\?\.focus\(\)\)/,'focus still returns to where it was');
});
