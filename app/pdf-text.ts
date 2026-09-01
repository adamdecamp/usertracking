import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline';

if(typeof Worker!=='undefined'&&!GlobalWorkerOptions.workerPort)GlobalWorkerOptions.workerPort=new PdfWorker();

type PdfTextOptions={signal?:AbortSignal;timeoutMs?:number};

function bounded<T>(operation:Promise<T>,deadline:number,signal?:AbortSignal){
 if(signal?.aborted)return Promise.reject(new DOMException('Sync stopped by the operator.','AbortError'));
 const remaining=deadline-Date.now();if(remaining<=0)return Promise.reject(new Error('PDF text extraction exceeded its 30-second safety limit.'));
 return new Promise<T>((resolve,reject)=>{let settled=false;const finish=(callback:()=>void)=>{if(settled)return;settled=true;globalThis.clearTimeout(timer);signal?.removeEventListener('abort',abort);callback()},abort=()=>finish(()=>reject(new DOMException('Sync stopped by the operator.','AbortError'))),timer=globalThis.setTimeout(()=>finish(()=>reject(new Error('PDF text extraction exceeded its 30-second safety limit.'))),remaining);signal?.addEventListener('abort',abort,{once:true});operation.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)))})
}

export async function extractPdfText(bytes:Uint8Array,maxPages=15,options:PdfTextOptions={}){
 const timeoutMs=Math.max(1000,Math.min(options.timeoutMs??30000,120000)),deadline=Date.now()+timeoutMs,task=getDocument({data:bytes.slice()}),parts:string[]=[];
 try{
  const document=await bounded(task.promise,deadline,options.signal),totalPages=document.numPages,pages=Math.min(totalPages,maxPages);
  for(let index=1;index<=pages;index++){const page=await bounded(document.getPage(index),deadline,options.signal),content=await bounded(page.getTextContent(),deadline,options.signal),text=content.items.map(item=>'str'in item?item.str:'').join(' ').replace(/\s+/g,' ').trim();if(text)parts.push(text)}
  return{pagesRead:pages,totalPages,text:parts.join('\n')};
 }finally{void Promise.resolve(task.destroy()).catch(()=>undefined)}
}
