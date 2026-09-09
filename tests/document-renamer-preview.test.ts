import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

test('Document Renamer preview opens immediately as a full-window read-only dialog',()=>{
 assert.match(page,/setPreview\(\{loading:true,filename:item\.filename,path:item\.path\}\)/);
 assert.match(page,/className="renamer-preview-overlay" role="dialog" aria-modal="true"/);
 assert.match(page,/src=\{`\$\{preview\.url\}#view=FitH`\}/);
 assert.match(styles,/\.renamer-preview-overlay\{position:fixed;inset:0;z-index:40/);
 assert.match(styles,/\.renamer-preview-dialog\{display:flex;flex:1;flex-direction:column;width:100vw;height:100dvh/);
});

test('Document Renamer preview reports loading failures and exposes full-size access',()=>{
 assert.match(page,/Preview Unavailable:/);
 assert.match(page,/Open Full-Size PDF/);
 assert.match(page,/Download Validated PDF Copy/);
});
