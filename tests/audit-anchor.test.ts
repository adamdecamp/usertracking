import test from'node:test';
import assert from'node:assert/strict';
import{createAuditAnchorReceipt,verifyAuditAnchorReceipt}from'../app/audit-anchor.ts';

test('creates a portable audit-chain anchor that detects later changes',async()=>{
 const receipt=await createAuditAnchorReceipt({generatedAtUtc:'2026-10-14T12:00:00.000Z',operator:'DOMAIN\\operator',applicationVersion:'1.3.0',ruleSetVersion:'rules',system:{id:'system-1',name:'Test System'},audit:{entries:42,files:3,firstTimestamp:'2026-10-01T00:00:00.000Z',lastTimestamp:'2026-10-14T11:59:59.000Z',headHash:'a'.repeat(64)}});
 assert.equal(await verifyAuditAnchorReceipt(receipt),true);
 assert.match(receipt.record.storageInstruction,/outside the mapped information-system folder/);
 receipt.record.audit.entries++;
 assert.equal(await verifyAuditAnchorReceipt(receipt),false);
});
