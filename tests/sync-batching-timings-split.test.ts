import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {evidenceMoveBatchSize,evidenceMoveOutcomes,runEvidenceMoveBatches,settleEach,type EvidenceMoveOutcome} from '../app/application/evidence-move-batch.ts';
import {formatStepDuration,slowestStep,trackProcessingStep,type StepTimeline} from '../app/processing-steps.ts';
import {SessionLeaseLostError} from '../app/portable-request-utils.ts';
import {readPageSource} from './page-source.ts';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../app/page.tsx'),pageAll=readPageSource(),session=read('../app/storage-session.ts'),system=read('../app/system-storage.ts'),evidence=read('../app/evidence-storage.ts');

test('file moves are sent in batches and every file is handled in its original order',async()=>{
 const sent:number[][]=[],seen:string[]=[],items=Array.from({length:23},(_,index)=>index);
 await runEvidenceMoveBatches(items,async batch=>{sent.push(batch);return batch.map(value=>({ok:true,value:value*2}) as EvidenceMoveOutcome<number>)},(item,outcome,index)=>{assert.equal(index,item);seen.push(outcome.ok?`${item}:${outcome.value}`:'failed')});
 assert.equal(evidenceMoveBatchSize,10);
 assert.deepEqual(sent.map(batch=>batch.length),[10,10,3]);
 assert.deepEqual(seen,items.map(item=>`${item}:${item*2}`));
});

test('a failed batch request is recorded against each of its files, and later batches still run',async()=>{
 const outcomes:string[]=[];let calls=0;
 await runEvidenceMoveBatches([1,2,3,4],async batch=>{calls++;if(calls===1)throw new Error('launcher stopped responding');return batch.map(value=>({ok:true,value}))},(item,outcome)=>{outcomes.push(outcome.ok?`ok ${item}`:`${item}: ${outcome.error.message}`)},{size:2});
 assert.deepEqual(outcomes,['1: launcher stopped responding','2: launcher stopped responding','ok 3','ok 4']);
});

test('stopping Sync between batches stops before the next request',async()=>{
 let requests=0,stop=false;
 await assert.rejects(runEvidenceMoveBatches([1,2,3,4],async batch=>{requests++;return batch.map(value=>({ok:true,value}))},()=>{stop=true},{size:2,beforeBatch:()=>{if(stop)throw new DOMException('Sync stopped by the operator.','AbortError')}}),/stopped/);
 assert.equal(requests,1);
});

test('launcher batch results keep each file result, error, and a lost lease',()=>{
 const outcomes=evidenceMoveOutcomes([{ok:true,result:{organized:'Organizations/GOV/GOV SAAR/a.pdf'}},{ok:false,error:'The selected evidence file no longer exists.'},{ok:false,leaseLost:true,error:'The exclusive Full Access lease was lost, so this file was not changed.'},{}],4,(value:{organized:string})=>value.organized);
 assert.deepEqual(outcomes[0],{ok:true,value:'Organizations/GOV/GOV SAAR/a.pdf'});
 assert.equal(!outcomes[1].ok&&outcomes[1].error.message,'The selected evidence file no longer exists.');
 assert.ok(!outcomes[2].ok&&outcomes[2].error instanceof SessionLeaseLostError);
 assert.equal(!outcomes[3].ok&&outcomes[3].error.message,'The evidence file could not be changed.');
 assert.throws(()=>evidenceMoveOutcomes([{ok:true,result:{}}],2,value=>value),/does not match the request/);
});

test('browser folders still move one file at a time with the same per-file results',async()=>{
 const outcomes=await settleEach([1,2,3],async value=>{if(value===2)throw new Error('locked');return value});
 assert.deepEqual(outcomes.map(outcome=>outcome.ok?outcome.value:outcome.error.message),[1,'locked',3]);
});

