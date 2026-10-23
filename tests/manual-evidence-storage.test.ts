import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const directoryHeader=readFileSync(new URL('../app/components/DirectoryHeader.tsx',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const policy=readFileSync(new URL('../portable-launcher/LauncherPolicy.cs',import.meta.url),'utf8');
const storage=readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8');
const storageRequest=readFileSync(new URL('../app/infrastructure/portable-storage-request.ts',import.meta.url),'utf8');
const store=page.slice(page.indexOf('type StoredEvidenceResult'),page.indexOf('function withStorageMutationTimeout'));

test('manual evidence storage uses bounded stages instead of one composite two-minute timer',()=>{
 const artifact=store.slice(store.indexOf('async function storeEvidenceArtifact'));
 assert.doesNotMatch(artifact,/withOperationTimeout/);
 assert.doesNotMatch(artifact,/standardArtifactFile/);
 assert.match(store,/evidence-pdf\?organization=/);
 assert.match(store,/pdfUploadBytes=new Uint8Array\(inspected\.pdfBytes\.byteLength\)/);
 assert.match(storageRequest,/stage==='evidence'\|\|stage==='evidence-pdf'\|\|stage==='file'\?5\*60\*1000/);
});

test('a late portable write is reconciled from its exact path and SHA-256 receipt',()=>{
 assert.match(store,/reconcilePortableEvidenceWrite/);
 assert.match(store,/reconcilePortablePdfEvidenceWrite/);
 assert.match(store,/error instanceof PortableRequestTimeoutError/);
 assert.match(store,/if\(reconciled\)return reconciled/);
 assert.match(launcher,/action == "evidence-status" && parts\[0\] == "GET"/);
 assert.match(launcher,/action == "evidence-pdf-status" && parts\[0\] == "GET"/);
 assert.match(policy,/!String\.Equals\(action, "evidence-status", StringComparison\.Ordinal\)/);
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

test('manual disable stores a disabled-name SAAR and moves it into the permanent SAAR Archive',()=>{
 assert.match(store,/disabledSaar:kind==='SAAR'&&disabledSaar/);
 assert.match(page,/async function storeAndArchiveDisabledSaar/);
 assert.match(page,/storeEvidenceArtifact\(root,user,'SAAR',file,'Manual Update',true\)/);
 assert.match(page,/archiveFilename:stored\.filename/);
 assert.match(page,/disabledSaarArchive=await storeAndArchiveDisabledSaar\(root,draft,saar\)/);
 assert.match(page,/stored the updated disabled SAAR in the permanent SAAR Archive/);
});

test('manual re-enable restores the newest disabled SAAR to the active folder without the disabled marker',()=>{
 assert.match(page,/async function restoreDisabledSaarForReactivation/);
 assert.match(page,/disabledSaarFilename\(artifact\.filename\)/);
 assert.match(page,/sort\(\(left,right\)=>parseDate\(right\.filename\)!\.getTime\(\)-parseDate\(left\.filename\)!\.getTime\(\)\)\[0\]/);
 assert.match(page,/relocateUserEvidenceFile\(root,located\.path,located\.ref,user,'SAAR',filename\)/);
 assert.match(page,/if\(reactivating&&!replacements\.has\('SAAR'\)\)/);
 assert.match(page,/baseArtifacts=reactivating\?draft\.artifacts/);
 assert.match(page,/restored the disabled SAAR to the active SAAR folder/);
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
 assert.match(directoryHeader,/aria-label="Official Email Filter"/);
 assert.match(page,/emailFilter==='Official Email missing'/);
});

test('User Directory can directly isolate records with a missing SAAR',()=>{
 assert.match(directoryHeader,/aria-label="SAAR Status Filter"/);
 assert.match(directoryHeader,/<option>SAAR missing<\/option>/);
 assert.match(page,/saarFilter==='SAAR missing'\?statusFor\(u,'SAAR',asOf\)==='Missing'/);
 assert.match(page,/setSaarFilter\('All SAAR statuses'\)/);
 assert.match(page,/SAAR \$\{saarFilter\}/);
});
