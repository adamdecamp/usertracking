import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {organizationStatusTrustNote} from '../app/organization-status-package.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const statusModal=readFileSync(new URL('../app/components/OrganizationStatusModal.tsx',import.meta.url),'utf8');
const sessionPanels=readFileSync(new URL('../app/components/SessionPanels.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');

test('organization snapshots include disabled users and exclude sensitive storage metadata',()=>{
 assert.match(statusModal,/organizationUsers=users\.filter\(user=>user\.organization===organization\)/);
 assert.match(statusModal,/including \$\{disabledCount\} disabled/);
 assert.doesNotMatch(statusModal,/OrganizationStatusPayload[\s\S]{0,600}artifact\.path/);
 assert.match(statusModal,/Evidence files, file paths, audit logs, and every other organization are excluded/);
 // The ISSO address is filled in from Organization Contacts when one is recorded.
 assert.match(statusModal,/organizationContactEmails\(system\.organizationContacts\?\?\[\],organization,\['ISSO'\]\)/);
});

test('the portable launcher prepares a validated ISSO To-line draft with a bounded snapshot attachment',()=>{
 assert.match(launcher,/25 \* 1024 \* 1024/);
 assert.match(launcher,/\.raptor-status\.json/);
 assert.match(launcher,/RAPTOR Organization Status/);
 assert.match(launcher,/InvokeMember\("To"/);
});

test('the startup gate can import a damage-checked organization snapshot in read-only mode',()=>{
 assert.match(sessionPanels,/Open Organization Snapshot/);
 assert.match(page,/parseOrganizationStatusPackage/);
 assert.match(page,/setAccessMode\('read-only'\)/);
 assert.match(page,/organizationStatusTrustNote\(requiresPassphrase\)/);
});

test('snapshot wording does not claim an unkeyed checksum proves authenticity',()=>{
 assert.doesNotMatch(page,/Integrity-verified organization snapshot/);
 assert.match(organizationStatusTrustNote(false),/file damage/);
 assert.match(organizationStatusTrustNote(false),/does not prove who created it/);
 assert.match(organizationStatusTrustNote(true),/not altered/);
});
