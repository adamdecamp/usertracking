import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncIndex,isSyncCancellation,readSyncIndex,syncIndexEntryMatches,syncIndexKey,throwIfSyncCancelled,trainingCertificateSyncPolicy,type SyncIndexEntry} from '../app/sync-utils.ts';

test('keeps automatic training-certificate recovery to one bounded first-page pass',()=>{
 assert.deepEqual(trainingCertificateSyncPolicy,{maxPages:1,timeoutMs:10000,concurrency:6,batchSize:48,deepRecovery:false});
});

test('allows an active Sync and throws a recognizable cancellation after Stop Sync',()=>{
 const controller=new AbortController();
 assert.doesNotThrow(()=>throwIfSyncCancelled(controller.signal));
 controller.abort();
 assert.throws(()=>throwIfSyncCancelled(controller.signal),error=>isSyncCancellation(error));
});

test('reuses a validated Sync entry only when its path, name, size, and modification time are unchanged',()=>{
 const cached:SyncIndexEntry={path:'User Evidence/GOV/Shaw_Vivian/file.pdf.zip',name:'file.pdf.zip',size:2048,lastModifiedUnixMs:1787770000123,accepted:true,error:''};
 assert.equal(syncIndexKey(cached.path),'user evidence/gov/shaw_vivian/file.pdf.zip');
 assert.equal(syncIndexEntryMatches(cached,{...cached}),true);
 assert.equal(syncIndexEntryMatches(cached,{...cached,size:2049}),false);
 assert.equal(syncIndexEntryMatches(cached,{...cached,lastModifiedUnixMs:cached.lastModifiedUnixMs+1}),false);
 assert.equal(syncIndexEntryMatches(cached,{...cached,path:'User Evidence/GOV/Other/file.pdf.zip'}),false);
});

test('accepts only a bounded Sync index for the active rule set',()=>{
 const entry:SyncIndexEntry={path:'User Evidence/GOV/Shaw_Vivian/file.pdf.zip',name:'file.pdf.zip',size:2048,lastModifiedUnixMs:1787770000123,accepted:true,error:''},index=createSyncIndex('rules-1',[entry],'2026-08-27T00:00:00.000Z');
 assert.deepEqual(readSyncIndex(index,'rules-1')?.files,[entry]);
 assert.equal(readSyncIndex(index,'rules-2'),undefined);
 assert.equal(readSyncIndex({...index,version:2},'rules-1'),undefined);
 assert.equal(readSyncIndex({...index,files:[{...entry,size:-1}]},'rules-1'),undefined);
});
