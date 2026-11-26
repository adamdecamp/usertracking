import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PDFDocument} from 'pdf-lib';
import {createThrottledValue} from '../app/throttled-value.ts';
import {pageProgressIntervalMs,liveProgressIntervalMs,urgentProcessingChange} from '../app/components/useProcessingStatus.ts';
import {handlePdfCheckRequest,type PdfCheckRequest} from '../app/pdf-check-handler.ts';
import type {ProcessingStatus} from '../app/components/ProcessingPanel.tsx';
import {readPageSource} from './page-source.ts';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const syntheticPdf=async()=>{const document=await PDFDocument.create();document.addPage([200,200]);return document.save()};
/** A separate copy of the client module, so each test starts with its own worker pool. */
const freshClient=(tag:string)=>import(`../app/pdf-check-client.ts?${tag}`) as Promise<typeof import('../app/pdf-check-client.ts')>;
const damaged=new TextEncoder().encode('%PDF-1.7 not a real pdf');

function fakeClock(){
 let time=0;const timers=new Map<number,{at:number;callback:()=>void}>();let nextTimer=1;
 return{now:()=>time,setTimer:(callback:()=>void,ms:number)=>{const id=nextTimer++;timers.set(id,{at:time+ms,callback});return id},clearTimer:(id:unknown)=>{timers.delete(id as number)},
  advance(ms:number){time+=ms;for(const[id,timer]of Array.from(timers))if(timer.at<=time){timers.delete(id);timer.callback()}}};
}

test('progress is published at once, then at most once per interval, with the latest value last',()=>{
 const clock=fakeClock(),value=createThrottledValue(0,1000,clock),seen:number[]=[];value.subscribe(()=>seen.push(value.get()));
 value.set(1);assert.deepEqual(seen,[1],'the first change after a quiet period shows immediately');
 value.set(2);value.set(3);value.set(4);assert.deepEqual(seen,[1],'rapid changes are held back');
 clock.advance(999);assert.deepEqual(seen,[1]);
 clock.advance(1);assert.deepEqual(seen,[1,4],'one trailing update carries the latest value');
 value.set(5,true);assert.deepEqual(seen,[1,4,5],'an urgent change is never delayed');
});

test('a new stage, completion, failure, or dismissal is urgent; only per-item counts are throttled',()=>{
 const running=(phase:string,processed:number):ProcessingStatus=>({title:'Entire System Daily Sync',phase,processed,unit:'files',state:'running'});
 assert.equal(urgentProcessingChange(running('Discovering and Validating Files',1),running('Discovering and Validating Files',2)),false);
 assert.equal(urgentProcessingChange(running('Discovering and Validating Files',9),running('Matching Existing User Records',0)),true);
 assert.equal(urgentProcessingChange(running('Matching Existing User Records',3),{...running('Matching Existing User Records',3),state:'complete'}),true);
 assert.equal(urgentProcessingChange(running('Matching Existing User Records',3),null),true);
 assert.equal(urgentProcessingChange(null,running('Loading',0)),true);
 assert.equal(liveProgressIntervalMs,100);assert.equal(pageProgressIntervalMs,1000);
});

test('the page shows progress through the live panel, so per-file updates redraw only that panel',()=>{
 const page=readPageSource(),hook=read('../app/components/useProcessingStatus.ts'),live=read('../app/components/LiveProcessingStatus.tsx');
 assert.match(page,/<LiveProcessingStatus source=\{processingLive\} history=\{operationHistory\} onDismiss=\{\(\)=>setProcessing\(null\)\} onClearHistory=\{clearOperationHistory\}\/>/);
 assert.doesNotMatch(page,/<ProcessingPanel status=\{processing\}/);
 assert.match(live,/useSyncExternalStore\(source\.subscribe,source\.get,source\.get\)/);
 assert.match(hook,/processingLive\.set\(next,urgent\);processingForPage\.set\(next,urgent\)/);
});

test('a PDF check keeps its result and its error name when sent between threads',async()=>{
 const bytes=await syntheticPdf();
 const ok=await handlePdfCheckRequest({id:7,op:'validate-evidence',bytes,filename:'Doe_Jane_(GOV)_SAAR_01JAN2026.pdf',gateFilename:'Doe_Jane_(GOV)_SAAR_01JAN2026.pdf',path:'Organizations/GOV/Doe_Jane_(GOV)_SAAR_01JAN2026.pdf',rootName:'Synthetic'});
 assert.deepEqual(ok,{id:7,ok:true,value:false});
 const failed=await handlePdfCheckRequest({id:8,op:'validate-evidence',bytes:damaged,filename:'broken.pdf',gateFilename:'broken.pdf',path:'Organizations/GOV/broken.pdf',rootName:'Synthetic'});
 assert.equal(failed.id,8);assert.equal(failed.ok,false);
 const fields=await handlePdfCheckRequest({id:9,op:'saar-fields',bytes});
 assert.equal(fields.ok,true);assert.equal((fields as {value:{fillable:boolean}}).value.fillable,false);
});

