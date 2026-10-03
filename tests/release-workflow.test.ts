import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import test from 'node:test';

const validation=readFileSync(new URL('../.github/workflows/security-build.yml',import.meta.url),'utf8');
const release=readFileSync(new URL('../.github/workflows/signed-release.yml',import.meta.url),'utf8');
const buildScript=readFileSync(new URL('../scripts/build-portable.ps1',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const portableIndex=readFileSync(new URL('../portable/index.html',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const layout=readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8');
const guide=readFileSync(new URL('../app/user-guide/page.tsx',import.meta.url),'utf8');
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

test('packages the R.A.P.T.O.R. brand and application icons consistently',()=>{
 for(const source of [validation,release,buildScript]){
  assert.match(source,/RAPTOR\.exe/);
  assert.match(source,/RAPTOR-Executive-Capability-Summary\.pdf/);
  assert.doesNotMatch(source,/InformationSystemUserTracker\.exe/);
 }
 assert.match(buildScript,/win32icon:\$icon/);
 assert.match(buildScript,/Tracker\.Favicon/);
 assert.match(buildScript,/Tracker\.BrandLogo/);
 assert.match(layout,/favicon\.ico\?v=\$\{iconVersion\}/);
 assert.match(portableIndex,/favicon\.ico\?v=1\.2\.85/);
 assert.match(launcher,/path == "\/favicon\.ico" \|\| path == "\/raptor-icon\.png"/);
 assert.match(launcher,/result\.Add\("\/raptor-icon\.png", new WebAsset \{ Bytes = LoadResource\("Tracker\.BrandLogo"\), ContentType = "image\/png" \}\)/);
 assert.match(page,/archived\.blockingErrors\.length/);
 assert.match(page,/Delete user completed with missing evidence files/);
 assert.match(page,/Disable user completed with missing evidence files/);
 assert.match(page,/<h1>R\.A\.P\.T\.O\.R\.<\/h1>/);
 assert.match(page,/Role-Based Access Personnel Tracking &amp; Oversight Registry/);
 assert.match(page,/src="\/raptor-icon\.png"/);
 assert.match(layout,/R\.A\.P\.T\.O\.R\. — Role-Based Access Personnel Tracking & Oversight Registry/);
 assert.match(guide,/R\.A\.P\.T\.O\.R\. User Guide/);
 assert.match(guide,/src="\/raptor-icon\.png"/);
 for(const asset of ['../public/raptor-icon.png','../public/favicon.ico','../portable-launcher/RAPTOR.ico']){
  const url=new URL(asset,import.meta.url);
  assert.equal(existsSync(url),true,asset);
  assert.ok(statSync(url).size>1000,asset);
 }
});
