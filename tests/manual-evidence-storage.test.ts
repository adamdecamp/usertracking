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
 assert.match(store,/evidence-pdf\?organization=/);
 assert.match(store,/pdfUploadBytes=new Uint8Array\(inspected\.pdfBytes\.byteLength\)/);
 assert.match(page,/stage==='evidence'\|\|stage==='evidence-pdf'\|\|stage==='file'\?5\*60\*1000/);
});

test('a late portable write is reconciled from its exact path and SHA-256 receipt',()=>{
 assert.match(store,/reconcilePortableEvidenceWrite/);
 assert.match(store,/reconcilePortablePdfEvidenceWrite/);
 assert.match(store,/error instanceof PortableRequestTimeoutError/);
 assert.match(store,/if\(reconciled\)return reconciled/);
 assert.match(launcher,/action == "evidence-status" && parts\[0\] == "GET"/);
 assert.match(launcher,/action == "evidence-pdf-status" && parts\[0\] == "GET"/);
 assert.match(launcher,/!String\.Equals\(action, "evidence-status", StringComparison\.Ordinal\)/);
 assert.match(storage,/public string VerifyStoredEvidence/);
 assert.match(storage,/public string VerifyStoredEvidencePdf/);
 assert.match(storage,/bool stored = String\.Equals\(actual, expected, StringComparison\.OrdinalIgnoreCase\)/);
});

test('portable manual PDF uploads are compressed by the Windows launcher instead of the browser',()=>{
 assert.match(launcher,/action == "evidence-pdf" && parts\[0\] == "POST"/);
 assert.match(storage,/public string StoreEvidencePdf/);
 assert.match(storage,/LocalPerformanceCacheDirectory\(Root\(systemId\), "Manual Evidence Staging"\)/);
 assert.match(storage,/root = LocalEvidenceRoot\(systemId\)/);
 assert.match(storage,/archive\.CreateEntry\(pdfName, CompressionLevel\.Optimal\)/);
 assert.match(storage,/ValidateEvidenceZip\(output, zipName\)/);
 const portableBranch=store.slice(store.indexOf('if(isPortableRoot(root))'),store.indexOf("const compressed=alreadyCanonical"));
 assert.doesNotMatch(portableBranch,/zipFiles\(/);
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
 assert.match(page,/const emailAdmission=saarEmailAdmission\(emailResult\)/);
 assert.match(page,/if\(!emailAdmission\.allowed\)/);
 assert.match(page,/emailRequired:!emailAdmission\.missingOfficialEmail/);
 assert.match(page,/missingOfficialEmail:emailAdmission\.missingOfficialEmail/);
 assert.match(page,/readOnly=\{!item\.missingOfficialEmail\}/);
 assert.match(page,/Official Email Missing · Manual Entry Required/);
 assert.match(page,/missingEmailUsers=discoveredUsers\.filter\(item=>!failedNewUserIds\.has\(item\.record\.id\)/);
 assert.match(page,/aria-label="Official Email Filter"/);
 assert.match(page,/emailFilter==='Official Email missing'/);
});
