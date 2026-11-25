import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalPosition,contactPositionChoices,decodeOrganizationContacts,describeOrganizationContactChanges,normalizeContact,sortContacts,standardContactPositions,validContactEmail,validContactPhone,type OrganizationContact} from '../app/domain/organization-contacts.ts';
import {describeSystemEdit} from '../app/application/system-edit.ts';

const issm:OrganizationContact={id:'c1',organization:'GOV',position:'ISSM',name:'Jordan Lee',methods:[{type:'Email',value:'jordan.lee@example.mil'}]};
const custom:OrganizationContact={id:'c2',organization:'LM',position:'Facility Security Lead',name:'Sam Ortiz',methods:[{type:'Phone',value:'(555) 555-0100 x12'}]};

test('the five required positions are the standard dropdown choices, followed by custom positions already used',()=>{
 assert.deepEqual([...standardContactPositions],['Program Manager','CPSO/FSO/GSSO','ISSM','ISSO','System Administrator']);
 assert.deepEqual(contactPositionChoices([issm,custom,{...custom,id:'c3',position:'facility security lead'}]),[...standardContactPositions,'Facility Security Lead']);
 assert.equal(canonicalPosition('issm'),'ISSM','a typed standard position keeps the standard spelling');
});

test('email and phone entries are validated by the chosen contact method',()=>{
 for(const value of ['name@example.mil','first.last+ops@agency.gov'])assert.equal(validContactEmail(value),true,value);
 for(const value of ['name','name@','name@example','a b@example.mil'])assert.equal(validContactEmail(value),false,value);
 for(const value of ['555-0100','(555) 555-0100','555.555.0100','+1 555 555 0100','555-555-0100 x123','555-555-0100 ext. 4'])assert.equal(validContactPhone(value),true,value);
 for(const value of ['555-01','call me','555-555-0100 x1234567','1234567890123456789012345678901'])assert.equal(validContactPhone(value),false,value);
});

test('a contact is cleaned and checked before it is saved',()=>{
 const saved=normalizeContact({id:'c9',organization:'gov',position:' isso ',name:'  Pat   Kim ',methods:[{type:'Email',value:' Pat.Kim@Example.mil '},{type:'Phone',value:'(555)  555-0101'}]},['GOV','LM']);
 assert.deepEqual(saved,{id:'c9',organization:'GOV',position:'ISSO',name:'Pat Kim',methods:[{type:'Email',value:'pat.kim@example.mil'},{type:'Phone',value:'(555) 555-0101'}]});
 assert.throws(()=>normalizeContact({...issm,organization:'XYZ'},['GOV']),/Choose an organization/);
 assert.throws(()=>normalizeContact({...issm,position:''},['GOV']),/Choose a position/);
 assert.throws(()=>normalizeContact({...issm,name:' '},['GOV']),/name/);
 assert.throws(()=>normalizeContact({...issm,methods:[]},['GOV']),/email address or phone number/);
 assert.throws(()=>normalizeContact({...issm,methods:[{type:'Email',value:'not-an-email'}]},['GOV']),/valid email/);
 assert.throws(()=>normalizeContact({...issm,methods:[{type:'Phone',value:'jordan.lee@example.mil'}]},['GOV']),/valid phone/);
 assert.throws(()=>normalizeContact({...issm,methods:Array.from({length:5},()=>({type:'Email' as const,value:'a@example.mil'}))},['GOV']),/at most 4/);
});

test('stored contacts are decoded strictly',()=>{
 assert.deepEqual(decodeOrganizationContacts([issm,custom]),[issm,custom]);
 assert.equal(decodeOrganizationContacts([issm,{...issm}]),undefined,'duplicate ids are rejected');
 assert.equal(decodeOrganizationContacts([{...issm,methods:[]}]),undefined);
 assert.equal(decodeOrganizationContacts([{...issm,methods:[{type:'Fax',value:'555'}]}]),undefined);
 assert.equal(decodeOrganizationContacts([{...issm,methods:[{type:'Email',value:'bad'}]}]),undefined);
 assert.equal(decodeOrganizationContacts([{...issm,name:'line\nbreak'}]),undefined);
 assert.equal(decodeOrganizationContacts({}),undefined);
});

