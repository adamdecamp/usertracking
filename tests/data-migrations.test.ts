import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{test}from'node:test';
import{currentManifestVersion,migrateAuditEntryPayload,migrateBackupPayload,migrateManifestPayload,migrateSyncIndexPayload}from'../app/data-migrations.ts';

const fixture=(name:string)=>JSON.parse(readFileSync(new URL(`./fixtures/migrations/${name}`,import.meta.url),'utf8')) as unknown;

test('migrates released manifest v1 to the current schema without changing identity data',()=>{
 const migrated=migrateManifestPayload(fixture('manifest-v1.json'))!;
 assert.equal(migrated.version,currentManifestVersion);
 const user=(migrated.users as Record<string,unknown>[])[0];
 assert.equal(user.last,'Sample');assert.deepEqual(user.affiliatedOrganizations,[]);assert.deepEqual(user.privilegedTypes,[]);assert.deepEqual(user.exceptions,[]);
});

test('accepts each currently released persisted format and rejects future versions',()=>{
 const v2=migrateManifestPayload(fixture('manifest-v2.json'))!;assert.equal(v2.version,currentManifestVersion);assert.deepEqual(v2.users,[]);
 const v2User=migrateManifestPayload({version:2,systems:[],users:[{id:'legacy-v2'}]})!;assert.deepEqual((v2User.users as Record<string,unknown>[])[0].affiliatedOrganizations,[]);
 assert.equal((migrateBackupPayload(fixture('backup-v1.json'))!.database as Record<string,unknown>).version,currentManifestVersion);
 assert.ok(migrateAuditEntryPayload(fixture('audit-v1.json')));
 assert.ok(migrateSyncIndexPayload(fixture('sync-index-v1.json')));
 assert.equal(migrateManifestPayload({version:999,systems:[],users:[]}),undefined);
 assert.equal(migrateBackupPayload({backupVersion:999,database:{}}),undefined);
 assert.equal(migrateAuditEntryPayload({version:999}),undefined);
 assert.equal(migrateSyncIndexPayload({version:999}),undefined);
});

test('normalizes multi-value affiliated organizations in current manifests',()=>{
 const migrated=migrateManifestPayload({version:currentManifestVersion,systems:[],users:[{id:'u1',affiliatedOrganizations:[' Agency One ','agency one','Prime Contractor','Subcontractor Blue']}]})!;
 const users=migrated.users as Array<{affiliatedOrganizations:string[]}>;
 assert.deepEqual(users[0].affiliatedOrganizations,['Agency One','Prime Contractor','Subcontractor Blue']);
});

test('normalizes privileged account types case-insensitively in current manifests',()=>{
 const migrated=migrateManifestPayload({version:currentManifestVersion,systems:[{id:'s1'}],users:[{id:'u1',privilegedTypes:['DEV','dev','_Dev','DTA']}]})!;
 const users=migrated.users as Array<{privilegedTypes:string[]}>;
 assert.deepEqual(users[0].privilegedTypes,['DEV','DTA']);
});

test('repairs historical change entries that predate the persisted array fields',()=>{
 const migrated=migrateManifestPayload({version:currentManifestVersion,systems:[],users:[{id:'u1',changes:[{timestamp:'2026-01-01T00:00:00Z',actor:'operator',action:'Legacy update',description:'Historical record'}]}]})!;
 const users=migrated.users as Array<{changes:Array<{rolesBefore:string[];rolesAfter:string[];files:string[]}>}>;
 assert.deepEqual(users[0].changes[0],{timestamp:'2026-01-01T00:00:00Z',actor:'operator',action:'Legacy update',description:'Historical record',rolesBefore:[],rolesAfter:[],files:[]});
});

test('does not use compatibility defaults to hide malformed persisted arrays',()=>{
 const malformed={version:currentManifestVersion,systems:[{id:'s1',name:'System',type:'Test',organization:'GOV',archived:false}],users:[{id:'u1',systemId:'s1',organization:'GOV',last:'Sample',first:'User',middle:'',email:'user@example.mil',disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[],changes:[{timestamp:'2026-01-01T00:00:00Z',actor:'operator',action:'Malformed',description:'Invalid array must fail closed.',rolesBefore:[],rolesAfter:[],files:null}],exceptions:[]}]};
 const migrated=migrateManifestPayload(malformed)!;
 const users=migrated.users as Array<{changes:Array<{files:unknown}>}>;
 assert.equal(users[0].changes[0].files,null);
});

test('migrates version 3 manifests to extraction-provenance schema version 4',()=>{
 const migrated=migrateManifestPayload({version:3,systems:[],users:[{id:'u1'}]})!;
 assert.equal(migrated.version,4);
 assert.deepEqual((migrated.users as Array<{extractionProvenance:unknown}>)[0].extractionProvenance,{});
});
