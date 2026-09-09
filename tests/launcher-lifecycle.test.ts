import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');

test('the portable page sends presence immediately and throughout an open session',()=>{
 assert.match(page,/startPortablePresenceHeartbeat\(\(\)=>launcherPost\('\/api\/presence',true\)\)/);
});

test('Sync confirms launcher activity before its first serialized storage request',()=>{
 assert.match(page,/setSyncRunning\(true\);await launcherPost\('\/api\/activity',true\);const launcherKeepAlive/);
});

test('a live heartbeat cancels only a pending browser-closed shutdown',()=>{
 const presence=launcher.slice(launcher.indexOf('private void RecordPresence()'),launcher.indexOf('private void BeginStorageRequest()'));
 assert.match(presence,/shutdownReason == "browser-closed"/);
 assert.match(presence,/shutdownRequestedUtc = null/);
 assert.doesNotMatch(presence,/operator-logoff|operator-exit|"idle"/);
});
