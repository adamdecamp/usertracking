import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readOnlyRecoveryFor} from '../app/application/read-only-recovery.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../app/components/ReadOnlyRecoveryPanel.tsx',import.meta.url),'utf8');
const policy=readFileSync(new URL('../portable-launcher/LauncherPolicy.cs',import.meta.url),'utf8');

test('read-only recovery classifies failures into safe operator actions',()=>{
 assert.equal(readOnlyRecoveryFor('s','Startup verification',new Error('VPN shared folder is offline')).category,'availability');
 assert.equal(readOnlyRecoveryFor('s','Full Access',new Error('Another operator holds the exclusive editor lease')).category,'exclusive-access');
 assert.equal(readOnlyRecoveryFor('s','Startup verification',new Error('The database manifest checksum is invalid')).backupRestoreAvailable,true);
 assert.equal(readOnlyRecoveryFor('s','Startup verification',new Error('The audit hash chain is invalid')).backupRestoreAvailable,false);
 assert.equal(readOnlyRecoveryFor('s','Startup verification',new Error('The database requires a newer client version')).category,'compatibility');
 assert.equal(readOnlyRecoveryFor('s','Startup verification',new Error('The protected local workspace cannot be decrypted by this Windows account')).category,'local-workspace');
});

test('forced read-only mode presents retry, verified-backup, and continue options',()=>{
 assert.match(panel,/Protected Read-Only Recovery/);
 assert.match(panel,/Restore Verified Backup/);
 assert.match(panel,/Continue In Read-Only/);
 assert.match(panel,/never bypasses database, audit-chain, application-version, or exclusive-editor protections/);
 assert.match(page,/activateReadOnlyRecovery\(target,'Startup storage verification failed\.'/);
 assert.match(page,/activateReadOnlyRecovery\(mappedSystemId,'Mapped-folder startup storage verification failed\.'/);
 assert.match(page,/activateReadOnlyRecovery\(systemId,'System-switch startup storage verification failed\.'/);
 assert.match(page,/activateReadOnlyRecovery\(systemId,'Reconnection storage verification failed\.'/);
 assert.match(page,/activateReadOnlyRecovery\(systemId,'Switch to Full Access failed\.'/);
 assert.match(page,/readOnlyRecovery&&sessionState==='active'&&modal!=='restore'/);
});

test('backup inspection is read-only but restoration still requires Full Access and the exclusive lease',()=>{
 assert.match(policy,/action, "restore-drill"[\s\S]*?method, "POST"[\s\S]*?return true/);
 assert.match(policy,/action, "backups"[\s\S]*?StringComparison\.Ordinal/);
 assert.doesNotMatch(policy,/action, "restore"[\s\S]{0,100}return true/);
 assert.match(page,/if\(recovering\)[\s\S]*?upgradeLauncherSession\(\)[\s\S]*?acquireLease\(root,sessionId\)/);
 assert.match(page,/Verifying Restored Database And Audit Chain/);
 assert.match(page,/if\(recoveryLease\)await releaseLease/);
});
