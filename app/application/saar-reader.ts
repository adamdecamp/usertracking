import {errorDetail,oneLineText} from '../error-utils';
import {evidenceFileLimit,inspectEvidenceBytes,validateReadableOrStrictEncryptedEvidence} from '../evidence-validation';
import {organizationFrom} from '../filename-utils';
import {OperationTimeoutError,withOperationTimeout} from '../operation-timeout';
import type {SaarIdentity} from '../saar-form-utils';
import {throwIfSyncCancelled} from '../sync-utils';

export type SaarEmailSource='SAAR AcroForm'|'DD2875 XFA'|'Selectable PDF Text';
export type SaarReadResult={email:string;emailSource?:SaarEmailSource;identity?:SaarIdentity;organization?:string;designation?:'MIL'|'CIV'|'CTR';requestDate?:string;createdDate?:string;disabledDate?:string;createdBySigned?:boolean;disabledBySigned?:boolean;signedFieldNames?:string[];format?:'AcroForm'|'XFA';pdfName?:string;error?:string;manualEntryAllowed?:boolean;encryptedFilenameOverride?:boolean;emailRecoveryAttempted:boolean};

const validEmail=(value:string)=>value.length<=254&&/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
const extractPdfText=async(bytes:Uint8Array,maxPages=15,options:{signal?:AbortSignal;timeoutMs?:number}={})=>(await import('../pdf-text')).extractPdfText(bytes,maxPages,options);
const readSaarFormFields=async(bytes:Uint8Array)=>(await import('../saar-form-utils')).readSaarFormFields(bytes);

/** Reads only the bounded SAAR fields needed by ingestion and records where the email came from. */
export async function readSaarFileCore(source:File,recoverOfficialEmailFromText=true,signal?:AbortSignal):Promise<SaarReadResult>{
 try{
  throwIfSyncCancelled(signal);
  if(source.size>evidenceFileLimit)return{email:'',error:'The SAAR exceeds the 100 MB file limit.',emailRecoveryAttempted:recoverOfficialEmailFromText};
  const inspected=inspectEvidenceBytes(source.name,new Uint8Array(await source.arrayBuffer()));throwIfSyncCancelled(signal);
  if(inspected.encryptedPdf&&await validateReadableOrStrictEncryptedEvidence(inspected,source.name,`Organizations/${organizationFrom(source.name)??''}/${source.name}`))return{email:'',pdfName:inspected.pdfName,error:'The SAAR is encrypted. Its complete filename is accepted for evidence tracking, but its fields cannot be read; enter Official Email manually.',manualEntryAllowed:true,encryptedFilenameOverride:true,emailRecoveryAttempted:recoverOfficialEmailFromText};
  const fields=await readSaarFormFields(inspected.pdfBytes);throwIfSyncCancelled(signal);
  if(!fields.fillable)return{email:'',error:'The SAAR is not a supported fillable AcroForm or DD2875 XFA PDF.',emailRecoveryAttempted:recoverOfficialEmailFromText};
  const fieldEmail=oneLineText(fields.email??'');let email=validEmail(fieldEmail)?fieldEmail:'',emailSource:SaarEmailSource|undefined=email?(fields.format==='XFA'?'DD2875 XFA':'SAAR AcroForm'):undefined;
  if(!email&&recoverOfficialEmailFromText)try{const extracted=await extractPdfText(inspected.pdfBytes,6,{signal,timeoutMs:15000}),{officialEmailFromText,firstEmailFromText}=await import('../saar-form-utils'),textEmail=oneLineText(officialEmailFromText(extracted.text)??firstEmailFromText(extracted.text)??'');if(validEmail(textEmail)){email=textEmail;emailSource='Selectable PDF Text'}}catch{}
  const base={email,emailSource,identity:fields.identity,organization:fields.organization,designation:fields.designation,requestDate:fields.requestDate,createdDate:fields.createdDate,disabledDate:fields.disabledDate,createdBySigned:fields.createdBySigned,disabledBySigned:fields.disabledBySigned,signedFieldNames:fields.signedFieldNames,format:fields.format,pdfName:inspected.pdfName,emailRecoveryAttempted:!!email||recoverOfficialEmailFromText};
  if(!email&&!recoverOfficialEmailFromText)return base;
  return email?base:{...base,error:'The SAAR OFFICIAL/ORGANIZATION E-MAIL ADDRESS field is empty or invalid, and no valid first email address was found from the top of the selectable PDF text.',manualEntryAllowed:true};
 }catch(error){throwIfSyncCancelled(signal);if(error instanceof OperationTimeoutError)throw error;return{email:'',error:`The SAAR is not a readable fillable PDF. ${errorDetail(error,'')}`.trim(),emailRecoveryAttempted:recoverOfficialEmailFromText}}
}

export async function readSaarFile(source:File,recoverOfficialEmailFromText=true,signal?:AbortSignal):Promise<SaarReadResult>{
 return withOperationTimeout(operationSignal=>readSaarFileCore(source,recoverOfficialEmailFromText,operationSignal),{timeoutMs:30000,message:'The SAAR could not be read within 30 seconds.',signal});
}
