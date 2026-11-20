import assert from 'node:assert/strict';
import test from 'node:test';
import type {UserRecord} from '../app/domain/tracker-models.ts';
import {newestArtifactFor,statusFor} from '../app/user-status-utils.ts';

const user=(overrides:Partial<UserRecord>={}):UserRecord=>({
 id:'user-1',systemId:'system-1',organization:'GOV',affiliatedOrganizations:[],last:'Ramey',first:'Edward',middle:'',email:'edward@example.mil',disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[],...overrides,
});

test('retains compliance status for explicitly associated evidence whose prior filename could not be relabeled',()=>{
 const record=user({artifacts:[{kind:'DoD Cyber Cert',filename:'Edward_Ramey_(GOV)_DoD_Cyber_Cert_18SEP2026.pdf.zip',path:'Organizations/GOV/GOV DoD Cyber Cert/Edward_Ramey_(GOV)_DoD_Cyber_Cert_18SEP2026.pdf.zip'}]});
 assert.equal(newestArtifactFor(record,'DoD Cyber Cert')?.filename,'Edward_Ramey_(GOV)_DoD_Cyber_Cert_18SEP2026.pdf.zip');
 assert.equal(statusFor(record,'DoD Cyber Cert',new Date('2026-11-20T00:00:00Z')),'Current');
});

test('keeps a disabled SAAR from satisfying an active user even when it is explicitly associated',()=>{
 const record=user({artifacts:[{kind:'SAAR',filename:'Ramey_Edward_(GOV)_GEN_SAAR_18SEP2026_DISABLED.pdf.zip',path:'Organizations/GOV/GOV SAAR Archive/Ramey_Edward_(GOV)_GEN_SAAR_18SEP2026_DISABLED.pdf.zip'}]});
 assert.equal(newestArtifactFor(record,'SAAR'),undefined);
 assert.equal(statusFor(record,'SAAR',new Date('2026-11-20T00:00:00Z')),'Missing');
});
