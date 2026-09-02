import assert from 'node:assert/strict';
import test from 'node:test';
import {accessChangeOverrideAllowed,reactivationEvidenceRequirementSatisfied,updatedSaarRequirementSatisfied} from '../app/user-update-utils.ts';

const input={statusChange:false,modifyingPrivileges:false,hasUpdatedSaar:false,overrideSelected:false,overrideComment:''};

test('does not require an updated SAAR for evidence-only changes',()=>{
 assert.equal(updatedSaarRequirementSatisfied(input),true);
});

test('accepts an updated SAAR for access or privilege changes',()=>{
 assert.equal(updatedSaarRequirementSatisfied({...input,statusChange:true,hasUpdatedSaar:true}),true);
 assert.equal(updatedSaarRequirementSatisfied({...input,modifyingPrivileges:true,hasUpdatedSaar:true}),true);
});

test('allows a documented override for an access status change',()=>{
 const disabling={...input,statusChange:true,overrideSelected:true,overrideComment:'Account owner departed before an updated SAAR was available.'};
 assert.equal(accessChangeOverrideAllowed(disabling),true);
 assert.equal(updatedSaarRequirementSatisfied(disabling),true);
});

test('requires a nonblank override comment',()=>{
 assert.equal(updatedSaarRequirementSatisfied({...input,statusChange:true,overrideSelected:true,overrideComment:'   '}),false);
});

test('does not allow the access override for privilege-only or combined changes',()=>{
 const override={...input,statusChange:true,overrideSelected:true,overrideComment:'Documented reason'};
 assert.equal(updatedSaarRequirementSatisfied({...override,modifyingPrivileges:true}),false);
 assert.equal(updatedSaarRequirementSatisfied({...input,modifyingPrivileges:true,overrideSelected:true,overrideComment:'Documented reason'}),false);
});

test('requires every reactivation artifact unless a documented override is used',()=>{
 assert.equal(reactivationEvidenceRequirementSatisfied({reactivating:true,allRequiredEvidenceSelected:true,overrideAllowed:true,overrideSelected:false,overrideComment:''}),true);
 assert.equal(reactivationEvidenceRequirementSatisfied({reactivating:true,allRequiredEvidenceSelected:false,overrideAllowed:true,overrideSelected:false,overrideComment:''}),false);
 assert.equal(reactivationEvidenceRequirementSatisfied({reactivating:true,allRequiredEvidenceSelected:false,overrideAllowed:true,overrideSelected:true,overrideComment:'Mission requirement approved by the account manager.'}),true);
 assert.equal(reactivationEvidenceRequirementSatisfied({reactivating:true,allRequiredEvidenceSelected:false,overrideAllowed:false,overrideSelected:true,overrideComment:'Not sufficient'}),false);
});
