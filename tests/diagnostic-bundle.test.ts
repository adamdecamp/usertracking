import test from'node:test';
import assert from'node:assert/strict';
import{createDiagnosticBundle}from'../app/diagnostic-bundle.ts';

test('diagnostic bundle contains operational counts without user records, paths, or audit text',async()=>{
 const bundle=await createDiagnosticBundle({applicationVersion:'1.3.0',ruleSetVersion:'rules',session:{accessMode:'full',state:'active'},counts:{users:5,disabledUsers:1,artifacts:18,pendingSyncItems:2},storage:{health:'healthy',diagnostics:{generatedAtUtc:'2026-10-14T12:00:00.000Z',networkRoot:true,errorReportFiles:2,errorEntries:3,contexts:[{context:'Sync and Reconciliation',count:2}]}},audit:{verified:true,entries:10,files:1,headHash:'a'.repeat(64)},performance:{generatedAtUtc:'2026-10-14T12:00:00.000Z',networkRoot:true,operations:[{operation:'sync',runs:2,averageMs:100,p50Ms:90,p95Ms:110,maximumMs:110}],backupPending:false,watcherBaselined:true,watcherOverflowed:false,dirtyOrganizationCount:1,syncIndexShards:2,databaseShards:3,manifestStorageFormat:'organization-sharded-v1',localReadCacheAvailable:true,backupCompression:'GZip',auditCheckpointAvailable:true}}),text=JSON.stringify(bundle);
 assert.match(text,/Sanitized diagnostic data only/);
 assert.doesNotMatch(text,/DOMAIN\\operator|Test System|system-1|user@example|Last_First|Organizations\\|audit action text/i);
 assert.match(bundle.recordSha256,/^[a-f0-9]{64}$/);
});
