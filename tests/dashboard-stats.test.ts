import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardStats,issueItemsLabel} from '../app/application/dashboard-stats.ts';
import type {Artifact,UserRecord} from '../app/domain/tracker-models.ts';

const user=(id:string,last:string,artifacts:Artifact[]):UserRecord=>({id,systemId:'s1',organization:'GOV',affiliatedOrganizations:[],last,first:'Test',middle:'',email:`${id}@example.test`,disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts});
const file=(last:string,kind:string,token:string,date:string):Artifact=>({kind,filename:`${last}_Test_(GOV)_${token}_${date}.pdf`});
const complete=(last:string,date:string)=>[file(last,'SAAR','GEN_SAAR',date),file(last,'DoD Cyber Cert','DoD_Cyber_Cert',date),file(last,'User Agreement','User_Agreement',date)];

test('issue tiles count users, with the affected item count alongside',()=>{
 const asOf=new Date('2026-11-22T18:00:00.000Z');
 const users=[
  user('a','Current',complete('Current','01OCT2026')),
  user('b','Nothing',[]),
  user('c','OnlySaar',[file('OnlySaar','SAAR','GEN_SAAR','01OCT2026')]),
  user('d','Late',complete('Late','01JAN2025')),
  user('e','Soon',complete('Soon','01DEC2025')),
 ];
 const stats=dashboardStats(users,asOf);
 assert.equal(stats.activeUsers,5);
 assert.equal(stats.compliantUsers,2,'Current and Soon are compliant');
 assert.equal(stats.nonCompliantUsers,3);
 assert.deepEqual(stats.missing,{users:2,items:5},'Nothing is missing 3 items and OnlySaar 2, but that is 2 users');
 assert.deepEqual(stats.overdue,{users:1,items:2});
 assert.deepEqual(stats.due,{users:1,items:2});
});

test('labels the item count in plain words',()=>{
 assert.equal(issueItemsLabel({users:3,items:7},'missing'),'7 missing items');
 assert.equal(issueItemsLabel({users:1,items:1},'overdue'),'1 overdue item');
});
