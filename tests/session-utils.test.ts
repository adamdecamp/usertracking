import assert from 'node:assert/strict';
import test from 'node:test';
import {automaticSaveAllowed,idleTimeoutMs,sessionIdleExpired} from '../app/session-utils.ts';

test('never expires the operator session while Sync is active',()=>{
 const started=Date.UTC(2026,7,27,12);
 assert.equal(sessionIdleExpired(started+idleTimeoutMs*10,started,true),false);
});

test('starts a fresh idle window when Sync finishes',()=>{
 const completed=Date.UTC(2026,7,27,16);
 assert.equal(sessionIdleExpired(completed+idleTimeoutMs-1,completed,false),false);
 assert.equal(sessionIdleExpired(completed+idleTimeoutMs,completed,false),true);
});

test('supports an explicit timeout for boundary testing',()=>{
 assert.equal(sessionIdleExpired(10_000,5_001,false,5_000),false);
 assert.equal(sessionIdleExpired(10_000,5_000,false,5_000),true);
});

test('defers the automatic save until startup Sync has finished',()=>{
 assert.equal(automaticSaveAllowed(true,'active',true),false);
 assert.equal(automaticSaveAllowed(true,'active',false),true);
 assert.equal(automaticSaveAllowed(true,'blocked',false),false);
});
