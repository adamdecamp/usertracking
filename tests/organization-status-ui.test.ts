import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {organizationStatusTrustNote} from '../app/organization-status-package.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');

test('organization snapshots include disabled users and exclude sensitive storage metadata',()=>{
 assert.match(page,/organizationUsers=users\.filter\(user=>user\.organization===organization\)/);
 assert.match(page,/including \$\{disabledCount\} disabled/);
 assert.doesNotMatch(page,/OrganizationStatusPayload[\s\S]{0,600}artifact\.path/);
 assert.match(page,/Evidence files, file paths, audit logs, and every other organization are excluded/);
});

test('the portable launcher prepares a validated ISSO To-line draft with a bounded snapshot attachment',()=>{
 assert.match(launcher,/25 \* 1024 \* 1024/);
 assert.match(launcher,/\.raptor-status\.json/);
 assert.match(launcher,/RAPTOR Organization Status/);
 assert.match(launcher,/InvokeMember\("To"/);
});

test('the startup gate can import a damage-checked organization snapshot in read-only mode',()=>{
 assert.match(page,/Open Organization Snapshot/);
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
