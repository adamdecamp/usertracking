import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/codeql.yml',import.meta.url),'utf8');
const config=readFileSync(new URL('../.github/codeql-config.yml',import.meta.url),'utf8');

test('CodeQL analyzes both application languages with pinned actions and least privilege',()=>{
 assert.match(workflow,/security-events: write/);
 assert.match(workflow,/contents: read/);
 assert.match(workflow,/language: javascript-typescript/);
 assert.match(workflow,/language: csharp/);
 assert.match(workflow,/github\/codeql-action\/init@24c54180a607b1449ed407dd24f251e4e9147c8d # v4\.38\.3/);
 assert.match(workflow,/github\/codeql-action\/analyze@24c54180a607b1449ed407dd24f251e4e9147c8d # v4\.38\.3/);
 assert.doesNotMatch(workflow,/github\/codeql-action\/(?:init|analyze)@v\d/);
 assert.match(config,/security-extended/);
 assert.match(config,/security-and-quality/);
});
