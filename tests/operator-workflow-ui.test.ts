import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const page=readFileSync('app/page.tsx','utf8');
const operatorHeader=readFileSync('app/components/OperatorDashboardHeader.tsx','utf8');
const chrome=`${page}\n${operatorHeader}`;
const styles=readFileSync('app/globals.css','utf8');
const guide=readFileSync('app/user-guide/page.tsx','utf8');
const modal=readFileSync('app/components/AccessibleModal.tsx','utf8');
const notifications=readFileSync('app/components/NotificationCenter.tsx','utf8');
const confirmations=readFileSync('app/components/ConfirmationCenter.tsx','utf8');
const history=readFileSync('app/components/useProcessingStatus.ts','utf8');
const directory=readFileSync('app/components/DirectoryHeader.tsx','utf8');

test('routine actions are separated from administration, reporting, and system tools',()=>{
 assert.match(chrome,/daily-actions/);
 assert.match(chrome,/<summary>User Administration<\/summary>/);
 assert.match(chrome,/<summary>Reports &amp; Oversight<\/summary>/);
 assert.match(chrome,/<summary>System Tools<\/summary>/);
 assert.match(styles,/\.action-menu/);
});

test('local changes and the last five operations remain visible',()=>{
 assert.match(chrome,/<SessionChangeIndicator summary=\{props\.sessionChanges\}/);
 assert.match(page,/<OperationHistory current=\{processing\}/);
 assert.match(history,/\.slice\(0,5\)/);
 assert.match(page,/'workspace-status'/);
});

test('dialogs trap focus, close with Escape, and restore focus',()=>{
 assert.match(modal,/focusableSelector/);
 assert.match(modal,/event\.key==='Escape'/);
 assert.match(modal,/event\.key!=='Tab'/);
 assert.match(modal,/returnFocus\.current\?\.focus/);
 assert.match(page,/<AccessibleModal label="Choose Sync Scope"/);
 assert.doesNotMatch(page,/className="backdrop" onMouseDown/);
});

test('operator notices are nonblocking and blocking browser alerts are absent',()=>{
 assert.match(page,/<NotificationCenter\/>/);
 assert.match(notifications,/aria-label="Notifications"/);
 assert.doesNotMatch(page,/(?:window\.)?alert\(/);
});

test('directory choices persist without retaining the search text',()=>{
 assert.match(page,/directoryPreferencesKey/);
 assert.match(page,/visibleColumnKinds/);
 assert.match(directory,/<summary>Columns<\/summary>/);
 const persisted=page.match(/localStorage\.setItem\(directoryPreferencesKey,JSON\.stringify\(\{([^}]*)\}\)\)/)?.[1]??'';
 assert.doesNotMatch(persisted,/\bquery\b/,'Free-text searches can contain PII and must remain session-only.');
 assert.match(styles,/\.directory \.table-wrap th:nth-child\(1\)/);
});

test('high-impact operations use reviewed confirmation summaries',()=>{
 assert.match(page,/requestConfirmation\(\{title:`Delete \$\{system\.name\}\?`/);
 assert.match(page,/requestConfirmation\(\{title:`Delete \$\{user\.last\}, \$\{user\.first\}\?`/);
 assert.match(page,/title:statusChange\?\(user\.disabled\?'Re-enable User':'Disable User'\):'Modify User Privileges'/);
 assert.match(confirmations,/confirmation-impact/);
});

test('read-only mode is unmistakable and documented',()=>{
 assert.match(page,/read-only-mode/);
 assert.match(chrome,/className="read-only-banner"/);
 assert.match(styles,/\.read-only-mode/);
 assert.match(guide,/Dashboard Navigation and Status/);
 assert.match(guide,/Read-Only Access is identified by a persistent banner/);
});
