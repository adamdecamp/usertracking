import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSystemCommitPayload,SystemCommitPayloadCache} from '../app/application/system-commit-service.ts';
import type {SystemRecord,UserRecord} from '../app/domain/tracker-models.ts';
import {applicationVersion} from '../app/version.ts';

const systems:SystemRecord[]=[
 {id:'alpha',name:'Alpha',type:'Operational',organization:'HQ',archived:false},
 {id:'bravo',name:'Bravo',type:'Support',organization:'Field',archived:false},
];
const user=(id:string,systemId:string):UserRecord=>({
 id,systemId,organization:'HQ',affiliatedOrganizations:[],last:`Last-${id}`,first:'First',middle:'',email:`${id}@example.test`,disabled:false,
 roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[],changes:[],exceptions:[],
});
const users=[user('one','alpha'),user('two','bravo'),user('three','alpha')];

test('system commit payload strictly scopes records and serialized state to one system',async()=>{
 let hashed='',csvUsers:string[]=[];
 const payload=await buildSystemCommitPayload(systems,users,'alpha',{
  hashState:async value=>{hashed=value;return'abc123'},
  buildCsv:scoped=>{csvUsers=scoped.map(item=>item.id);return'csv'},
  now:()=> '2026-10-16T12:00:00.000Z',
 });
 assert.equal(payload.target.id,'alpha');
 assert.deepEqual(payload.scopedSystems.map(item=>item.id),['alpha']);
 assert.deepEqual(payload.scopedUsers.map(item=>item.id),['one','three']);
 assert.equal(payload.database.updated,'2026-10-16T12:00:00.000Z');
 assert.equal(payload.database.version,5);
 assert.equal(payload.database.minimumApplicationVersion,applicationVersion);
 assert.equal(payload.database.lastWriterVersion,applicationVersion);
 assert.equal(payload.stateHash,'abc123');
 assert.equal(payload.csv,'csv');
 assert.deepEqual(csvUsers,['one','three']);
 assert.deepEqual(JSON.parse(hashed),{systems:[systems[0]],users:[users[0],users[2]]});
 assert.doesNotMatch(hashed,/Last-two|bravo/i);
});

test('system commit cache reuses an identical state snapshot and invalidates on any identity change',async()=>{
 const cache=new SystemCommitPayloadCache();
 let hashes=0,csvBuilds=0;
 const dependencies={
  hashState:async()=>`hash-${++hashes}`,
  buildCsv:()=>{csvBuilds++;return'csv'},
  now:()=> '2026-10-16T12:00:00.000Z',
 };
 const first=cache.get(systems,users,'alpha',dependencies);
 const repeated=cache.get(systems,users,'alpha',dependencies);
 assert.equal(first,repeated);
 await Promise.all([first,repeated]);
 assert.equal(hashes,1);
 assert.equal(csvBuilds,1);

 await cache.get([...systems],users,'alpha',dependencies);
 await cache.get(systems,[...users],'alpha',dependencies);
 await cache.get(systems,users,'bravo',dependencies);
 assert.equal(hashes,4);
 assert.equal(csvBuilds,4);

 cache.clear();
 await cache.get(systems,users,'alpha',dependencies);
 assert.equal(hashes,5);
});

test('local Session Commit preflight hashes scoped state without constructing the database or CSV payload',async()=>{
 const cache=new SystemCommitPayloadCache();
 let hashes=0,csvBuilds=0;
 const dependencies={hashState:async()=>`hash-${++hashes}`,buildCsv:()=>{csvBuilds++;return'csv'},now:()=> '2026-10-19T12:00:00.000Z'};
 const state=await cache.getState(systems,users,'alpha',dependencies);
 assert.equal(state.stateHash,'hash-1');
 assert.deepEqual(state.scopedUsers.map(item=>item.id),['one','three']);
 assert.equal(csvBuilds,0,'A no-change preflight must not build the potentially large CSV backup.');
 const payload=await cache.get(systems,users,'alpha',dependencies);
 assert.equal(payload.stateHash,state.stateHash);
 assert.equal(hashes,1,'Building a real publication must reuse the preflight state hash.');
 assert.equal(csvBuilds,1);
});

test('system commit payload fails closed for an unknown system',async()=>{
 await assert.rejects(
  buildSystemCommitPayload(systems,users,'missing',{hashState:async()=>'',buildCsv:()=>''}),
  /no longer exists/i,
 );
});
