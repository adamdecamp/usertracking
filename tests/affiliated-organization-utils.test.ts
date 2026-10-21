import test from 'node:test';
import assert from 'node:assert/strict';
import {derivedAffiliatedOrganizations,govEmailAffiliations,normalizeAffiliatedOrganizations,parseAffiliatedOrganizations,userMatchesDirectoryQuery,withSaarDesignationAffiliation} from '../app/affiliated-organization-utils.ts';

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

test('derives only CTR and CIV tokens from GOV email text and never infers MIL from email',()=>{
 assert.deepEqual(govEmailAffiliations('GOV','jane.doe.ctr@example.mil'),['CTR']);
 assert.deepEqual(govEmailAffiliations('GOV','jane-doe-civ@example.mil'),['CIV']);
 assert.deepEqual(govEmailAffiliations('GOV','jane.doe.mil@example.mil'),[]);
 assert.deepEqual(govEmailAffiliations('LM','jane.doe.ctr@example.mil'),[]);
 assert.deepEqual(derivedAffiliatedOrganizations({...user,email:'jacob.ctr@example.mil'}),[...user.affiliatedOrganizations,'CTR']);
});

test('uses an authoritative SAAR Designation of Person for every storage organization',()=>{
 assert.deepEqual(withSaarDesignationAffiliation(['Agency One','MIL'],'CTR'),['Agency One','CTR']);
 assert.deepEqual(withSaarDesignationAffiliation(['Prime Contractor'],'MIL'),['Prime Contractor','MIL']);
 assert.deepEqual(withSaarDesignationAffiliation(['CIV','Division A'],'CIV'),['Division A','CIV']);
});
