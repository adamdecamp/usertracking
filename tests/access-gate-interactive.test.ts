import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const panels=readFileSync(new URL('../app/components/SessionPanels.tsx',import.meta.url),'utf8');

test('the access choices stay disabled until the page is interactive, so an early click is never lost',()=>{
 // On a cold start the server-rendered gate appears before React attaches its click handlers. A click in that
 // window used to do nothing and leave the gate open; disabled buttons make the browser (and Playwright) wait.
 assert.match(panels,/function useInteractive\(\)\{return useSyncExternalStore\(noSubscription,\(\)=>true,\(\)=>false\)\}/);
 const gate=panels.slice(panels.indexOf('export function AccessModeGate'),panels.indexOf('export function SessionLock'));
 assert.ok(gate.length>500,'the access gate was found');
 assert.match(gate,/interactive=useInteractive\(\)/);
 assert.match(gate,/<button ref=\{firstAction\} type="button" disabled=\{!interactive\} onClick=\{onReadOnly\}>/);
 assert.match(gate,/<button type="button" className="primary" disabled=\{!interactive\} onClick=\{onFull\}>/);
 assert.match(gate,/<input type="file"[^>]*disabled=\{!interactive\}/);
 assert.match(gate,/useEffect\(\(\)=>\{if\(interactive\)firstAction\.current\?\.focus\(\)\},\[interactive\]\)/,'focus moves to the first choice once it can be used');
});
