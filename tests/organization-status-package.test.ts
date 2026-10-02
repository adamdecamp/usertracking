import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrganizationStatusPackage,organizationStatusPackageFormat,organizationStatusPackageVersion,parseOrganizationStatusPackage,type OrganizationStatusPayload} from '../app/organization-status-package.ts';

const payload:OrganizationStatusPayload={format:organizationStatusPackageFormat,version:organizationStatusPackageVersion,generatedAtUtc:'2026-10-01T12:00:00.000Z',applicationVersion:'1.2.82',ruleSetVersion:'rules',system:{id:'sys-1',name:'Test System',type:'Production'},organization:'GOV',users:[{id:'u1',last:'Brown',first:'Jacob',middle:'',email:'jacob@example.mil',disabled:false,roles:['General'],privilegedTypes:[],artifacts:[{kind:'SAAR',filename:'Brown_Jacob_(GOV)_GEN_SAAR_01OCT2026.pdf.zip'}],exceptions:[]},{id:'u2',last:'Disabled',first:'User',middle:'',email:'disabled@example.mil',disabled:true,roles:['Privileged'],privilegedTypes:['DTA'],artifacts:[],exceptions:[]}]};

test('organization status packages round-trip with an integrity check',async()=>{
 const created=await createOrganizationStatusPackage(payload),parsed=await parseOrganizationStatusPackage(JSON.stringify(created));
 assert.equal(parsed.payload.organization,'GOV');
 assert.equal(parsed.payload.users[0].last,'Brown');
 assert.equal(parsed.payload.users[1].disabled,true);
 assert.equal(parsed.contentSha256,created.contentSha256);
});

test('organization status packages reject tampering',async()=>{
 const created=await createOrganizationStatusPackage(payload),tampered=JSON.stringify({...created,payload:{...created.payload,organization:'OTHER'}});
 await assert.rejects(()=>parseOrganizationStatusPackage(tampered),/integrity check/);
});
