import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline';

if(typeof Worker!=='undefined'&&!GlobalWorkerOptions.workerPort)GlobalWorkerOptions.workerPort=new PdfWorker();

export async function extractPdfText(bytes:Uint8Array,maxPages=15){
 const task=getDocument({data:bytes.slice()}),document=await task.promise,totalPages=document.numPages,pages=Math.min(totalPages,maxPages),parts:string[]=[];
 try{for(let index=1;index<=pages;index++){const page=await document.getPage(index),content=await page.getTextContent(),text=content.items.map(item=>'str'in item?item.str:'').join(' ').replace(/\s+/g,' ').trim();if(text)parts.push(text)}}finally{await task.destroy()}
 return{pagesRead:pages,totalPages,text:parts.join('\n')};
}
