import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const storage=readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
const store=page.slice(page.indexOf('type StoredEvidenceResult'),page.indexOf('function withStorageMutationTimeout'));

test('manual evidence storage uses bounded stages instead of one composite two-minute timer',()=>{
 const artifact=store.slice(store.indexOf('async function storeEvidenceArtifact'));
 assert.doesNotMatch(artifact,/withOperationTimeout/);
 assert.doesNotMatch(artifact,/standardArtifactFile/);
 assert.match(store,/const sha256=await sha256Bytes\(writeBytes\),path=evidenceStoragePath/);
 assert.match(page,/stage==='evidence'\?5\*60\*1000/);
});

test('a late portable write is reconciled from its exact path and SHA-256 receipt',()=>{
 assert.match(store,/reconcilePortableEvidenceWrite/);
 assert.match(store,/error instanceof PortableRequestTimeoutError/);
 assert.match(store,/if\(reconciled\)return reconciled/);
 assert.match(launcher,/action == "evidence-status" && parts\[0\] == "GET"/);
 assert.match(launcher,/!String\.Equals\(action, "evidence-status", StringComparison\.Ordinal\)/);
 assert.match(storage,/public string VerifyStoredEvidence/);
 assert.match(storage,/bool stored = String\.Equals\(actual, expected, StringComparison\.OrdinalIgnoreCase\)/);
});

test('missing supporting evidence does not change the single-SAAR storage path',()=>{
 const addUser=page.slice(page.indexOf('function AddUser'),page.indexOf('function UserModal'));
 assert.match(addUser,/const uploadedKinds=required\.filter\(kind=>!!uploads\[kind\]\)/);
 assert.match(addUser,/for\(const kind of uploadedKinds\)artifacts\.push\(await storeEvidenceArtifact/);
 assert.match(addUser,/missing evidence override/);
});

test('encrypted evidence requires the complete filename gate in manual storage and Sync',()=>{
 assert.match(store,/validateReadableOrStrictEncryptedEvidence\(inspected,source\.name,sourcePath/);
 assert.match(store,/last:user\.last,first:user\.first,organization:user\.organization,kind/);
 assert.match(page,/const activeSaarEvidence=scanResult\.evidence\.filter\(item=>!item\.encryptedPdf/);
 assert.match(page,/emailResult\.error&&!emailResult\.encryptedFilenameOverride/);
 assert.match(page,/emailRequired:!emailResult\.encryptedFilenameOverride/);
});
