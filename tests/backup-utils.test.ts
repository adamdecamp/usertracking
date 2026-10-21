import test from 'node:test';
import assert from 'node:assert/strict';
import {backupFilename,buildBackupSnapshot,buildCompressedBackupSnapshot,checksumFilename,checksumFromText,compressedBackupFilename,sha256Hex,staleSnapshotNames,verifyBackupSnapshot,verifyStoredBackupSnapshot} from '../app/backup-utils.ts';

const database={
 version:3,
 updated:'ignored-on-build',
 systems:[{id:'system-1',name:'Test System',type:'Administrative',organization:'GOV',archived:false}],
 users:[{id:'user-1',systemId:'system-1',organization:'GOV',affiliatedOrganizations:['Agency A','Subcontractor B'],last:'Shaw',first:'Vivian',middle:'',email:'vivian@example.mil',disabled:false,roles:['Privileged'],privilegedUsernames:['vshaw_dta'],privilegedTypes:['DTA'],artifacts:[{kind:'SAAR',filename:'Shaw_Vivian_(GOV)_PRIV_DTA_SAAR_24AUG2026.pdf.zip'}],changes:[{timestamp:'2026-08-26T10:00:00.000Z',actor:'DOMAIN\\operator',action:'Add user',description:'Created',rolesBefore:[],rolesAfter:['Privileged'],files:['Shaw_Vivian_(GOV)_PRIV_DTA_SAAR_24AUG2026.pdf.zip']}]}],
};

test('creates a full-fidelity, timestamped backup and checksum',async()=>{
 const created='2026-08-26T17:18:26.123Z',snapshot=await buildBackupSnapshot(database,created);
 assert.equal(snapshot.filename,'user-tracker-2026-08-26T17-18-26-123Z.json');
 assert.equal(checksumFilename(snapshot.filename),`${snapshot.filename}.sha256`);
 assert.equal(checksumFromText(snapshot.checksumText,snapshot.filename),snapshot.integrityHash);
 const verified=await verifyBackupSnapshot(snapshot.text,snapshot.integrityHash);
 assert.deepEqual(verified.database.systems,database.systems);
 assert.deepEqual(verified.database.users,database.users);
 assert.deepEqual((verified.database.users[0] as typeof database.users[0]).changes,database.users[0].changes);
});

test('rejects a backup whose JSON was changed',async()=>{
 const snapshot=await buildBackupSnapshot(database,'2026-08-26T17:18:26.123Z'),tampered=snapshot.text.replace('Vivian','Mallory');
 await assert.rejects(()=>verifyBackupSnapshot(tampered,snapshot.integrityHash),/SHA-256 integrity check failed/);
});

test('rejects a changed database even if the outer checksum is recomputed',async()=>{
 const snapshot=await buildBackupSnapshot(database,'2026-08-26T17:18:26.123Z'),value=JSON.parse(snapshot.text);
 value.database.users[0].email='changed@example.mil';
 const tampered=JSON.stringify(value,null,2),recomputed=await sha256Hex(tampered);
 await assert.rejects(()=>verifyBackupSnapshot(tampered,recomputed),/content hash does not match/);
});

test('rejects checksum files that name a different backup',async()=>{
 const snapshot=await buildBackupSnapshot(database,'2026-08-26T17:18:26.123Z');
 assert.equal(checksumFromText(snapshot.checksumText,'different.json'),undefined);
});

test('creates and verifies a compressed backup while retaining legacy JSON compatibility',async()=>{
 const created='2026-08-26T17:18:26.123Z',snapshot=await buildCompressedBackupSnapshot(database,created);
 assert.equal(snapshot.filename,'user-tracker-2026-08-26T17-18-26-123Z.json.gz');
 assert.equal(checksumFromText(snapshot.checksumText,snapshot.filename),snapshot.integrityHash);
 assert.ok(snapshot.bytes.byteLength<new TextEncoder().encode(snapshot.text).byteLength);
 const verified=await verifyStoredBackupSnapshot(snapshot.bytes,snapshot.filename,snapshot.integrityHash);
 assert.deepEqual(verified.database.users,database.users);

 const legacy=await buildBackupSnapshot(database,created),legacyBytes=new TextEncoder().encode(legacy.text);
 assert.deepEqual((await verifyStoredBackupSnapshot(legacyBytes,legacy.filename,legacy.integrityHash)).database.users,database.users);
});

test('retains restore compatibility with version 2 database backups',async()=>{
 const legacyUsers=database.users.map(user=>{const copy:Partial<typeof user>={...user};delete copy.affiliatedOrganizations;return copy}),legacyDatabase={...database,version:2,users:legacyUsers};
 const snapshot=await buildBackupSnapshot(legacyDatabase,'2026-08-26T17:18:26.123Z');
 const verified=await verifyBackupSnapshot(snapshot.text,snapshot.integrityHash);
 assert.equal(verified.database.version,2);
 assert.equal(verified.database.users.length,1);
});

test('rejects a changed compressed backup before decompression',async()=>{
 const snapshot=await buildCompressedBackupSnapshot(database,'2026-08-26T17:18:26.123Z'),tampered=new Uint8Array(snapshot.bytes);
 tampered[Math.floor(tampered.length/2)]^=1;
 await assert.rejects(()=>verifyStoredBackupSnapshot(tampered,snapshot.filename,snapshot.integrityHash),/SHA-256 integrity check failed/);
});

test('uses the expected snapshot filename format',()=>{
 assert.equal(backupFilename('2026-01-02T03:04:05.006Z'),'user-tracker-2026-01-02T03-04-05-006Z.json');
 assert.equal(compressedBackupFilename('2026-01-02T03:04:05.006Z'),'user-tracker-2026-01-02T03-04-05-006Z.json.gz');
});

test('retains only the configured number of newest snapshots',()=>{
 const names=Array.from({length:35},(_,index)=>`user-tracker-2026-08-${String(index+1).padStart(2,'0')}T00-00-00-000Z.json`);
 assert.deepEqual(staleSnapshotNames(names,30),names.slice(0,5).reverse());
});
