import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {accessModeCanWrite,automaticSaveAllowed,idleActivityTime,idleClockBusy,idleTimeoutMs,sessionIdleExpired,storageWorkInProgress} from '../app/session-utils.ts';

test('never expires the operator session while Sync is active',()=>{
 const started=Date.UTC(2026,7,27,12);
 assert.equal(sessionIdleExpired(started+idleTimeoutMs*10,started,true),false);
});

test('starts a fresh idle window when Sync finishes',()=>{
 const completed=Date.UTC(2026,7,27,16);
 assert.equal(sessionIdleExpired(completed+idleTimeoutMs-1,completed,false),false);
 assert.equal(sessionIdleExpired(completed+idleTimeoutMs,completed,false),true);
});

test('recognizes browser and launcher storage work before idle shutdown',()=>{
 assert.equal(storageWorkInProgress(1),true);
 assert.equal(storageWorkInProgress(0,{activeStorageRequests:1}),true);
 assert.equal(storageWorkInProgress(0,{activeStorageRequests:0,longOperationActive:true}),true);
 assert.equal(storageWorkInProgress(0,{activeStorageRequests:0,longOperationActive:false}),false);
});

test('supports an explicit timeout for boundary testing',()=>{
 assert.equal(sessionIdleExpired(10_000,5_001,false,5_000),false);
 assert.equal(sessionIdleExpired(10_000,5_000,false,5_000),true);
});

test('defers the automatic save until an operator-initiated Sync has finished',()=>{
 assert.equal(automaticSaveAllowed(true,'active',true),false);
 assert.equal(automaticSaveAllowed(true,'active',false),true);
 assert.equal(automaticSaveAllowed(true,'blocked',false),false);
 assert.equal(automaticSaveAllowed(true,'active',false,'read-only'),false);
});

test('only Full Access can mutate shared-system data',()=>{
 assert.equal(accessModeCanWrite('full'),true);
 assert.equal(accessModeCanWrite('read-only'),false);
 assert.equal(accessModeCanWrite('unselected'),false);
});

test('processing and in-flight storage requests count as activity, not idle time',()=>{
 assert.equal(idleClockBusy(false,true,0),true,'a running Reconciliation, Check Outlook, report, or other processing is busy');
 assert.equal(idleClockBusy(false,false,2),true,'an in-flight storage request is busy');
 assert.equal(idleClockBusy(true,false,0),true);
 assert.equal(idleClockBusy(false,false,0),false);
});

test('a long process never leaves the session idle when it finishes',()=>{
 const lastClick=Date.UTC(2026,10,25,12),processingEnded=lastClick+idleTimeoutMs*3;
 const heldAt=idleActivityTime(lastClick,true,processingEnded);
 assert.equal(heldAt,processingEnded,'while busy, the idle clock is held at the current time');
 assert.equal(sessionIdleExpired(processingEnded+1000,heldAt,false),false,'the full idle window starts when processing ends');
 assert.equal(sessionIdleExpired(processingEnded+idleTimeoutMs,heldAt,false),true);
 assert.equal(idleActivityTime(lastClick,false,processingEnded),lastClick,'without work, only operator input moves the clock');
});

test('the dashboard applies the processing rule to the idle check without changing lease renewal',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/idleBusy=idleClockBusy\(protectedWork,processingRunning\.current,activePortableStorageRequests\.size\);lastActivity\.current=idleActivityTime\(lastActivity\.current,idleBusy,Date\.now\(\)\);if\(sessionIdleExpired\(Date\.now\(\),lastActivity\.current,idleBusy,idleTimeoutMs\)\)/);
 assert.match(page,/if\(processingRunning\.current&&!running\)lastActivity\.current=Date\.now\(\);processingRunning\.current=running\},\[processing\]\)/);
 assert.match(page,/if\(!root\|\|accessMode!=='full'\|\|leaseRenewPending\.current\|\|protectedWork\)return/);
});
