import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../app/page.tsx');

test('Sync does not insert the organization into a filename with no recognizable document type',()=>{
 assert.match(page,/organizationNormalization=deferSaarOrganization\|\|!identity\|\|!artifactKindFromFilename\(dated\)\?undefined:normalizeFilenameOrganization\(dated,folderOrganization\)/);
});

test('Review Sync Results leads with counts and folds the rule explanation away',()=>{
 assert.match(page,/<div className="audit-summary sync-summary"><span><b>\{pending\.scanned\}<\/b>Files Scanned<\/span>/);
 assert.match(page,/finished in \{pending\.scanDurationMs<1000\?'under a second':/);
 assert.match(page,/<details className="hint sync-rules"><summary>How Sync checked these files<\/summary>/);
});

test('an unreadable SAAR is described in plain words, not as an internal parser fault',()=>{
 const reader=read('../app/application/saar-reader.ts');
 assert.match(reader,/return\{email:'',error:saarReadFailureMessage\(error\),emailRecoveryAttempted:recoverOfficialEmailFromText\}/);
 assert.match(reader,/const internalErrorNames=new Set\(\['TypeError','RangeError','ReferenceError','SyntaxError','InternalError'\]\)/);
 assert.match(reader,/Its form fields could not be read\. Attach the completed fillable SAAR, or check that the file opens normally in a PDF reader\./);
});

test('the user list fits more columns at laptop width and keeps status badges on one line',()=>{
 const css=read('../app/globals.css');
 assert.match(css,/\.status\{white-space:nowrap\}/);
 assert.match(css,/@media \(max-width:1280px\)\{\.directory \.table-wrap th\{padding:10px 8px/);
});

test('fields that had no accessible name are named for screen readers',()=>{
 assert.match(page,/placeholder="System Name" aria-label="System Name"/);
 assert.match(page,/placeholder="System Type" aria-label="System Type"/);
 assert.match(page,/placeholder="Organization" aria-label="System Organization"/);
 assert.match(read('../app/components/OrganizationsModal.tsx'),/aria-label="New Organization Name"/);
 assert.match(read('../app/components/OperatorDashboardHeader.tsx'),/<select aria-label="Information System" value=\{props\.selectedSystemId\}/);
});
