import test from 'node:test';
import assert from 'node:assert/strict';
import {isSyncCancellation,throwIfSyncCancelled} from '../app/sync-utils.ts';

test('allows an active Sync and throws a recognizable cancellation after Stop Sync',()=>{
 const controller=new AbortController();
 assert.doesNotThrow(()=>throwIfSyncCancelled(controller.signal));
 controller.abort();
 assert.throws(()=>throwIfSyncCancelled(controller.signal),error=>isSyncCancellation(error));
});
