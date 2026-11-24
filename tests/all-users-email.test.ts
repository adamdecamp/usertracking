import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeUserEmails,activeUsersWithoutEmail,allUsersEmailBatches,allUsersEmailBody,allUsersEmailRequest,allUsersEmailSubject} from '../app/application/all-users-email.ts';

const users=[
 {systemId:'s1',email:' Vivian.Shaw@Example.mil ',disabled:false},
 {systemId:'s1',email:'vivian.shaw@example.mil',disabled:false},
 {systemId:'s1',email:'lee.ng@example.mil',disabled:false},
 {systemId:'s1',email:'gone@example.mil',disabled:true},
 {systemId:'s1',email:'',disabled:false},
 {systemId:'s1',email:'not-an-address',disabled:false},
 {systemId:'s2',email:'other@example.mil',disabled:false},
];

test('only enabled users of the chosen system with a valid Official Email are included, once each',()=>{
 assert.deepEqual(activeUserEmails(users,'s1'),['lee.ng@example.mil','vivian.shaw@example.mil']);
 assert.equal(activeUsersWithoutEmail(users,'s1'),2);
 assert.deepEqual(activeUserEmails(users,'missing'),[]);
});

test('large systems are split into BCC batches the launcher accepts',()=>{
 const many=Array.from({length:95},(_,index)=>({systemId:'s1',email:`user${String(index).padStart(3,'0')}@example.mil`,disabled:false}));
 const batches=allUsersEmailBatches(many,'s1');
 assert.ok(batches.length>=3);
 assert.ok(batches.every(batch=>batch.length>=1&&batch.length<=40));
 assert.equal(new Set(batches.flat()).size,95,'every user appears in exactly one batch');
});

test('drafts are BCC only, never addressed To anyone, and use the standard subject',()=>{
 const request=JSON.parse(allUsersEmailRequest(['a@example.mil','b@example.mil'],'Notice — ALPHA — System Maintenance — 15 DEC 2026','Body','s1'));
 assert.deepEqual(request,{bcc:'a@example.mil;b@example.mil',subject:'Notice — ALPHA — System Maintenance — 15 DEC 2026',body:'Body',auditSystemIds:['s1']});
 assert.equal('to' in request,false);
 assert.throws(()=>allUsersEmailRequest([],'S','B','s1'),/between 1 and 40/);
 assert.throws(()=>allUsersEmailRequest(Array.from({length:41},(_,index)=>`u${index}@example.mil`),'S','B','s1'),/between 1 and 40/);
 assert.equal(allUsersEmailSubject('Notice','ALPHA','System Maintenance','15 DEC 2026'),'Notice — ALPHA — System Maintenance — 15 DEC 2026');
 assert.equal(allUsersEmailSubject('Action Required','ALPHA','Annual Revalidation',''),'Action Required — ALPHA — Annual Revalidation');
 assert.ok(allUsersEmailSubject('Notice','ALPHA','x'.repeat(500),'y'.repeat(500)).length<=200,'the subject stays within the launcher limit');
 assert.equal(allUsersEmailBody('  Line one\r\nLine two  '),"Sir/Ma'am,\n\nLine one\nLine two\n\nThank you.");
 assert.equal(allUsersEmailBody(''),"Sir/Ma'am,\n\nThank you.");
});

test('the notification window offers the all-users draft and every batch is audited before it opens',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8'),panel=readFileSync(new URL('../app/components/AllUsersEmail.tsx',import.meta.url),'utf8');
 assert.match(page,/<AllUsersEmail systems=\{systems\} users=\{users\} systemId=\{sys\} request=\{outlookRequest\(sys\)\} audit=\{appendAudit\}\/>/);
 const auditAt=panel.indexOf('await audit('),draftAt=panel.indexOf("request('outlook-draft'");
 assert.ok(auditAt>0&&draftAt>auditAt,'the audit entry is written before the draft is requested');
 assert.match(panel,/mailto:\?bcc=/);
 assert.equal(/mailto:\$\{/.test(panel)||/[?&]to=/.test(panel),false,'the fallback never puts recipients in To');
});
