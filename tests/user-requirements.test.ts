import test from 'node:test';
import assert from 'node:assert/strict';
import {isDtaOnlyPrivilegedUser,requirementAppliesToUser,requirementStatusLabel,requiredKindsForUser} from '../app/user-requirements.ts';

test('marks the 8140 memo not applicable for a DTA-only privileged user',()=>{
 const user={roles:['Privileged'],privilegedTypes:['_dTa']};
 assert.equal(isDtaOnlyPrivilegedUser(user),true);
 assert.deepEqual(requiredKindsForUser(user),[
  'SAAR',
  'DoD Cyber Cert',
  'User Agreement',
  'Privileged User Training Cert',
  'DTA Training',
 ]);
 assert.equal(requirementAppliesToUser(user,'8140 Cert Memo'),false);
});

test('keeps the 8140 memo required for non-DTA and mixed privileged types',()=>{
 const administrator={roles:['Privileged'],privilegedTypes:['ADM']};
 assert.equal(isDtaOnlyPrivilegedUser(administrator),false);
 assert.equal(requirementAppliesToUser(administrator,'8140 Cert Memo'),true);
 assert.equal(requirementAppliesToUser(administrator,'DTA Training'),false);

 const mixed={roles:['Privileged'],privilegedTypes:['DTA','DEV']};
 assert.equal(isDtaOnlyPrivilegedUser(mixed),false);
 assert.equal(requirementAppliesToUser(mixed,'8140 Cert Memo'),true);
 assert.equal(requirementAppliesToUser(mixed,'DTA Training'),true);
});

test('keeps general-user requirements unchanged even when legacy type data exists',()=>{
 const general={roles:['General'],privilegedTypes:['DTA']};
 assert.equal(isDtaOnlyPrivilegedUser(general),false);
 assert.deepEqual(requiredKindsForUser(general),['SAAR','DoD Cyber Cert','User Agreement']);
});

test('labels non-expiring SAAR evidence as present without changing missing status',()=>{
 assert.equal(requirementStatusLabel('SAAR','Current'),'Present');
 assert.equal(requirementStatusLabel('SAAR','Missing'),'Missing');
 assert.equal(requirementStatusLabel('DoD Cyber Cert','Current'),'Current');
});