test('contacts sort by organization, then standard position order, and edits are audited by who changed',()=>{
 const pm={...issm,id:'c4',position:'Program Manager',name:'Alex Doe'};
 assert.deepEqual(sortContacts([custom,issm,pm]).map(contact=>contact.id),['c4','c1','c2']);
 assert.equal(describeOrganizationContactChanges([issm],[{...issm,name:'Jordan Q. Lee'},custom]),'added LM Facility Security Lead Sam Ortiz; updated GOV ISSM Jordan Q. Lee');
 assert.equal(describeOrganizationContactChanges([issm,custom],[custom]),'removed GOV ISSM Jordan Lee');
 assert.equal(describeOrganizationContactChanges([issm],[issm]),'');
 const system={id:'s1',name:'ALPHA',type:'Test',organization:'GOV',archived:false};
 assert.equal(describeSystemEdit({...system,organizationContacts:[issm]},{...system,organizationContacts:[issm,custom]}),'organization contacts added LM Facility Security Lead Sam Ortiz');
 assert.equal(describeSystemEdit(system,{...system,organizationContacts:[]}),'','an empty contact list is not a change');
 assert.equal(describeSystemEdit(system,{...system,organizationContacts:[issm]}).includes('jordan.lee@example.mil'),false,'contact details are not written to the audit log');
});

test('contacts are edited in Manage Organizations and saved through the audited system edit',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8'),panel=readFileSync(new URL('../app/components/OrganizationContacts.tsx',import.meta.url),'utf8'),modal=readFileSync(new URL('../app/components/OrganizationsModal.tsx',import.meta.url),'utf8'),manifest=readFileSync(new URL('../app/application/manifest-service.ts',import.meta.url),'utf8');
 assert.match(page,/onContacts=\{organizationContacts=>updateInformationSystem\(\{\.\.\.system,organizationContacts\}\)\}/);
 assert.match(modal,/<OrganizationContacts organizations=\{organizations\} contacts=\{system\.organizationContacts\?\?\[\]\} onSave=\{onContacts\}\/>/);
 assert.match(page,/organizationContacts=next\.organizationContacts\?\?previous\.organizationContacts/);
 assert.match(panel,/<option value=\{otherPosition\}>Other…<\/option>/);
 assert.match(panel,/<option>Email<\/option><option>Phone<\/option>/);
 assert.match(manifest,/decodeOrganizationContacts\(s\.organizationContacts\)/);
});

test('Organization Contacts open directly from the User Directory and the User Administration menu, including read-only sessions',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8'),directory=readFileSync(new URL('../app/components/DirectoryHeader.tsx',import.meta.url),'utf8'),header=readFileSync(new URL('../app/components/OperatorDashboardHeader.tsx',import.meta.url),'utf8'),modal=readFileSync(new URL('../app/components/OrganizationsModal.tsx',import.meta.url),'utf8'),panel=readFileSync(new URL('../app/components/OrganizationContacts.tsx',import.meta.url),'utf8');
 assert.match(page,/onSnapshot=\{\(\)=>setModal\('share'\)\} onContacts=\{\(\)=>setModal\('contacts'\)\}/);
 assert.match(page,/onManageOrganizations=\{\(\)=>setModal\('organizations'\)\} onContacts=\{\(\)=>setModal\('contacts'\)\}/);
 assert.match(page,/modal==='contacts'\?'Organization Contacts'/);
 assert.match(page,/<OrganizationContactsModal key=\{modal\}[^>]*canWrite=\{canWrite\} manage=\{modal==='organizations'\}/);
 // The button sits before the write-only actions, so read-only sessions see it too.
 assert.ok(directory.indexOf('Organization Contacts</button>')<directory.indexOf('{props.canWrite&&<>'));
 assert.match(header,/runMenuAction\(props\.onContacts\)\}>Organization Contacts<\/button>/);
 assert.match(modal,/manage&&canWrite\?<OrganizationsModal/);
 assert.match(modal,/readOnly=\{!canWrite\}/);
 assert.match(panel,/\{!readOnly&&<button type="button" className="primary"/);
 assert.match(panel,/\{!readOnly&&<div className="directory-actions"><button type="button" disabled=\{busy\|\|!!draft\} onClick=\{\(\)=>startEdit\(contact\)\}>Edit/);
});