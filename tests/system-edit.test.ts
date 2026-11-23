import test from 'node:test';
import assert from 'node:assert/strict';
import {describeSystemEdit,needsTimeZonePrompt,systemEditIsUnchanged} from '../app/application/system-edit.ts';
import type {SystemRecord} from '../app/domain/tracker-models.ts';

const base:SystemRecord={id:'s1',name:'Atlas',type:'Administrative',organization:'GOV',archived:false};

test('describes only the system fields that changed, including the time zone',()=>{
 assert.equal(describeSystemEdit(base,{...base}),'');
 assert.equal(systemEditIsUnchanged(base,{...base}),true);
 assert.equal(describeSystemEdit(base,{...base,timeZone:'America/Denver'}),'time zone not set to America/Denver');
 assert.equal(describeSystemEdit({...base,timeZone:'America/Denver'},{...base,name:'Atlas 2',timeZone:'America/Chicago'}),'name Atlas to Atlas 2; time zone America/Denver to America/Chicago');
 assert.equal(systemEditIsUnchanged({...base,timeZone:'UTC'},{...base,timeZone:'UTC'}),true);
});

test('prompts only an active Full Access editor of a system with no time zone',()=>{
 const ready={editorReady:true,system:base,deferred:[] as string[]};
 assert.equal(needsTimeZonePrompt(ready),true);
 assert.equal(needsTimeZonePrompt({...ready,editorReady:false}),false,'Read-Only, snapshot, and unmapped sessions are never prompted');
 assert.equal(needsTimeZonePrompt({...ready,system:{...base,timeZone:'America/Denver'}}),false);
 assert.equal(needsTimeZonePrompt({...ready,system:{...base,archived:true}}),false);
 assert.equal(needsTimeZonePrompt({...ready,deferred:['s1']}),false,'Remind Me Later hides the prompt for this session');
 assert.equal(needsTimeZonePrompt({...ready,system:undefined}),false);
});
