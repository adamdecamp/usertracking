import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

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
