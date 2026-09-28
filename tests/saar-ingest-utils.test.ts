import test from 'node:test';
import assert from 'node:assert/strict';
import {saarEmailAdmission} from '../app/saar-ingest-utils.ts';

test('accepts a detected Official Email for automatic user creation',()=>{
 assert.deepEqual(saarEmailAdmission({email:' User.Name@example.mil '}),{allowed:true,email:'User.Name@example.mil',missingOfficialEmail:false});
});

test('accepts a validated SAAR with a missing Official Email and flags manual entry',()=>{
 assert.deepEqual(saarEmailAdmission({email:'',error:'The Official Email field is empty.',manualEntryAllowed:true}),{allowed:true,email:'',missingOfficialEmail:true});
});

test('does not weaken validation for an unreadable or structurally invalid SAAR',()=>{
 assert.deepEqual(saarEmailAdmission({email:'',error:'The SAAR is not a readable fillable PDF.'}),{allowed:false,email:'',missingOfficialEmail:false,reason:'The SAAR is not a readable fillable PDF.'});
});

test('does not accept an invalid email unless the SAAR explicitly allows manual entry',()=>{
 assert.equal(saarEmailAdmission({email:'not-an-email'}).allowed,false);
 assert.deepEqual(saarEmailAdmission({email:'not-an-email',manualEntryAllowed:true}),{allowed:true,email:'',missingOfficialEmail:true});
});
