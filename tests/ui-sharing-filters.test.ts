import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const page=read('app/page.tsx'),header=read('app/components/DirectoryHeader.tsx'),share=read('app/components/ShareWithOrganizationsModal.tsx'),contacts=read('app/components/UserOrganizationContacts.tsx'),status=read('app/components/OrganizationStatusModal.tsx');

test('the User Record shows the contacts for the user’s organization',()=>{
 assert.match(page,/<UserOrganizationContacts contacts=\{system\.organizationContacts\?\?\[\]\} organization=\{draft\.organization\}\/><ExtractionProvenancePanel/);
 assert.match(contacts,/contact\.organization\.toUpperCase\(\)===organization\.toUpperCase\(\)/,'organization names match without regard to case, as elsewhere');
 assert.match(contacts,/sortContacts\(/,'standard positions are listed first');
 assert.match(contacts,/mailto:\$\{value\}/);
 assert.match(contacts,/No contacts are recorded for \{organization\}/);
});

test('quick views start from the default filters and the less-used filters sit under More Filters',()=>{
 for(const label of ['Not Compliant','Overdue','Due Within 30 Days','Missing Items','SAAR Missing','Official Email Missing'])assert.ok(header.includes(`label:'${label}'`),`${label} is a quick view`);
 assert.match(header,/onClick=\{\(\)=>\{props\.onReset\(\);view\.apply\(props\)\}\}/,'a view resets the other filters first');
 assert.match(header,/aria-pressed=\{activeCount===1&&view\.matches\(props\)\}/,'a view is shown as selected only while it is the only filter');
 const visible=header.slice(header.indexOf('<div className="filters">'),header.indexOf('{showMore&&')),more=header.slice(header.indexOf('{showMore&&'),header.indexOf('<div className="directory-subbar">'));
 for(const label of ['Search User Directory','User Compliance Filter','Compliance Status Filter','Storage Organization Filter'])assert.ok(visible.includes(`aria-label="${label}"`),`${label} is always visible`);
 for(const label of ['User Status Filter','Artifact Filter','Role Filter','Privileged User Type Filter','SAAR Status Filter','Official Email Filter','Affiliated Organization Filter'])assert.ok(more.includes(`aria-label="${label}"`),`${label} is under More Filters`);
 assert.match(header,/const showMore=moreOpen\|\|moreActive>0;/,'a filter that is narrowing the list is never hidden');
});

test('Share with Organizations replaces the status-file button and opens each format with the organizations chosen',()=>{
 assert.match(header,/onClick=\{props\.onSnapshot\}>Share with Organizations<\/button>/);
 assert.match(page,/onSnapshot=\{\(\)=>setModal\('share'\)\}/);
 assert.match(page,/onPdf=\{\(organizations,emailing\)=>\{setReportPreset\(\{systemIds:\[system\.id\],organizations,emailing\}\);setModal\('report'\)\}\}/);
 assert.match(page,/onStatusFile=\{organization=>\{setStatusOrganization\(organization\);setModal\('organization-status'\)\}\}/);
 assert.match(page,/onComplianceSnapshot=\{\(\)=>\{setReportPreset\(undefined\);setModal\('report'\)\}\}/,'the Reports menu still opens Compliance Snapshot with its usual defaults');
 assert.match(page,/useState<string\[\]>\(preset\?\.systemIds\?\?/);
 assert.match(page,/useState<string\[\]>\(preset\?\.organizations\?\?/);
 assert.match(page,/useState\(preset\?\.emailing\?\?false\)/);
 assert.match(status,/first=organizations\.includes\(initialOrganization\)\?initialOrganization:organizations\[0\]/);
 assert.match(share,/const active=users\.filter\(user=>!user\.disabled\)/,'the shared CSV covers active users, like the dashboard');
 assert.match(share,/filteredDirectoryCsvRows\(inScope,system,asOf\)/);
 assert.match(share,/services\.audit\(`EXPORT ORGANIZATION COMPLIANCE CSV:/,'the CSV export is audited');
 assert.match(share,/disabled=\{chosen\.length!==1\} onClick=\{\(\)=>onStatusFile\(chosen\[0\]\)\}/,'a status file is for exactly one organization');
});
