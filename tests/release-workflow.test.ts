import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const validation=readFileSync(new URL('../.github/workflows/security-build.yml',import.meta.url),'utf8');
const release=readFileSync(new URL('../.github/workflows/signed-release.yml',import.meta.url),'utf8');
const attestAction='actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6';

test('retries transient GitHub attestation service failures without weakening the final gate',()=>{
 for(const workflow of [validation,release]){
  assert.match(workflow,/id: attest_sbom\s+continue-on-error: true/);
  assert.match(workflow,/steps\.attest_sbom\.outcome == 'failure'/);
  assert.match(workflow,/id: attest_release\s+continue-on-error: true/);
  assert.match(workflow,/steps\.attest_release\.outcome == 'failure'/);
  assert.equal(workflow.split(attestAction).length-1,4);
 }
 assert.match(validation,/Retry build provenance and SBOM attestation[\s\S]*?sbom-path:/);
 assert.match(validation,/Retry release build provenance attestation[\s\S]*?SHA256SUMS\.txt/);
 assert.match(release,/Retry signed executable and SBOM attestation[\s\S]*?sbom-path:/);
 assert.match(release,/Retry signed release provenance attestation[\s\S]*?SHA256SUMS\.txt/);
});
