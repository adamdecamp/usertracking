import {handlePdfCheckRequest,type PdfCheckRequest} from '../pdf-check-handler.ts';

const scope=globalThis as unknown as {onmessage:((event:MessageEvent<PdfCheckRequest>)=>void)|null;postMessage:(message:unknown)=>void};
scope.onmessage=event=>{void handlePdfCheckRequest(event.data).then(response=>scope.postMessage(response))};
