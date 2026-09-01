import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{test}from'node:test';
import{currentManifestVersion,migrateAuditEntryPayload,migrateBackupPayload,migrateManifestPayload,migrateSyncIndexPayload}from'../app/data-migrations.ts';

const fixture=(name:string)=>JSON.parse(readFileSync(new URL(`./fixtures/migrations/${name}`,import.meta.url),'utf8')) as unknown;

test('migrates released manifest v1 to the current schema without changing identity data',()=>{
 const migrated=migrateManifestPayload(fixture('manifest-v1.json'))!;
 assert.equal(migrated.version,currentManifestVersion);
 const user=(migrated.users as Record<string,unknown>[])[0];
 assert.equal(user.last,'Sample');assert.deepEqual(user.privilegedTypes,[]);assert.deepEqual(user.exceptions,[]);
});

test('accepts each currently released persisted format and rejects future versions',()=>{
 assert.ok(migrateManifestPayload(fixture('manifest-v2.json')));
 assert.equal((migrateBackupPayload(fixture('backup-v1.json'))!.database as Record<string,unknown>).version,currentManifestVersion);
 assert.ok(migrateAuditEntryPayload(fixture('audit-v1.json')));
 assert.ok(migrateSyncIndexPayload(fixture('sync-index-v1.json')));
 assert.equal(migrateManifestPayload({version:999,systems:[],users:[]}),undefined);
 assert.equal(migrateBackupPayload({backupVersion:999,database:{}}),undefined);
 assert.equal(migrateAuditEntryPayload({version:999}),undefined);
 assert.equal(migrateSyncIndexPayload({version:999}),undefined);
});
