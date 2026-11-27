import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import test from 'node:test';

// The launcher guards the data, so it should answer only what the application asks for. These tests compare the
// requests the launcher serves with the requests the client code names, in both directions.
const root=new URL('../',import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root),'utf8');
function sources(directory:string):string[]{
 return readdirSync(new URL(directory,root)).flatMap(name=>{
  const path=`${directory}${name}`;
  return statSync(new URL(path,root)).isDirectory()?sources(`${path}/`):/\.(ts|tsx)$/.test(name)?[read(path)]:[];
 });
}
const launcher=read('portable-launcher/Program.cs'),policy=read('portable-launcher/LauncherPolicy.cs');
// The page code and the portable start-up code (portable/src) are the only clients.
const client=[...sources('app/'),...sources('portable/src/')].join('\n');
const served=[...new Set([...launcher.matchAll(/action == "([a-z0-9-]+)"/g)].map(match=>match[1]))];
const named=(action:string)=>new RegExp(`['"\`/]${action}['"\`?]`).test(client);

test('every storage request the launcher serves is one the application makes',()=>{
 assert.ok(served.length>50,'the launcher routes were read');
 assert.deepEqual(served.filter(action=>!named(action)),[],'remove a launcher route that no client code requests');
 for(const retired of ['workspace','archive-locations','audit-verify']){
  assert.ok(!served.includes(retired),`${retired} is no longer served`);
  assert.doesNotMatch(policy,new RegExp(`String\\.Equals\\(action, "${retired}"`),`${retired} is not in the Read-Only allow list`);
 }
});

test('every launcher path and storage request the application makes is served',()=>{
 const paths=[...new Set([...client.matchAll(/['"`](\/api\/[a-z-]+)['"`?]/g)].map(match=>match[1]))].filter(path=>path!=='/api/storage');
 assert.ok(paths.includes('/api/session-user'),'the portable start-up code reads the verified operator');
 assert.deepEqual(paths.filter(path=>!launcher.includes(`"${path}"`)),[],'the launcher answers every path the client names');
 const requested=[...new Set([...client.matchAll(/portableRequest\([^,()]+,['`]([a-z0-9-]+)/g)].map(match=>match[1]))];
 assert.ok(requested.length>=10,`the client requests were read (${requested.length})`);
 assert.deepEqual(requested.filter(action=>!served.includes(action)),[],'the launcher serves every storage request the client makes');
});
