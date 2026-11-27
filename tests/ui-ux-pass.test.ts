import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {addUserBlockers} from '../app/user-update-utils.ts';
import {notificationSummary} from '../app/notification-summary.ts';
import {readPageSource} from './page-source.ts';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const ready={last:'Doe',first:'Jane',organization:'ORG',emailValid:true,privilegedNeeded:false,privilegedValid:false,missingKinds:[] as string[],overrideSelected:false,overrideComment:'',saarReading:false};

test('Add User explains every reason its button is still disabled',()=>{
 assert.deepEqual(addUserBlockers(ready),[]);
 assert.deepEqual(addUserBlockers({...ready,last:' ',organization:'',emailValid:false}),['Last Name','Storage Organization','a valid Official Email']);
 assert.deepEqual(addUserBlockers({...ready,missingKinds:['SAAR','User Agreement']}),['the SAAR (it cannot be overridden)','User Agreement, or check Override Missing Supporting Evidence']);
 assert.deepEqual(addUserBlockers({...ready,missingKinds:['User Agreement'],overrideSelected:true}),['an Override Justification'],'a checked override still needs its justification');
 assert.deepEqual(addUserBlockers({...ready,missingKinds:['User Agreement'],overrideSelected:true,overrideComment:'Documents to follow'}),[],'a justified override clears the supporting-evidence blocker');
 assert.deepEqual(addUserBlockers({...ready,privilegedNeeded:true,saarReading:true}),['a Privileged Username ending in its type, such as name_admin','the SAAR to finish reading']);
 const page=readPageSource();
 assert.match(page,/<p className="add-user-blockers" role="status">Still needed to add this user: \{addUserBlockers\(/);
});

test('an error notice shows its reason instead of repeating its title',()=>{
 assert.equal(notificationSummary('Add user failed for Doe, Jane',['Add user failed for Doe, Jane.','Details: SAAR: The SAAR is not a readable fillable PDF.','Audit: Recorded.']),'SAAR: The SAAR is not a readable fillable PDF.');
 assert.equal(notificationSummary('Sync Completed',['3 updates applied.','Details: none']),'3 updates applied.','a first line that differs from the title is kept');
 assert.equal(notificationSummary('Title',['Title.']),'Title.','without a Details line the first line stays');
});

test('closing a window with unsaved input asks first, for Escape, outside clicks, and the close button',()=>{
 const modal=read('../app/components/AccessibleModal.tsx');
 assert.match(modal,/const requestClose=\(\)=>\{if\(dirty\.current&&!window\.confirm\(unsavedChangesPrompt\)\)return;closeRef\.current\(\)\}/);
 assert.match(modal,/event\.key==='Escape'&&!closeDisabled\)\{event\.preventDefault\(\);requestCloseRef\.current\(\)/);
 assert.match(modal,/event\.target===event\.currentTarget&&!closeDisabled\)requestClose\(\)/);
 assert.match(modal,/className="close"[^>]*onClick=\{requestClose\}/);
 assert.match(modal,/dialog\?\.addEventListener\('input',markDirty\);dialog\?\.addEventListener\('change',markDirty\)/);
});

test('layout fixes keep form text readable and menus and sections usable',()=>{
 const css=read('../app/globals.css');
 assert.match(css,/label :is\(input,select,textarea\)\{font-size:14px;font-weight:500/,'typed values are not inherited as tiny extra-bold label text');
 assert.match(css,/label :is\(small,\.hint\)\{font-weight:500/,'helper text under a field is readable');
 assert.match(css,/\.change-box>:not\(label\)\{grid-column:1\/-1\}/,'information sections span the full width instead of splitting heading and content');
 assert.match(css,/\.action-menu\[open\]\{z-index:30\}/,'an open menu is never covered by the next menu button');
 assert.match(css,/\.dark \.close\{color:var\(--rc-eaf1ed,#eaf1ed\)\}/,'the close button is visible in dark mode');
 assert.match(css,/@media \(min-width:900px\)\{\.toolbar\{flex-wrap:wrap\}\.toolbar>\.system-select\{flex:1 1 360px;min-width:0\}\}/,'the system name is not cut off beside the menus');
 assert.match(css,/\.evidence-picker p small\{display:block/,'the validated filename note is not run into the selected file name');
});

test('Last Results reaches the launcher without a kind on read and save',()=>{
 assert.match(read('../portable-launcher/Program.cs'),/storage\.LastResults\(systemId, parts\[0\], requestBody, OptionalQueryValue\(target, "kind"\)\)/);
});
