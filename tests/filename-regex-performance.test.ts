import test from 'node:test';
import assert from 'node:assert/strict';
import {identityFromFilename,parseDate} from '../app/filename-utils.ts';

// CodeQL flagged two polynomial regular expressions on filename input. Each
// adversarial name below took quadratic time before the fix.
const fast=(label:string,run:()=>void)=>{const start=performance.now();run();const elapsed=performance.now()-start;assert.ok(elapsed<250,`${label} took ${elapsed.toFixed(0)} ms`)};

test('identifier blocking stays linear on long runs of spaces after ID',()=>{
 fast('ID + spaces',()=>parseDate(`ID${' '.repeat(50_000)}x_26AUG2026.pdf`));
 assert.equal(parseDate('Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026_ID_1234567.pdf')?.toISOString(),'2026-08-26T00:00:00.000Z');
 assert.equal(parseDate('Brown_Jacob_ID - 20260826.pdf'),undefined,'an identifier number is never read as a date');
});

test('identity parsing stays linear on long inner runs of separators',()=>{
 fast('tabs',()=>identityFromFilename(`Brown${'\t'.repeat(50_000)}x(LM)_SAAR.pdf`));
 assert.deepEqual(identityFromFilename('Brown_Jacob__ (LM)_GEN_SAAR_26AUG2026.pdf'),identityFromFilename('Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf'));
});
