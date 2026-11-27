import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('ESLint 10 runs the Next.js plugins with an explicit React version that matches package.json',()=>{
 const config=read('../eslint.config.mjs'),pkg=JSON.parse(read('../package.json')) as{dependencies:Record<string,string>;devDependencies:Record<string,string>},workspace=read('../pnpm-workspace.yaml');
 assert.match(pkg.devDependencies.eslint,/^10\./);
 assert.match(workspace,/^\s+eslint: "10\.\d+\.\d+"$/m,'the whole tree, including the vendored Next.js config, resolves the same ESLint');
 // eslint-plugin-react's "detect" mode calls context.getFilename(), which ESLint 10 removed, so the version is named here.
 const named=config.match(/settings: \{ react: \{ version: '(\d+\.\d+)' \} \}/);
 assert.ok(named,'eslint.config.mjs names the React version');
 const installed=pkg.dependencies.react.match(/^(\d+\.\d+)\./)?.[1];
 assert.equal(named[1],installed,'update settings.react.version in eslint.config.mjs when React changes');
});
