import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');

test('does not start Sync while restoring, mapping, or selecting a system',()=>{
 const restore=page.slice(page.indexOf("if(!hydrated||!trackerWindow().__portableHost||mappingRestoreStarted.current)"),page.indexOf('// Persist only the actively leased system'));
 const mapping=page.slice(page.indexOf('async function mapFolder'),page.indexOf('async function scan'));
 const selection=page.slice(page.indexOf('async function selectInformationSystem'),page.indexOf('function openUser'));
 assert.doesNotMatch(restore,/syncMapped\s*\(/);
 assert.doesNotMatch(mapping,/syncMapped\s*\(/);
 assert.doesNotMatch(selection,/syncMapped\s*\(/);
 assert.match(page,/Sync never starts automatically/);
});

test('offers only entire-system or immediate-organization Sync scope',()=>{
 assert.match(page,/<option value="system">Entire Information System<\/option>/);
 assert.match(page,/<option value="organization"[^>]*>One Organization<\/option>/);
 assert.match(page,/Deeper subfolders cannot be selected as a separate Sync scope/);
 assert.doesNotMatch(page,/onClick=\{\(\)=>void sync\(true\)\}/);
});

test('passes the validated organization scope to every launcher discovery stage',()=>{
 assert.match(launcher,/ScanWithJournal\([^\r\n]+OptionalQueryValue\(target, "organization"\)/);
 assert.match(launcher,/ListEvidenceLocations\(systemId, OptionalQueryValue\(target, "organization"\)\)/);
 assert.match(launcher,/ProcessReworkRetention\([^\r\n]+OptionalQueryValue\(target, "organization"\)/);
});