test('Sync organizes and renames through the batch endpoints',()=>{
 assert.equal((pageAll.match(/await runEvidenceMoveBatches\(/g)??[]).length,8,'Sync organization, normalization, and Renamer rules; Clean Up Rework, ZIP, and Archive; Unarchive; and Session Commit archives are batched');
 assert.match(page,/organizeEvidenceBatch\(h,batch\.map\(entry=>\(\{candidate:entry\.item,folder:entry\.folder\}\)\),signal\)/);
 assert.match(page,/normalizeEvidenceDateBatch\(h,batch\.map\(entry=>\(\{candidate:entry\.item,target:entry\.target\}\)\),signal\)/);
 assert.match(page,/normalizeEvidenceDateBatch\(h,batch\.map\(item=>\(\{candidate:item,target:plan\.targets\.get\(item\.id\)!\}\)\),signal\)/);
 assert.equal((page.match(/beforeBatch:\(\)=>throwIfSyncCancelled\(controller\.signal\)/g)??[]).length,3);
 assert.doesNotMatch(page,/withStorageMutationTimeout\(`\$\{fromRework\?'Promoting corrected':'Organizing'\}/);
 assert.match(evidence,/portableRequest\(root,'organize-batch',\{method:'POST'/);
 assert.match(evidence,/portableRequest\(root,'normalize-batch',\{method:'POST'/);
 assert.match(evidence,/if\(!isPortableRoot\(root\)\)return settleEach\(moves,move=>organizeEvidence\(root,move\.candidate,move\.folder\)\)/);
 const request=read('../app/infrastructure/portable-storage-request.ts'),launcher=read('../portable-launcher/Program.cs'),batches=read('../portable-launcher/PortableBatchMoves.cs');
 assert.match(request,/stage==='organize-batch'\|\|stage==='normalize-batch'\|\|stage==='evidence-batch'\?networkWriteTimeoutMs/);
 assert.match(launcher,/action == "organize-batch" \|\| action == "normalize-batch" \|\| action == "evidence-batch"\) && parts\[0\] == "POST"/);
 assert.match(batches,/BatchLeaseRecheckInterval = TimeSpan\.FromSeconds\(30\)/);
 assert.match(batches,/string moved = move\(item\);/,'a failing file never leaves a half-written success entry');
});

test('Clean Up, Unarchive, and Session Commit archive files in batches through one allowlisted endpoint',()=>{
 for(const helper of ['reworkEvidenceBatch(pendingSync.handle,batch,signal)','compressEvidenceBatch(pendingSync.handle,batch,signal)','archiveEvidenceBatch(pendingSync.handle,batch,signal)','unarchiveEvidenceBatch(root,batch.map(item=>item.path))','archiveMany:(owner,artifacts)=>archiveArtifactsBatch(root,owner,artifacts)'])assert.ok(pageAll.includes(helper),helper);
 assert.doesNotMatch(pageAll,/portableRequest\(root,`unarchive\?path=/);
 assert.doesNotMatch(page,/withStorageMutationTimeout\(`Marking \$\{candidate\.filename\} REWORK`/);
 assert.match(evidence,/portableRequest\(root,'evidence-batch',\{method:'POST'/);
 assert.match(evidence,/if\(!isPortableRoot\(root\)\)return settleEach\(candidates,candidate=>archiveEvidence\(root,candidate,signal,allowReworkSource\)\)/);
 const batches=read('../portable-launcher/PortableBatchMoves.cs'),policy=read('../portable-launcher/LauncherPolicy.cs');
 assert.match(batches,/if \(action == "archive"\)[\s\S]*?if \(action == "rework"\) return MoveEvidenceToRework[\s\S]*?if \(action == "compress"\) return CompressEvidence[\s\S]*?if \(action == "unarchive"\) return UnarchiveEvidence[\s\S]*?throw new InvalidDataException\("The evidence batch action is not supported\."\)/);
 assert.match(policy,/action == "evidence-batch"\) return 256L \* KiB/);
});

test('an operation records how long each stage took and reports it when it finishes',()=>{
 let timeline:StepTimeline|null=null;const running=(phase:string)=>({title:'Entire System Daily Sync',phase,state:'running' as const});
 timeline=trackProcessingStep(timeline,running('Discovering and Validating Files'),0).timeline;
 timeline=trackProcessingStep(timeline,running('Discovering and Validating Files'),400).timeline;
 timeline=trackProcessingStep(timeline,running('Organizing Evidence by Document Type'),1500).timeline;
 timeline=trackProcessingStep(timeline,running('Discovering and Validating Files'),1800).timeline;
 const finished=trackProcessingStep(timeline,{title:'Entire System Daily Sync',phase:'Sync Complete',state:'complete'},2100);
 assert.equal(finished.timeline,null);
 assert.deepEqual(finished.steps,[{phase:'Discovering and Validating Files',ms:1800},{phase:'Organizing Evidence by Document Type',ms:300}]);
 assert.deepEqual(slowestStep(finished.steps!),{phase:'Discovering and Validating Files',ms:1800});
 assert.equal(trackProcessingStep(null,{title:'Other',phase:'Done',state:'complete'},5).steps,undefined,'a finish without a tracked start reports no steps');
 const other=trackProcessingStep(trackProcessingStep(null,running('A'),0).timeline,{title:'Storage Verification',phase:'B',state:'running'},10);
 assert.equal(other.timeline?.title,'Storage Verification','a new operation starts a new timeline');
 assert.equal(formatStepDuration(400),'0.4 s');assert.equal(formatStepDuration(9_949),'9.9 s');assert.equal(formatStepDuration(75_000),'1:15');assert.equal(formatStepDuration(3_725_000),'1:02:05');
});

test('the finished status and Recent Activity show the step timings',()=>{
 const hook=read('../app/components/useProcessingStatus.ts'),panel=read('../app/components/ProcessingPanel.tsx'),history=read('../app/components/OperationHistory.tsx');
 assert.match(hook,/const tracked=trackProcessingStep\(timelineRef\.current,requested,Date\.now\(\)\)/);
 assert.match(hook,/completedAt:new Date\(\)\.toISOString\(\),steps:next\.steps/);
 assert.match(panel,/\{status\.state!=='running'&&<ProcessingSteps steps=\{status\.steps\}\/>\}/);
 assert.match(panel,/if\(!steps\|\|steps\.length<2\)return null/);
 assert.match(history,/Slowest step: \$\{slowest\.phase\}/);
});

test('the page storage code is split into layered modules without circular imports',()=>{
 const importsOf=(source:string)=>[...source.matchAll(/from '\.\/([\w-]+)'/g)].map(match=>match[1]);
 assert.deepEqual(importsOf(session).filter(name=>['page','system-storage','evidence-storage'].includes(name)),[],'the session module depends on nothing above it');
 assert.deepEqual(importsOf(system).filter(name=>['page','evidence-storage'].includes(name)),[],'system storage depends only on the session module');
 assert.ok(importsOf(system).includes('storage-session'));
 assert.ok(importsOf(evidence).includes('storage-session')&&importsOf(evidence).includes('system-storage'));
 assert.doesNotMatch(`${session}${system}${evidence}`,/from '\.\/page'/);
 for(const name of ['storage-session','system-storage','evidence-storage'])assert.match(page,new RegExp(`from './${name}';`));
 assert.match(session,/export async function requireActiveLease/);
 assert.match(system,/export async function verifyMappedStorageHealth/);
 assert.match(evidence,/export async function organizeEvidence/);
 assert.match(page,/const starterSystems:/,'release-clean starter data stays in the page');
 assert.doesNotMatch(page,/async function organizeEvidence\(|async function readManifest\(|async function requireActiveLease\(/);
});
test('large pop-up windows load on first use, inside their own Suspense boundary, and are preloaded when idle',()=>{
 const popups=['SyncReview','DocumentRenamerModal','SystemsModal','EvidenceUnarchiveModal','AddUser','UserModal','MessageAutomation','ComplianceReportModal'];
 for(const name of popups){
  assert.match(page,new RegExp(`${name}=lazy\\(\\(\\)=>import\\('\\./components/${name}'\\)\\.then\\(module=>\\(\\{default:module\\.${name}\\}\\)\\)\\)`),`${name} is lazy`);
  assert.match(page,new RegExp(`void import\\('\\./components/${name}'\\);`),`${name} is preloaded`);
  assert.doesNotMatch(page,new RegExp(`function ${name}\\(`),`${name} is no longer defined in page.tsx`);
  assert.doesNotMatch(page,new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\./components/${name}'`),`${name} is not imported eagerly`);
 }
 for(const name of [...popups,'RestoreModal','AuditLogModal','OperatorDirectoryModal','ReconciliationModal','RecoveryCenterLayer']){
  const at=page.indexOf(`<${name} `)>=0?page.indexOf(`<${name} `):page.indexOf(`<${name}/>`);assert.ok(at>0,`${name} is rendered`);
  assert.ok(page.slice(at-26,at)==='<Suspense fallback={null}>',`${name} has its own Suspense boundary, so loading it never blanks the page`);
 }
 assert.match(page,/useEffect\(\(\)=>\{const idle=\(globalThis as \{requestIdleCallback\?:[\s\S]{0,200}?idle\(preloadPopupWindows,\{timeout:5000\}\)/);
});
