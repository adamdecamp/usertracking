import test from 'node:test';
import assert from 'node:assert/strict';
import {auditGenesisHash,buildAuditEntry,verifyAuditText,type AuditChainState} from '../app/audit-utils.ts';

test('creates and verifies a chained audit log with ISO UTC timestamps',async()=>{
 let state:AuditChainState={entries:0,headHash:auditGenesisHash};
 const first=await buildAuditEntry(state,'DOMAIN\\operator','ADD USER','2026-08-26T12:00:00.000Z');
 state=await verifyAuditText(`${JSON.stringify(first)}\n`,state,'2026-08-26');
 const second=await buildAuditEntry(state,'DOMAIN\\operator','EXPORT CSV','2026-08-26T12:00:01.000Z');
 const verified=await verifyAuditText(`${JSON.stringify(second)}\n`,state,'2026-08-26');
 assert.equal(verified.entries,2);
 assert.equal(second.previousHash,first.entryHash);
 assert.match(first.timestampUtc,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('detects changes to an earlier audit entry',async()=>{
 const first=await buildAuditEntry({entries:0,headHash:auditGenesisHash},'DOMAIN\\operator','ADD USER','2026-08-26T12:00:00.000Z');
 const changed={...first,action:'ALTERED ACTION'};
 await assert.rejects(()=>verifyAuditText(`${JSON.stringify(changed)}\n`,undefined,'2026-08-26'),/integrity/);
});

test('rejects broken sequence, hash, day, and clock order',async()=>{
 const first=await buildAuditEntry({entries:0,headHash:auditGenesisHash},'DOMAIN\\operator','ADD USER','2026-08-26T12:00:00.000Z');
 const state=await verifyAuditText(`${JSON.stringify(first)}\n`,undefined,'2026-08-26');
 await assert.rejects(()=>buildAuditEntry(state,'DOMAIN\\operator','SECOND','2026-08-26T11:59:59.000Z'),/clock/);
 await assert.rejects(()=>verifyAuditText(`${JSON.stringify({...first,previousHash:'f'.repeat(64)})}\n`,undefined,'2026-08-26'),/hash chain/);
 await assert.rejects(()=>verifyAuditText(`${JSON.stringify(first)}\n`,undefined,'2026-08-27'),/daily file/);
});
