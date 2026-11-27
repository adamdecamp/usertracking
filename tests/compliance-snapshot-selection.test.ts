import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const modal=readFileSync(new URL('../app/components/ComplianceReportModal.tsx',import.meta.url),'utf8');

test('the Compliance Snapshot organizations can be cleared or all selected in one click',()=>{
 const organizations=modal.slice(modal.indexOf('<h3>Organizations</h3>'),modal.indexOf('<OrganizationEmailOptions'));
 assert.ok(organizations.length>100,'the organizations section was found');
 assert.match(organizations,/<button type="button" disabled=\{!selectedOrganizations\.length\} onClick=\{\(\)=>setOrganizations\(\[\]\)\}>Clear<\/button>/);
 assert.match(organizations,/onClick=\{\(\)=>setOrganizations\(availableOrganizations\)\}>Select All<\/button>/);
 assert.match(organizations,/role="group" aria-label="Organizations to Report"/);
 // With nothing selected, nothing can be generated.
 assert.match(modal,/if\(!systemIds\.length\|\|!selectedOrganizations\.length\|\|/);
 assert.match(modal,/disabled=\{generating\|\|!systemIds\.length\|\|!selectedOrganizations\.length\|\|/);
});
