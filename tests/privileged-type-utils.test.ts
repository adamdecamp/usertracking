import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePrivilegedType,normalizePrivilegedTypes,privilegedTypeMatches} from '../app/privileged-type-utils.ts';

test('normalizes privileged account types without regard to case or leading underscores',()=>{
 assert.equal(normalizePrivilegedType('_dev'),'DEV');
 assert.equal(normalizePrivilegedType(' Dev '),'DEV');
 assert.equal(privilegedTypeMatches('DEV','dev'),true);
 assert.deepEqual(normalizePrivilegedTypes(['DEV','dev','_Dev','DTA','_dta']),['DEV','DTA']);
});

test('bounds and removes empty privileged account types',()=>{
 assert.deepEqual(normalizePrivilegedTypes(['','_','  ','admin'],1),['ADMIN']);
});
