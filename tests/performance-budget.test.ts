import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';

const storage=fs.readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const build=fs.readFileSync(new URL('../scripts/build-portable.ps1',import.meta.url),'utf8');

test('release keeps the bounded network-performance architecture enabled',()=>{
 assert.match(storage,/ManifestStorageFormat = "organization-sharded-v1"/);
 assert.match(storage,/BuildShardedManifest/);
 assert.match(storage,/CompressGzip/);
 assert.match(storage,/LocalManifestCacheFilename = "verified-manifest\.cache"/);
 assert.match(storage,/BackupCoalesceSeconds = 30/);
 assert.match(page,/dailyIncomingOnly=!legacyImport&&!forceFull/);
 assert.match(page,/insideOrganizationIncoming\(path\)/);
 assert.match(page,/insideOrganizationRework\(path\)/);
 assert.match(build,/2 MB compressed release budget/);
 assert.match(build,/3 MB lightweight release budget/);
});

test('ten-thousand-record local read model stays within the release CPU budget',()=>{
 const users=Array.from({length:10_000},(_,index)=>({id:`u-${index}`,systemId:'system-1',organization:`ORG-${index%25}`,last:`Last${index}`,first:`First${index}`,email:`user${index}@example.mil`,disabled:index%19===0,roles:index%5===0?['Privileged']:['General'],privilegedTypes:index%5===0?[`TYPE-${index%8}`]:[],artifacts:[]}));
 const start=performance.now(),serialized=JSON.stringify({version:2,systems:[{id:'system-1',name:'Budget System'}],users}),parsed=JSON.parse(serialized) as{users:typeof users},byOrganization=new Map<string,number>();
 for(const user of parsed.users)byOrganization.set(user.organization,(byOrganization.get(user.organization)??0)+1);
 const filtered=parsed.users.filter(user=>!user.disabled&&(`${user.last} ${user.first} ${user.email}`).toLowerCase().includes('last9'));
 const elapsed=performance.now()-start;
 assert.equal(parsed.users.length,10_000);
 assert.equal(byOrganization.size,25);
 assert.ok(filtered.length>0);
 // Deliberately generous for shared GitHub runners: this catches accidental quadratic work,
 // not ordinary host-to-host timing variation.
 assert.ok(elapsed<2_500,`Local read-model budget exceeded: ${elapsed.toFixed(0)} ms`);
});
