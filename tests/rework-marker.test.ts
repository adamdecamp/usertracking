import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {hasReworkMarker,withReworkMarker,withoutReworkMarker} from '../app/rework-marker.ts';
import {organizationCleanupDirectory} from '../app/document-renamer-utils.ts';
import {readPageSource} from './page-source.ts';

const page=readPageSource();
const storage=readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
const marker=readFileSync(new URL('../portable-launcher/PortableReworkMarker.cs',import.meta.url),'utf8');
const browserRework=readFileSync(new URL('../app/browser-rework.ts',import.meta.url),'utf8');

test('the REWORK marker is recognized on names and paths, added once, and removed for validation',()=>{
 assert.equal(hasReworkMarker('REWORK_Doe_Jane_(ORG)_SAAR_01JAN2026.pdf'),true);
 assert.equal(hasReworkMarker('Organizations/ORG/rework_Doe_Jane_(ORG)_SAAR_01JAN2026.pdf'),true);
 assert.equal(hasReworkMarker('Organizations/REWORK_ORG/Doe_Jane_(ORG)_SAAR_01JAN2026.pdf'),false,'only the filename counts');
 assert.equal(hasReworkMarker('Reworked_Doe_Jane.pdf'),false);
 assert.equal(hasReworkMarker('REWORK_'),false);
 assert.equal(withReworkMarker('Doe_Jane_(ORG)_SAAR_01JAN2026.pdf'),'REWORK_Doe_Jane_(ORG)_SAAR_01JAN2026.pdf');
 assert.equal(withReworkMarker('REWORK_Doe.pdf'),'REWORK_Doe.pdf');
 assert.equal(withReworkMarker('Doe_Jane.pdf.zip'),'REWORK_Doe_Jane.pdf.zip');
 assert.equal(withReworkMarker('notes.docx'),'REWORK_notes.docx');
 const long=withReworkMarker(`${'A'.repeat(200)}.pdf`);
 assert.ok(long.length<=180&&long.startsWith('REWORK_')&&long.endsWith('.pdf'));
 assert.equal(withoutReworkMarker('REWORK_REWORK_Doe_Jane_(ORG)_SAAR_01JAN2026.pdf'),'Doe_Jane_(ORG)_SAAR_01JAN2026.pdf');
 assert.equal(withoutReworkMarker('Doe_Jane.pdf'),'Doe_Jane.pdf');
});

test('Rework targets the organization folder itself instead of a Rework subfolder',()=>{
 assert.deepEqual(organizationCleanupDirectory('Organizations/ORG/ORG SAAR/Doe.pdf','SYSTEM','Rework'),{organization:'ORG',relativeDirectory:'Organizations/ORG',folder:'',path:'Organizations/ORG'});
 assert.equal(organizationCleanupDirectory('Organizations/ORG/Doe.pdf','SYSTEM','Archive').folder,'ORG Archive');
});

test('Sync reads REWORK files under their unmarked name and clears the marker once they pass',()=>{
 assert.match(page,/function insideOrganizationRework\(path:string\)\{return hasReworkMarker\(path\)\}/);
 assert.equal((page.match(/filename:withoutReworkMarker\(cleanName\),ref,/g)??[]).length,3,'portable and browser scans validate the unmarked name');
 assert.match(page,/insideOrganizationRework\(entry\.path\)&&evidenceFilenamePassesStorageGate\(entry\.filename,[\s\S]{0,500}?normalizeEvidenceDate\(h,item,item\.filename\)/);
 assert.match(page,/CLEAR REWORK MARKER: \$\{previousPath\} renamed to \$\{result\.path\}/);
 assert.match(page,/scanResult\.evidence=scanResult\.evidence\.filter\(entry=>entry!==item\);normalizationFailures\.push\(\{[^}]*reason:`REWORK marker kept:/,'a marker that cannot be cleared keeps the file out of filing');
 assert.match(browserRework,/safeName=withReworkMarker\(safeFilePart\(requestedName/);
 assert.match(browserRework,/safeName=withReworkMarker\(safeFilePart\(ref\.name,180\)\)/);
 assert.doesNotMatch(page+browserRework,/getDirectoryHandle\(`\$\{safeFilePart\(organization,80\)\} Rework`/,'no Rework folder is created');
 assert.match(page,/if\(reworkDirectory\|\|permanentSaarArchiveDirectory\(name\)/,'legacy Rework folders are not scanned');
 assert.match(page,/else if\(isRework\)continue;/);
});

test('the launcher marks files in place and no longer creates or scans Rework folders',()=>{
 assert.doesNotMatch(storage,/" Rework"\)\);/,'no Rework folder is created');
 assert.match(storage,/string directory = organization\.Item1, filename = WithReworkMarker\(Path\.GetFileName\(source\)\);/);
 assert.match(storage,/UniqueDestination\(directory, WithReworkMarker\(Path\.GetFileName\(source\)\)\)/);
 assert.match(storage,/if \(IsReworkStorageDirectory\(name\)\) continue;/);
 assert.match(storage,/IsOrganizationReworkEvidencePath\(string relative\) \{ return IsReworkMarkedEvidencePath\(relative\); \}/);
 assert.match(marker,/internal const string ReworkMarker = "REWORK_";/);
 for(const script of ['../scripts/build-portable.ps1','../scripts/Test-PortableStorage.ps1'])assert.match(readFileSync(new URL(script,import.meta.url),'utf8'),/PortableReworkMarker\.cs/);
});
