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

// A PowerShell step fails only on the exit code of its last command. Two tool commands in one step would let the
// first fail without stopping the workflow, so every gate must be a step of its own in both workflows.
test('no workflow step runs more than one tool command, so every gate can stop the build',()=>{
 const tool=/^(?:pnpm|npm|npx|node|git|dotnet|\.\/scripts\/|\.\\scripts\\)/;
 for(const name of ['security-build.yml','signed-release.yml']){
  const lines=readFileSync(new URL(`../.github/workflows/${name}`,import.meta.url),'utf8').split(/\r?\n/);
  lines.forEach((line,index)=>{
   const block=/^(\s*)run: \|\s*$/.exec(line);if(!block)return;
   const body:string[]=[];
   for(let next=index+1;next<lines.length&&(lines[next].trim()===''||lines[next].startsWith(`${block[1]}  `));next++)body.push(lines[next].trim());
   const commands=body.filter(item=>tool.test(item));
   assert.ok(commands.length<=1,`${name} line ${index+1} runs ${commands.length} tool commands in one step: ${commands.join(' ; ')}`);
  });
  for(const gate of ['pnpm audit --audit-level low --ignore GHSA-fc5q-39xc-vjpf','pnpm lint','pnpm test','pnpm build','pnpm exec playwright test','./scripts/Test-NetworkShareChaos.ps1','./scripts/Test-NetworkPerformance.ps1','./scripts/build-portable.ps1','./scripts/Test-ReleaseClean.ps1'])
   assert.ok(lines.some(line=>line.trim()===`run: ${gate}`),`${name} runs "${gate}" as a step of its own`);
 }
});