/** A stand-in for a browser Worker that answers through the real request handler, or fails to start. */
function installFakeWorker(mode:'works'|'fails'){
 const stats={created:0,busy:0,mostBusy:0,terminated:0};
 class FakeWorker{
  onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:{preventDefault():void})=>void)|null=null;
  constructor(){stats.created++}
  postMessage(request:PdfCheckRequest){
   if(mode==='fails'){setTimeout(()=>this.onerror?.({preventDefault(){}}),1);return}
   stats.busy++;stats.mostBusy=Math.max(stats.mostBusy,stats.busy);
   void handlePdfCheckRequest(request).then(response=>setTimeout(()=>{stats.busy--;this.onmessage?.({data:response})},5));
  }
  terminate(){stats.terminated++}
 }
 (globalThis as {Worker?:unknown}).Worker=FakeWorker;
 return stats;
}

test('PDF checks run in a small pool of background workers',async()=>{
 const stats=installFakeWorker('works');
 try{
  const client=await freshClient('pool-works');
  const bytes=await syntheticPdf(),limit=client.pdfCheckParallelism();
  assert.ok(limit>=1&&limit<=3);
  const results=await Promise.all(Array.from({length:6},(_,index)=>client.validateEvidenceOffThread(bytes,`f${index}.pdf`,`f${index}.pdf`,`Organizations/GOV/f${index}.pdf`,'Synthetic')));
  assert.deepEqual(results,[false,false,false,false,false,false]);
  assert.ok(stats.created<=limit,'no more workers than the limit are started');
  assert.ok(stats.mostBusy<=limit);
  await assert.rejects(client.validateEvidenceOffThread(damaged,'broken.pdf','broken.pdf','Organizations/GOV/broken.pdf','Synthetic'));
  client.disposePdfCheckWorkers();
 }finally{delete (globalThis as {Worker?:unknown}).Worker}
});

test('a stopped check ends its worker, and later checks still work',async()=>{
 installFakeWorker('works');
 try{
  const client=await freshClient('pool-abort'),bytes=await syntheticPdf(),controller=new AbortController();
  const stopped=client.validateEvidenceOffThread(bytes,'a.pdf','a.pdf','Organizations/GOV/a.pdf','Synthetic',controller.signal);
  await new Promise(resolve=>setTimeout(resolve,0));controller.abort();
  await assert.rejects(stopped,/stopped/i);
  assert.equal(await client.validateEvidenceOffThread(bytes,'b.pdf','b.pdf','Organizations/GOV/b.pdf','Synthetic'),false);
  client.disposePdfCheckWorkers();
 }finally{delete (globalThis as {Worker?:unknown}).Worker}
});

test('when a worker cannot start, checks fall back to the page thread with the same results',async()=>{
 installFakeWorker('fails');
 try{
  const client=await freshClient('pool-fails'),bytes=await syntheticPdf();
  const results=await Promise.all([client.validateEvidenceOffThread(bytes,'a.pdf','a.pdf','Organizations/GOV/a.pdf','Synthetic'),client.readSaarFieldsOffThread(bytes)]);
  assert.equal(results[0],false);assert.equal(results[1].fillable,false);
  assert.equal(client.pdfCheckParallelism(),1,'workers are turned off after a failed start');
  await assert.rejects(client.validateEvidenceOffThread(damaged,'broken.pdf','broken.pdf','Organizations/GOV/broken.pdf','Synthetic'));
 }finally{delete (globalThis as {Worker?:unknown}).Worker}
});

test('the worker ships as its own same-origin script, which the launcher security policy allows',()=>{
 const client=read('../app/pdf-check-client.ts'),saar=read('../app/application/saar-reader.ts'),page=readPageSource(),recheck=read('../app/application/evidence-recheck.ts');
 assert.match(client,/new Worker\(new URL\('\.\/workers\/pdf-check\.worker\.ts',import\.meta\.url\),\{type:'module'\}\)/);
 assert.doesNotMatch(client,/\?worker&inline/);
 const pdfText=read('../app/pdf-text.ts');
 assert.match(pdfText,/import PdfWorker from 'pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?worker';/,'the text-extraction worker must not be an inline blob: worker, which the launcher policy blocks');
 assert.doesNotMatch(pdfText,/\?worker&inline/);
 assert.match(saar,/readSaarFieldsOffThread\(bytes,signal\)/);
 assert.match(page,/const readSaarFormFields=async\(bytes:Uint8Array\)=>\(await import\('\.\/pdf-check-client'\)\)\.readSaarFieldsOffThread\(bytes\);/);
 assert.match(recheck,/validateEvidenceOffThread\(loaded\.bytes,filename,withoutReworkMarker\(filename\),path,rootName,operationSignal\)/);
});
