import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const advancedCodeqlWorkflow=new URL('../.github/workflows/codeql.yml',import.meta.url);
const workflow=readFileSync(new URL('../.github/workflows/security-build.yml',import.meta.url),'utf8');

test('GitHub default CodeQL is not duplicated and the release workflow keeps pinned least-privilege security gates',()=>{
 assert.equal(existsSync(advancedCodeqlWorkflow),false,'GitHub default CodeQL setup must not be combined with an advanced CodeQL workflow');
 assert.match(workflow,/contents: read/);
 assert.match(workflow,/pnpm audit --audit-level low/);
 assert.match(workflow,/pnpm lint/);
 assert.match(workflow,/pnpm exec playwright test/);
 assert.match(workflow,/actions\/checkout@[0-9a-f]{40}/);
 assert.match(workflow,/actions\/upload-artifact@[0-9a-f]{40}/);
 assert.doesNotMatch(workflow,/uses:\s+[^\s]+@v\d/m);
});
