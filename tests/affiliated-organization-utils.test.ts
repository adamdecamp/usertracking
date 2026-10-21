import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAffiliatedOrganizations,parseAffiliatedOrganizations,userMatchesDirectoryQuery} from '../app/affiliated-organization-utils.ts';

const user={last:'Brown',first:'Jacob',email:'jacob@example.mil',organization:'GOV',affiliatedOrganizations:['Agency One','Prime Contractor','Subcontractor Blue'],privilegedUsernames:['jbrown_dev'],privilegedTypes:['DEV']};

test('normalizes and de-duplicates affiliated organizations without changing storage organization',()=>{
 assert.deepEqual(parseAffiliatedOrganizations(' Agency One; prime contractor, AGENCY ONE\nSubcontractor Blue '),['Agency One','prime contractor','Subcontractor Blue']);
 assert.deepEqual(normalizeAffiliatedOrganizations(['A','a','B']),['A','B']);
 assert.equal(user.organization,'GOV');
});

test('directory search finds agencies, contractors, subcontractors, storage organizations, and email',()=>{
 for(const query of['agency one','PRIME CONTRACTOR','subcontractor blue','gov','jacob@example.mil','jbrown_dev'])assert.equal(userMatchesDirectoryQuery(user,query),true,query);
 assert.equal(userMatchesDirectoryQuery(user,'unrelated organization'),false);
});
