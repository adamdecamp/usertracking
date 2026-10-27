import test from 'node:test';
import assert from 'node:assert/strict';
import {lastLogonActionSummary,lastLogonFromAudit} from '../app/last-logon-utils.ts';
import type {AuditEntry} from '../app/audit-utils.ts';

function entry(sequence:number,actor:string,action:string):AuditEntry{return{version:1,sequence,timestampUtc:`2026-10-27T10:00:${String(sequence).padStart(2,'0')}.000Z`,actor,action,previousHash:'0'.repeat(64),entryHash:'1'.repeat(64)}}

test('last logon identifies the newest user and summarizes only that user actions',()=>{
 const result=lastLogonFromAudit([
  entry(1,'DOMAIN\\older','FULL ACCESS SESSION START: system opened'),
  entry(2,'DOMAIN\\older','VERIFIED SYNC: 20 files'),
  entry(3,'DOMAIN\\latest','READ-ONLY SESSION START: system opened'),
  entry(4,'DOMAIN\\older','EDIT USER RECORD: should not count'),
  entry(5,'DOMAIN\\latest','EXPORT CSV: filtered directory'),
 ]);
 assert.equal(result.available,true);assert.equal(result.actor,'DOMAIN\\latest');assert.equal(result.accessMode,'Read-Only');assert.equal(result.actionCount,1);assert.equal(result.reportActions,1);assert.equal(result.userChanges,0);assert.equal(lastLogonActionSummary(result),'1 report or communication action.');
});

test('action summary remains concise across categories and handles first use',()=>{
 const result=lastLogonFromAudit([entry(1,'DOMAIN\\operator','MAP SYSTEM FOLDER: Example'),entry(2,'DOMAIN\\operator','VERIFIED SYNC: complete'),entry(3,'DOMAIN\\operator','EDIT USER RECORD: updated email'),entry(4,'DOMAIN\\operator','ARCHIVE EVIDENCE: old file')]);
 assert.equal(lastLogonActionSummary(result),'1 sync or cleanup action, 1 user-record action and 1 evidence action.');
 assert.equal(lastLogonActionSummary(lastLogonFromAudit([])),'No prior application logon is recorded for this information system.');
});
