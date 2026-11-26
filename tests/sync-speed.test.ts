import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PDFDocument} from 'pdf-lib';
import {createEvidenceRechecker,evidenceRecheckConcurrency} from '../app/application/evidence-recheck.ts';
import {keepScanAfterRenames,renamedEvidenceNeedsRescan} from '../app/application/renamed-evidence.ts';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../app/page.tsx'),storage=read('../portable-launcher/PortableStorage.cs');
const syntheticPdf=async()=>{const document=await PDFDocument.create();document.addPage([200,200]);return document.save()};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('the browser content check reads several new files at once and never more than the limit',async()=>{
 const bytes=await syntheticPdf();let reading=0,mostReading=0;
 const recheck=createEvidenceRechecker('Synthetic System');
 const load=async()=>{reading++;mostReading=Math.max(mostReading,reading);await delay(20);reading--;return new File([bytes.slice()],'Doe_Jane_(GOV)_SAAR_01JAN2026.pdf')};
 const results=await Promise.all(Array.from({length:8},(_,index)=>recheck(load,`Doe_Jane_(GOV)_SAAR_0${index+1}JAN2026.pdf`,`Organizations/GOV/Doe_Jane_(GOV)_SAAR_0${index+1}JAN2026.pdf`)));
 assert.equal(results.length,8);
 assert.ok(results.every(result=>result.encryptedPdf===false&&result.file.size===bytes.length));
 assert.equal(evidenceRecheckConcurrency,3);
 assert.ok(mostReading>1,'files should be read in parallel');
 assert.ok(mostReading<=evidenceRecheckConcurrency,`at most ${evidenceRecheckConcurrency} files should be in flight`);
});

test('a damaged file still fails the browser content check and does not block the files after it',async()=>{
 const good=await syntheticPdf(),recheck=createEvidenceRechecker('Synthetic System',undefined,2);
 const damaged=recheck(async()=>new File([new TextEncoder().encode('%PDF-1.7 not a real pdf')],'broken.pdf'),'broken.pdf','Organizations/GOV/broken.pdf');
 const healthy=recheck(async()=>new File([good.slice()],'Doe_Jane_(GOV)_SAAR_01JAN2026.pdf'),'Doe_Jane_(GOV)_SAAR_01JAN2026.pdf','Organizations/GOV/Doe_Jane_(GOV)_SAAR_01JAN2026.pdf');
 await assert.rejects(damaged);
 assert.equal((await healthy).encryptedPdf,false);
});

test('a stopped Sync stops queued content checks',async()=>{
 const controller=new AbortController(),recheck=createEvidenceRechecker('Synthetic System',controller.signal,1),bytes=await syntheticPdf();
 const first=recheck(async()=>{await delay(20);return new File([bytes.slice()],'a.pdf')},'a.pdf','Organizations/GOV/a.pdf'),queued=recheck(async()=>new File([bytes.slice()],'b.pdf'),'b.pdf','Organizations/GOV/b.pdf');
 controller.abort();
 await assert.rejects(first,/stopped/i);await assert.rejects(queued,/stopped/i);
});

test('Sync keeps its first scan when every renamed file was already accepted',()=>{
 const accepted={id:'a',path:'Organizations/GOV/Doe_Jane_(GOV)_SAAR_01JAN2026.pdf',unchanged:true,encryptedPdf:false},other={id:'b',path:'Organizations/GOV/Roe_Sam_(GOV)_SAAR_02JAN2026.pdf',unchanged:true};
 assert.equal(renamedEvidenceNeedsRescan([accepted],[accepted,other]),false);
 const scan={rejected:[{path:'Organizations/GOV/old name.pdf',filename:'old name.pdf'},{path:'Organizations/GOV/kept.pdf',filename:'kept.pdf'}]};
 keepScanAfterRenames(scan,[accepted],new Set(['ORGANIZATIONS/GOV/OLD NAME.PDF']),path=>path.toUpperCase());
 assert.equal(accepted.unchanged,false,'a renamed file counts as new or changed, as a second scan would report it');
 assert.equal(other.unchanged,true);
 assert.deepEqual(scan.rejected.map(item=>item.filename),['kept.pdf']);
});

test('encrypted or previously rejected renamed files still get the full rescan',()=>{
 const accepted={unchanged:false},encrypted={unchanged:false,encryptedPdf:true},rejectedCopy={unchanged:false};
 assert.equal(renamedEvidenceNeedsRescan([accepted,encrypted],[accepted,encrypted]),true);
 assert.equal(renamedEvidenceNeedsRescan([rejectedCopy],[accepted]),true);
 assert.equal(renamedEvidenceNeedsRescan([],[accepted]),false);
});

test('Sync uses the parallel content check and skips the rescan only when it is safe',()=>{
 assert.match(page,/const recheck=createEvidenceRechecker\(dir\.name,signal\),entries=items\.map\(/);
 assert.match(page,/const result=await check;/);
 assert.doesNotMatch(page,/encryptedPdf=await validateReadableOrStrictEncryptedEvidence\(inspected,withoutReworkMarker\(cleanName\),cleanPath,dir\.name\)/);
 assert.match(page,/if\(renamedDuringSync&&!renamedEvidenceNeedsRescan\(renamedForVerification,scanResult\.evidence\)\)\{keepScanAfterRenames\(scanResult,renamedForVerification,normalizedSourcePaths,scanPathKey\);trackReworkValidation\(\)\}else if\(renamedDuringSync\)\{/);
 assert.match(page,/if\(promotedRework&&!renamedEvidenceNeedsRescan\(promotedForVerification,scanResult\.evidence\)\)\{keepScanAfterRenames\(scanResult,promotedForVerification,promotedSourcePaths,scanPathKey\);trackReworkValidation\(\)\}else if\(promotedRework\)\{/);
 assert.equal((page.match(/renamedForVerification\.push\(/g)??[]).length,3);
});

test('the launcher reads a file once to organize it and skips the reread after a same-volume rename',()=>{
 assert.match(storage,/byte\[\] sourceBytes = ReadAllBytesWithRetry\(source, EvidenceLimit\);string validationError;if \(!TryValidateEvidenceBytes\(sourceBytes, source, out validationError\)\)/);
 assert.match(storage,/string sourceHash = Sha256Bytes\(sourceBytes\), transaction = BeginTransaction\(root, "organize"/);
 assert.equal((storage.match(/!MoveKeepsContents\(root, /g)??[]).length,5);
 assert.match(storage,/if \(String\.Equals\(from, to, StringComparison\.OrdinalIgnoreCase\)\) return true;return !IsNetworkRoot\(root\) && String\.Equals\(Path\.GetPathRoot\(from\), Path\.GetPathRoot\(to\), StringComparison\.OrdinalIgnoreCase\) && !ThroughReparsePoint\(from\) && !ThroughReparsePoint\(to\);/);
});
