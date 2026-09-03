import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('allows only local and generated PDF frames while retaining frame-ancestor protection',()=>{
 for(const policySource of [source('../next.config.ts'),source('../portable-launcher/Program.cs')]){
  assert.match(policySource,/frame-src 'self' blob:/);
  assert.match(policySource,/frame-ancestors 'none'/);
  assert.match(policySource,/object-src 'none'/);
 }
});
