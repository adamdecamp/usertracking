import assert from 'node:assert/strict';
import test from 'node:test';
import {possibleDuplicateUserIssues,possibleDuplicateUsers,possibleExistingUserMatches,userInformationEditConflicts} from '../app/application/user-match-service.ts';
import type {UserRecord} from '../app/domain/tracker-models.ts';

const user=(id:string,last:string,first:string,organization='GOV',email=''):UserRecord=>({id,systemId:'system',organization,affiliatedOrganizations:[],last,first,middle:'',email,disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[]});

test('suggests an existing user when First and Last Names are reversed',()=>{
 const result=possibleExistingUserMatches({last:'Vivian',first:'Shaw',organization:'GOV',email:''},[user('u1','Shaw','Vivian')]);
 assert.equal(result[0]?.userId,'u1');
 assert.match(result[0]?.reason??'',/reversed/i);
});

test('suggests common nicknames without silently treating them as exact identities',()=>{
 const result=possibleExistingUserMatches({last:'Smith',first:'Bob',organization:'LM',email:''},[user('u1','Smith','Robert','LM')]);
 assert.equal(result[0]?.userId,'u1');
 assert.match(result[0]?.reason??'',/nickname/i);
 assert.ok((result[0]?.score??100)<99);
});

test('keeps unrelated people out of possible-match review',()=>{
 const result=possibleExistingUserMatches({last:'Brown',first:'Jacob',organization:'LM',email:''},[user('u1','Jones','Megan','LM'),user('u2','Browning','James','GOV')]);
 assert.deepEqual(result,[]);
});

test('ranks an exact Official Email match above a name-only suggestion',()=>{
 const result=possibleExistingUserMatches({last:'Nickname',first:'Person',organization:'GOV',email:'person@example.mil'},[user('email','Different','Name','CTR','person@example.mil'),user('name','Nickname','Person')]);
 assert.equal(result[0]?.userId,'email');
 assert.equal(result[0]?.score,100);
});

test('reconciliation duplicate review returns each similar pair once',()=>{
 const users=[user('u1','Shaw','Vivian'),user('u2','Vivian','Shaw'),user('u3','Smith','Robert','LM'),user('u4','Smith','Bob','LM')];
 const result=possibleDuplicateUsers(users);
 assert.deepEqual(result.map(item=>[item.left.id,item.right.id]),[['u1','u2'],['u3','u4']]);
});

test('manual user corrections flag exact duplicate records without blocking the edit',()=>{
 const existing=[user('target','Meneses','Regina','GOV','regina@example.mil'),user('duplicate','Meneses','Regina','GOV','regina@example.mil')];
 const conflicts=userInformationEditConflicts(existing[0],{last:'Meneses',first:'Regina',organization:'GOV',email:'regina@example.mil'},existing);
 assert.equal(conflicts.identity?.id,'duplicate');
 assert.equal(conflicts.emailOwner?.id,'duplicate');
 assert.equal(conflicts.messages.length,2);
 const issues=possibleDuplicateUserIssues(existing);
 assert.ok(issues.some(issue=>issue.category==='Duplicate Identity'));
 assert.ok(issues.some(issue=>issue.category==='Duplicate Email'));
});
