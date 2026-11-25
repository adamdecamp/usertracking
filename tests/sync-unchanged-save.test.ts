import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {recordsFingerprint} from '../app/application/last-results.ts';
import type {SystemRecord,UserRecord} from '../app/domain/tracker-models.ts';

const hash=async(text:string)=>createHash('sha256').update(text).digest('hex');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const storage=readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
const status=readFileSync(new URL('../portable-launcher/PortableWorkspaceStatus.cs',import.meta.url),'utf8');

test('a Sync that finds nothing leaves the database, checksum, and backups untouched',()=>{
 assert.match(page,/const recordsChanged=await recordsFingerprint\(nextSystems,nextUsers,recognitionAliases,sourceSystem\.id,sha256Hex\)!==await recordsFingerprint\(baseSystems,baseUsers,recognitionAliases,sourceSystem\.id,sha256Hex\);if\(recordsChanged\)\{setSystems\(nextSystems\);setUsers\(nextUsers\);await writeSystemManifest\(h,sourceSystem\.id,nextSystems,nextUsers\)\}/);
 assert.match(page,/no record changes, database and backups not rewritten/,'the audit says the database was left alone');
});

test('records reloaded with a different field order fingerprint the same; a real edit does not',async()=>{
 const system={id:'sys-1',name:'Synthetic'} as unknown as SystemRecord;
 const original=[{id:'u1',systemId:'sys-1',last:'Alpha',first:'Test',artifacts:[{kind:'SAAR',filename:'a.pdf'}]}] as unknown as UserRecord[];
 const reloaded=[{artifacts:[{filename:'a.pdf',kind:'SAAR'}],first:'Test',last:'Alpha',systemId:'sys-1',id:'u1'}] as unknown as UserRecord[];
 const edited=[{...original[0],last:'Beta'}] as unknown as UserRecord[];
 const base=await recordsFingerprint([system],original,[],'sys-1',hash);
 assert.equal(await recordsFingerprint([system],reloaded,[],'sys-1',hash),base);
 assert.notEqual(await recordsFingerprint([system],edited,[],'sys-1',hash),base);
});

test('the launcher treats a field-order-only difference as no change when saving locally',()=>{
 assert.match(storage,/bool unchanged = String\.Equals\(stateHash, existingHash, StringComparison\.OrdinalIgnoreCase\) \|\| SameDatabaseContent\(database, existingDatabase\);/);
 assert.match(status,/private bool SameDatabaseContent\(Dictionary<string, object> requested, Dictionary<string, object> existing\)/);
 assert.match(status,/new SortedDictionary<string, object>\(StringComparer\.Ordinal\)/);
});
