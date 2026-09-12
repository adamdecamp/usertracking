import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const apply=page.slice(page.indexOf('async function applyVerifiedSync'),page.indexOf('function resetFilters'));

test('Verified Sync isolates per-file provenance failures and commits successful work',()=>{
 assert.doesNotMatch(apply,/selected evidence file\(s\) could not be verified[\s\S]*?throw new Error/);
 assert.match(apply,/const provenanceFailures=provenanceResult\.failures\.map/);
 assert.match(apply,/eligibleStructuralUsers=structuralUsers\.filter/);
 assert.match(apply,/remainingCandidates=pendingSync\.candidates\.filter/);
 assert.match(apply,/remainingNewUsers=discoveredUsers\.filter/);
 assert.match(apply,/current Sync review and Clean Up actions were preserved/);
});

test('a partial verification failure leaves the scan index retryable',()=>{
 assert.match(apply,/if\(!provenanceFailures\.length\)await commitSyncRuns/);
 assert.match(apply,/failed evidence update/);
 assert.match(apply,/available for retry without rescanning/);
});

test('Sync reads and applies Official Email for an existing record with a blank email',()=>{
 assert.match(page,/if\(!existing\.email\.trim\(\)\)\{read\?\?=await readSaar\(evidence\.ref,controller\.signal,true\)/);
 assert.match(page,/Official Email belongs to another User Directory record/);
 assert.match(page,/\.\.\.\(detectedEmail\?\{email:detectedEmail\}:\{\}\)/);
 assert.match(apply,/email=matches\.find\(match=>match\.email\)\?\.email\?\?user\.email/);
 assert.match(page,/Official Email Detected/);
});
