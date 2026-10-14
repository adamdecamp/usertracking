import {getDocument,PDFWorker,type PDFDocumentProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline';
import {destroyPdfResources} from './pdf-worker-utils.ts';
import {topDownPdfText} from './pdf-text-order.ts';

type PdfTextOptions={signal?:AbortSignal;timeoutMs?:number};
type WorkerSlot={port:Worker;worker:PDFWorker;uses:number;created:number};
const workerPoolLimit=2,workerRecycleUses=50,workerRecycleAgeMs=10*60*1000,availableWorkers:WorkerSlot[]=[],allWorkers=new Set<WorkerSlot>(),workerWaiters:((slot:WorkerSlot)=>void)[]=[];

function createWorkerSlot(){const port=new PdfWorker(),slot={port,worker:PDFWorker.create({port}),uses:0,created:Date.now()};allWorkers.add(slot);return slot}
async function acquireWorker(){const available=availableWorkers.pop();if(available)return available;if(allWorkers.size<workerPoolLimit)return createWorkerSlot();return new Promise<WorkerSlot>(resolve=>workerWaiters.push(resolve))}
function destroyWorkerSlot(slot:WorkerSlot){allWorkers.delete(slot);try{slot.worker.destroy()}catch{}try{slot.port.terminate()}catch{}}
function releaseWorker(slot:WorkerSlot,healthy:boolean){slot.uses++;if(!healthy||slot.uses>=workerRecycleUses||Date.now()-slot.created>=workerRecycleAgeMs){destroyWorkerSlot(slot);if(workerWaiters.length)workerWaiters.shift()!(createWorkerSlot());return}const waiter=workerWaiters.shift();if(waiter)waiter(slot);else availableWorkers.push(slot)}
export function disposePdfWorkerPool(){for(const slot of Array.from(allWorkers))destroyWorkerSlot(slot);availableWorkers.length=0;workerWaiters.length=0}
if(typeof globalThis.addEventListener==='function')globalThis.addEventListener('pagehide',disposePdfWorkerPool,{once:true});

function bounded<T>(operation:Promise<T>,deadline:number,signal?:AbortSignal){
 if(signal?.aborted)return Promise.reject(new DOMException('Sync stopped by the operator.','AbortError'));
 const remaining=deadline-Date.now();if(remaining<=0)return Promise.reject(new Error('PDF text extraction exceeded its 30-second safety limit.'));
 return new Promise<T>((resolve,reject)=>{let settled=false;const finish=(callback:()=>void)=>{if(settled)return;settled=true;globalThis.clearTimeout(timer);signal?.removeEventListener('abort',abort);callback()},abort=()=>finish(()=>reject(new DOMException('Sync stopped by the operator.','AbortError'))),timer=globalThis.setTimeout(()=>finish(()=>reject(new Error('PDF text extraction exceeded its 30-second safety limit.'))),remaining);signal?.addEventListener('abort',abort,{once:true});operation.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)))})
}

export async function extractPdfText(bytes:Uint8Array,maxPages=15,options:PdfTextOptions={}){
 const timeoutMs=Math.max(1000,Math.min(options.timeoutMs??30000,120000)),deadline=Date.now()+timeoutMs,slot=typeof Worker!=='undefined'?await acquireWorker():undefined,parts:string[]=[];let task:ReturnType<typeof getDocument>|undefined,document:PDFDocumentProxy|undefined,healthy=false;
 try{
  task=getDocument(slot?{data:bytes.slice(),worker:slot.worker}:{data:bytes.slice()});
  document=await bounded(task.promise,deadline,options.signal);const totalPages=document.numPages,pages=Math.min(totalPages,maxPages);
  for(let index=1;index<=pages;index++){const page=await bounded(document.getPage(index),deadline,options.signal),content=await bounded(page.getTextContent(),deadline,options.signal),text=topDownPdfText(content.items);if(text)parts.push(text)}
  healthy=true;return{pagesRead:pages,totalPages,text:parts.join('\n')};
 }finally{try{if(document)await bounded(Promise.resolve(document.cleanup()),Math.max(Date.now()+2000,deadline));else await destroyPdfResources(task)}catch{healthy=false}if(slot)releaseWorker(slot,healthy)}
}
