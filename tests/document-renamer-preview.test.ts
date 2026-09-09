import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
const versions=readFileSync(new URL('../app/version.ts',import.meta.url),'utf8');

test('Document Renamer preview opens immediately as a full-window read-only dialog',()=>{
 assert.match(page,/setPreview\(\{loading:true,filename:item\.filename,path:item\.path\}\)/);
 assert.match(page,/import \{createPortal\} from 'react-dom'/);
 assert.match(page,/className="renamer-preview-overlay" role="dialog" aria-modal="true"/);
 assert.match(page,/createPortal\(<div className="renamer-preview-overlay"/);
 assert.match(page,/src=\{`\$\{preview\.url\}#zoom=page-width`\}/);
 assert.match(styles,/\.renamer-preview-overlay\{position:fixed!important;inset:0!important;z-index:2147483647/);
 assert.match(styles,/\.renamer-preview-dialog\{position:fixed;inset:0;display:flex;flex-direction:column;width:100vw;max-width:none;height:100vh;height:100dvh/);
});

test('Document Renamer preview reports loading failures and exposes full-size access',()=>{
 assert.match(page,/Preview Unavailable:/);
 assert.match(page,/Open Full-Size PDF/);
 assert.match(page,/Download Validated PDF Copy/);
});

test('SAAR form identity is fallback-only in Document Renamer and Evidence Audit',()=>{
 assert.match(page,/applySaarFormFallback\(parsedAnalysis,form\.identity,form\.organization\)/);
 assert.doesNotMatch(page,/first:identity\?\.first\?\?parsedAnalysis\.first/);
 assert.match(page,/identity=identity\?\?fields\.identity/);
 assert.doesNotMatch(page,/identity=fields\.identity\?\?identity/);
});

test('browser Sync bypasses the unchanged-file cache for every Rework file',()=>{
 assert.match(page,/reworkEvidence=insideOrganizationRework\(path\),cached=!reworkEvidence&&!!previous/);
});

test('corrected Rework evidence is normalized, promoted, and clears stale source rejections',()=>{
 const normalizable=page.match(/const normalizableByPath=[\s\S]*?const filenameRenames=/)?.[0]??'';
 const saarPreparation=page.match(/saarPreparations=[\s\S]*?formSaarPreparations=/)?.[0]??'';
 assert.ok(normalizable,'Sync normalization wiring was not found.');
 assert.ok(saarPreparation,'SAAR preparation wiring was not found.');
 assert.doesNotMatch(normalizable,/!insideOrganizationRework/);
 assert.doesNotMatch(saarPreparation,/!insideOrganizationRework/);
 assert.match(page,/normalizedSourcePaths\.add\(scanPathKey\(previousPath\)\)/);
 assert.match(page,/promotedSourcePaths\.add\(scanPathKey\(source\)\)/);
 assert.match(page,/if\(!normalizedSourcePaths\.has\(key\)&&!known\.has\(key\)\)scanResult\.rejected\.push\(rejection\)/);
 assert.match(page,/if\(!promotedSourcePaths\.has\(key\)&&!known\.has\(key\)\)scanResult\.rejected\.push\(rejection\)/);
});

test('disabled users do not expose actionable supporting-artifact status',()=>{
 assert.match(page,/const status=u\.disabled\?'':statusFor\(u,k\)/);
 assert.match(page,/const filterStatus=user\.disabled\?'':directoryStatusFor\(user,kind,asOf\)/);
 assert.match(page,/if\(u\.disabled\)return <td key=\{kind\} aria-label=\{`\$\{kind\} status not applicable`\}>—<\/td>/);
});

test('incremental Sync uses a validation-only cache version and reports fast-path counts',()=>{
 assert.match(versions,/export const evidenceValidationCacheVersion=/);
 assert.match(page,/readSyncIndex\(JSON\.parse\(text\),evidenceValidationCacheVersion\)/);
 assert.match(page,/createSyncIndex\(evidenceValidationCacheVersion,files\)/);
 assert.match(page,/scan\?rules=\$\{encodeURIComponent\(evidenceValidationCacheVersion\)\}/);
 assert.match(page,/\$\{scanResult\.scanned\} discovered; \$\{scanResult\.unchanged\}/);
 assert.match(page,/Daily retention already completed;/);
});
