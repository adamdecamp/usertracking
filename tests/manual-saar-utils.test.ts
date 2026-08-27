import test from 'node:test';
import assert from 'node:assert/strict';
import {manualSaarPrefill} from '../app/manual-saar-utils.ts';

test('uses the SAAR filename first for identity and organization and the form for email',()=>{
 const result=manualSaarPrefill('Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf',{fillable:true,identity:{last:'Wrong',first:'Person',middle:'A'},organization:'GOV',email:'jacob.brown@example.mil'});
 assert.deepEqual(result,{last:'Brown',first:'Jacob',middle:'A',organization:'LM',email:'jacob.brown@example.mil',identitySource:'filename',organizationSource:'filename',emailSource:'form'});
});

test('falls back to fillable SAAR fields when filename identity and organization are unavailable',()=>{
 const result=manualSaarPrefill('request.pdf',{fillable:true,identity:{last:'Shaw',first:'Vivian',middle:'R'},organization:'Boeing',email:'vivian.shaw@example.mil'});
 assert.deepEqual(result,{last:'Shaw',first:'Vivian',middle:'R',organization:'Boeing',email:'vivian.shaw@example.mil',identitySource:'form',organizationSource:'form',emailSource:'form'});
});

test('uses the embedded PDF filename for a generically named ZIP and ignores template placeholders',()=>{
 const result=manualSaarPrefill('upload.zip',{fillable:true,email:'jill.smith@example.mil'},'Smith_Jill_(GOV)_PRIV_admin_SAAR_26AUG2026.pdf');
 assert.equal(result.last,'Smith');assert.equal(result.first,'Jill');assert.equal(result.organization,'GOV');assert.equal(result.email,'jill.smith@example.mil');
 const template=manualSaarPrefill('Last_First_(Org)_GEN_SAAR_26AUG2026.pdf',{fillable:true,identity:{last:'Taylor',first:'Alex'},organization:'LM'});
 assert.equal(template.last,'Taylor');assert.equal(template.first,'Alex');assert.equal(template.organization,'LM');
});
