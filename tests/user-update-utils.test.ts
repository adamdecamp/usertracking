import assert from 'node:assert/strict';
import test from 'node:test';
import {accessChangeOverrideAllowed,manualAddEvidenceGate,missingOfficialEmailUpdate,reactivationEvidenceRequirementSatisfied,updatedSaarRequirementSatisfied} from '../app/user-update-utils.ts';

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

test('allows a documented override for privilege-only or combined changes',()=>{
 const override={...input,statusChange:true,overrideSelected:true,overrideComment:'Documented reason'};
 assert.equal(updatedSaarRequirementSatisfied({...override,modifyingPrivileges:true}),true);
 assert.equal(updatedSaarRequirementSatisfied({...input,modifyingPrivileges:true,overrideSelected:true,overrideComment:'Documented reason'}),true);
});

test('requires every reactivation artifact unless a documented override is used',()=>{
 assert.equal(reactivationEvidenceRequirementSatisfied({reactivating:true,allRequiredEvidenceSelected:true,overrideAllowed:true,overrideSelected:false,overrideComment:''}),true);
 assert.equal(reactivationEvidenceRequirementSatisfied({reactivating:true,allRequiredEvidenceSelected:false,overrideAllowed:true,overrideSelected:false,overrideComment:''}),false);
 assert.equal(reactivationEvidenceRequirementSatisfied({reactivating:true,allRequiredEvidenceSelected:false,overrideAllowed:true,overrideSelected:true,overrideComment:'Mission requirement approved by the account manager.'}),true);
 assert.equal(reactivationEvidenceRequirementSatisfied({reactivating:true,allRequiredEvidenceSelected:false,overrideAllowed:false,overrideSelected:true,overrideComment:'Not sufficient'}),false);
});

test('allows manual user creation with documented missing supporting evidence',()=>{
 const result=manualAddEvidenceGate({requiredKinds:['SAAR','DoD Cyber Cert','User Agreement'],selectedKinds:['SAAR'],overrideSelected:true,overrideComment:'  Supporting evidence will be collected after account onboarding.  '});
 assert.deepEqual(result,{allowed:true,missingKinds:['DoD Cyber Cert','User Agreement'],overrideApplied:true,justification:'Supporting evidence will be collected after account onboarding.'});
});

test('requires justification and never allows the manual-add override to replace the SAAR',()=>{
 const requiredKinds=['SAAR','DoD Cyber Cert','User Agreement'];
 assert.equal(manualAddEvidenceGate({requiredKinds,selectedKinds:['SAAR'],overrideSelected:false,overrideComment:''}).allowed,false);
 assert.equal(manualAddEvidenceGate({requiredKinds,selectedKinds:['SAAR'],overrideSelected:true,overrideComment:'   '}).allowed,false);
 assert.equal(manualAddEvidenceGate({requiredKinds,selectedKinds:['DoD Cyber Cert','User Agreement'],overrideSelected:true,overrideComment:'SAAR pending'}).allowed,false);
});

test('does not record a manual-add override when every required artifact is selected',()=>{
 const result=manualAddEvidenceGate({requiredKinds:['SAAR','DoD Cyber Cert'],selectedKinds:['SAAR','DoD Cyber Cert'],overrideSelected:true,overrideComment:'Not needed'});
 assert.equal(result.allowed,true);
 assert.equal(result.overrideApplied,false);
 assert.deepEqual(result.missingKinds,[]);
});

test('allows a valid Official Email to fill an empty user record',()=>{
 assert.deepEqual(missingOfficialEmailUpdate('',' User.Name@example.mil ',['other@example.mil']),{allowed:true,email:'User.Name@example.mil'});
});

test('rejects invalid, duplicate, or replacement Official Email edits',()=>{
 assert.match(missingOfficialEmailUpdate('','not-an-email').reason??'',/valid Official Email/);
 assert.match(missingOfficialEmailUpdate('','shared@example.mil',['SHARED@EXAMPLE.MIL']).reason??'',/already assigned/);
 assert.match(missingOfficialEmailUpdate('existing@example.mil','replacement@example.mil').reason??'',/only be entered.*missing/);
});
