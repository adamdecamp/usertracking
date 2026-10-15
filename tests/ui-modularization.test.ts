import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';

const page=fs.readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8'),session=fs.readFileSync(new URL('../app/components/SessionPanels.tsx',import.meta.url),'utf8');

test('session and access-mode panels are isolated from the main workflow module',()=>{
 assert.match(page,/import \{AccessModeGate,SessionLock\} from '\.\/components\/SessionPanels'/);
 assert.match(page,/<AccessModeGate/);
 assert.match(page,/<SessionLock/);
 assert.match(session,/export function AccessModeGate/);
 assert.match(session,/export function SessionLock/);
});
