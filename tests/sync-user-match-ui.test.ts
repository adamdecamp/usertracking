import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const workflowTypes=readFileSync(new URL('../app/tracker-workflow-types.ts',import.meta.url),'utf8');
const identityReview=readFileSync(new URL('../app/components/SyncIdentityReview.tsx',import.meta.url),'utf8');
const userMatching=readFileSync(new URL('../app/application/user-match-service.ts',import.meta.url),'utf8');
const matchApplication=readFileSync(new URL('../app/application/sync-user-match-application.ts',import.meta.url),'utf8');

test('Sync requires operator review before a similar identity can create or update a profile',()=>{
 assert.match(page,/possibleExistingUserMatches\(item\.record,sourceUsers\)/);
 assert.match(identityReview,/Select An Existing Profile Or Confirm A New User/);
 assert.match(identityReview,/None Of These — Create A New User/);
 assert.match(identityReview,/Nothing is matched automatically; an operator must choose/);
 assert.match(workflowTypes,/possibleMatches\?:PossibleExistingUserMatch\[\]/);
 assert.match(workflowTypes,/matchToUserId\?:string/);
});

test('operator-confirmed identity matching relabels evidence and displays the destination profile',()=>{
 assert.match(page,/applyConfirmedUserMatches/);
 assert.match(matchApplication,/relabel\(item\.record,\{\.\.\.target,roles:item\.record\.roles/);
 assert.match(identityReview,/Matched User Profile:/);
 assert.match(page,/operator-confirmed existing profile match/);
});

test('Reconciliation includes possible duplicate-user analysis without changing records',()=>{
 assert.match(page,/possibleDuplicateUserIssues\(systemRecords\)/);
 assert.match(userMatching,/category:'Possible Duplicate User'/);
 assert.match(userMatching,/Operator confirmation is required; Reconciliation made no changes/);
});
