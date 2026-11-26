import {inspectEvidenceBytes,validateReadableOrStrictEncryptedEvidence} from './evidence-validation.ts';
import type {SaarFormFields} from './saar-form-utils.ts';

/** CPU-heavy PDF work that runs in a background worker so Sync does not freeze the page. */
export type PdfCheckRequest=
 |{id:number;op:'validate-evidence';bytes:Uint8Array;filename:string;gateFilename:string;path:string;rootName:string}
 |{id:number;op:'saar-fields';bytes:Uint8Array};
export type PdfCheckResponse={id:number;ok:true;value:unknown}|{id:number;ok:false;name:string;message:string};
export type PdfCheckWork=PdfCheckRequest extends infer R?R extends {id:number}?Omit<R,'id'>:never:never;

/** Runs one request in the current thread. The worker uses it, and so does the page when no worker can start. */
export async function runPdfCheck(request:PdfCheckWork):Promise<boolean|SaarFormFields>{
 if(request.op==='validate-evidence')return validateReadableOrStrictEncryptedEvidence(inspectEvidenceBytes(request.filename,request.bytes),request.gateFilename,request.path,request.rootName);
 if(request.op==='saar-fields')return(await import('./saar-form-utils.ts')).readSaarFormFields(request.bytes);
 throw new Error('Unknown PDF check request.');
}

/** Turns a request into a message-safe response; errors keep their name and message. */
export async function handlePdfCheckRequest(request:PdfCheckRequest):Promise<PdfCheckResponse>{
 try{return{id:request.id,ok:true,value:await runPdfCheck(request)}}
 catch(error){return{id:request.id,ok:false,name:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message:String(error)}}
}

export function errorFromPdfCheck(response:{name:string;message:string}){const error=new Error(response.message);error.name=response.name;return error}
