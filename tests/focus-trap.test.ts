import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import test from 'node:test';

// A screen that announces itself as a modal dialog must keep keyboard focus inside it. AccessibleModal does that
// itself; every other such screen must use the shared focus trap. Without it, Tab reaches the page behind a
// screen that is meant to block it, including the session lock.
const directory=new URL('../app/components/',import.meta.url);
const files=readdirSync(directory).filter(name=>name.endsWith('.tsx'));
const read=(name:string)=>readFileSync(new URL(name,directory),'utf8');

test('every modal dialog outside AccessibleModal uses the shared focus trap on the element it announces',()=>{
 assert.ok(files.length>20,'the component files were read');
 const screens:string[]=[];
 for(const name of files){
  if(name==='AccessibleModal.tsx')continue;
  const source=read(name),dialogs=[...source.matchAll(/<div([^>]*)role="dialog" aria-modal="true"/g)];
  if(!dialogs.length)continue;
  assert.match(source,/import \{useFocusTrap\} from '\.\/useFocusTrap(?:\.ts)?';/,`${name} imports the focus trap`);
  const refs=new Set<string>();
  for(const dialog of dialogs){
   const ref=/ref=\{(\w+)\} tabIndex=\{-1\}/.exec(dialog[1])?.[1];
   assert.ok(ref,`${name} puts a ref and tabIndex on its modal dialog element`);
   refs.add(ref);screens.push(name);
  }
  for(const ref of refs)assert.match(source,new RegExp(`useFocusTrap\\(${ref}[,)]`),`${name} traps focus in ${ref}`);
 }
 assert.equal(screens.length,7,'the identity gate, access gate, session lock, logon notice, two recovery panels, and the Sync PDF preview');
 assert.doesNotMatch(files.map(read).join('\n'),/aria-modal="true"(?![^>]*>)|role="alertdialog"/,'no other kind of modal element exists');
});

test('nothing can cover the session lock, and the full-window PDF preview stays above the windows it opens from',()=>{
 const css=readFileSync(new URL('../globals.css',directory),'utf8');
 // Found by plain text search rather than a pattern built from the selector, so no selector needs escaping.
 const layer=(selector:string)=>{
  const start=css.indexOf(`${selector}{`),end=start<0?-1:css.indexOf('}',start),match=end<0?null:/z-index:(\d+)/.exec(css.slice(start,end));
  assert.ok(match,`${selector} has a layer`);return Number(match[1]);
 };
 const lock=layer('.session-lock'),preview=layer('.renamer-preview-overlay');
 // Notifications float above everything so a message is never hidden; every other layer is below the lock.
 for(const below of ['.backdrop','.processing-panel.running','.action-menu[open]','.collision-preview-overlay','.skip-link','.access-mode-gate','.last-logon-notice','.renamer-preview-overlay'])
  assert.ok(layer(below)<lock,`${below} (${layer(below)}) is below the session lock (${lock})`);
 assert.ok(lock<layer('.notification-center'));
 for(const below of ['.backdrop','.collision-preview-overlay','.action-menu[open]','.skip-link'])assert.ok(layer(below)<preview,`${below} is below the PDF preview`);
 const layers=[...css.matchAll(/z-index:(\d+)/g)].map(match=>Number(match[1]));
 assert.ok(Math.max(...layers)<=layer('.notification-center'),'no layer is set above the notification center');
});

test('the focus trap keeps Tab inside the newest screen and yields to an AccessibleModal that holds the focus',()=>{
 const trap=readFileSync(new URL('useFocusTrap.ts',directory),'utf8'),modal=read('AccessibleModal.tsx');
 assert.match(modal,/export const focusableSelector=/,'both use the same definition of a focusable control');
 assert.match(trap,/import \{focusableSelector\} from '\.\/AccessibleModal';/);
 assert.match(trap,/document\.addEventListener\('keydown',onKeyDown,true\)/,'it runs before the page handlers');
 assert.match(trap,/const trap=\[\.\.\.traps\]\.reverse\(\)\.find\(item=>!!item\.current&&item\.current\.isConnected\)/,'only the newest screen on screen acts');
 // Escape belongs to the screen on top: it never reaches a window hidden behind a lock or gate, and it closes
 // only the Sync PDF preview, not the Sync review underneath it.
 assert.match(trap,/if\(event\.key!=='Tab'&&event\.key!=='Escape'\)return;/);
 assert.match(trap,/event\.preventDefault\(\);event\.stopPropagation\(\);escapeActions\.get\(trap\)\?\.\(\);return;/);
 assert.match(read('SyncReview.tsx'),/useFocusTrap\(previewScreen,Boolean\(collisionPreview\.loading\|\|collisionPreview\.error\|\|collisionPreview\.url\),\(\)=>closeCollisionPreview\(\)\);/);
 for(const name of ['SessionPanels.tsx','LastLogonNotice.tsx','LegacyWorkspaceRecoveryPanel.tsx','ReadOnlyRecoveryPanel.tsx'])
  assert.doesNotMatch(read(name),/useFocusTrap\(\w+,[^)]/,`${name} must be answered, so Escape does nothing there`);
 assert.match(trap,/if\(!inside\)stay\(event\.shiftKey\?last:first\);/,'focus that is outside is pulled in');
 assert.match(trap,/else if\(event\.shiftKey&&active===first\)stay\(last\);\s*else if\(!event\.shiftKey&&active===last\)stay\(first\);/);
 assert.match(trap,/if\(otherDialog&&!otherDialog\.contains\(container\)&&!traps\.some\(item=>item\.current===otherDialog\)\)return;/);
 assert.match(trap,/if\(!traps\.length\)document\.removeEventListener\('keydown',onKeyDown,true\)/);
});
