// Document Renamer PDF discovery and analysis, used by Sync and the Document Renamer window. Moved unchanged from app/page.tsx.
import {analyzeDocumentText,applySaarFormFallback,buildTrackerFilename,documentNeedsFilenameNormalization,organizationFromFolderPath} from './document-renamer-utils';
import {errorDetail} from './error-utils';
import {inspectEvidenceBytes} from './evidence-validation';
import {withReadRetry} from './operation-timeout';
import {throwIfSyncCancelled} from './sync-utils';
import type {RecognitionAlias,UserRecord} from './domain/tracker-models';
import type {BrowserFileRef,DirectoryWithEntries,RenamerReadResult,ScannedEvidence,StorageRoot} from './tracker-workflow-types';
import {isPortableRoot} from './storage-session';
import {renamerCandidateLimit} from './system-storage';
import {evidenceFile,extractPdfText,managedEvidenceDirectory,readSaarFormFields,refreshEvidenceLocations} from './evidence-storage';

export async function discoverRenamerPdfs(root:StorageRoot,rootOrganization:string){
 const items:ScannedEvidence[]=[];let skippedZips=0,skippedArchives=0;
 if(isPortableRoot(root)){
  const locations=await refreshEvidenceLocations(root);
  skippedZips=locations.skippedZips??0;skippedArchives=locations.skippedArchives??0;
  for(const item of locations.evidence){if(!/\.pdf$/i.test(item.filename)||!documentNeedsFilenameNormalization(item.filename,item.path,rootOrganization))continue;items.push(item)}
 }else{
  const walk=async(directory:FileSystemDirectoryHandle,relative='',depth=0):Promise<void>=>{if(depth>25)throw new Error('Folder nesting limit exceeded.');for await(const[name,entry]of(directory as DirectoryWithEntries).entries()){const value=name.trim().toLowerCase(),reworkDirectory=value==='rework'||value.endsWith(' rework');if(entry.kind==='directory'&&managedEvidenceDirectory(name)&&!reworkDirectory){if(value.endsWith(' archive'))skippedArchives++;continue}if(entry.kind==='directory'){await walk(entry as FileSystemDirectoryHandle,relative?`${relative}/${name}`:name,depth+1);continue}if(/\.zip$/i.test(name)){skippedZips++;continue}if(!/\.pdf$/i.test(name))continue;const path=relative?`${relative}/${name}`:name;if(!documentNeedsFilenameNormalization(name,path,rootOrganization))continue;const handle=entry as FileSystemFileHandle,file=await handle.getFile(),ref:BrowserFileRef={kind:'browser',path,name,parent:directory,handle};items.push({id:path,path,filename:name,ref,size:file.size,lastModifiedUnixMs:file.lastModified})}};await walk(root);
 }
 if(items.length>renamerCandidateLimit)throw new Error(`More than ${renamerCandidateLimit.toLocaleString()} PDFs need renaming. Narrow the mapped folder or correct the top-level organization structure before running this administrative batch.`);return{items:items.sort((a,b)=>a.path.localeCompare(b.path)),skippedZips,skippedArchives};
}
export async function analyzeRenamerPdf(candidate:ScannedEvidence,users:UserRecord[],rootOrganization:string,aliases:RecognitionAlias[]=[],signal?:AbortSignal):Promise<RenamerReadResult>{
 const folderOrganization=organizationFromFolderPath(candidate.path,rootOrganization);let analysis=analyzeDocumentText('',candidate.filename,users,folderOrganization,aliases),error='',pagesRead=0,totalPages=0,auditDetail='';
 try{
  const parsed=await withReadRetry(async(operationSignal,attempt)=>{const file=await evidenceFile(candidate.ref,operationSignal),bytes=new Uint8Array(await file.arrayBuffer());throwIfSyncCancelled(operationSignal);const inspected=inspectEvidenceBytes(candidate.filename,bytes),textResult=await extractPdfText(inspected.pdfBytes,15,{signal:operationSignal,timeoutMs:attempt===1?25000:55000});let parsedAnalysis=analyzeDocumentText(textResult.text,candidate.filename,users,folderOrganization,aliases),formError='';if(parsedAnalysis.kind==='SAAR')try{const form=await readSaarFormFields(inspected.pdfBytes);if(form.fillable){parsedAnalysis=applySaarFormFallback(parsedAnalysis,form.identity,form.organization);parsedAnalysis={...parsedAnalysis,evidence:[...parsedAnalysis.evidence,`Read ${form.format} SAAR form fields as fallback metadata`]};const complete=!!parsedAnalysis.first&&!!parsedAnalysis.last&&!!parsedAnalysis.organization&&!!parsedAnalysis.date&&!!parsedAnalysis.role&&(parsedAnalysis.role!=='PRIV'||!!parsedAnalysis.privilegedType);parsedAnalysis.confidence=complete?'Review':'Manual'}}catch(caught){formError=errorDetail(caught,'The SAAR form fields could not be read; selectable PDF text was used.')}return{analysis:parsedAnalysis,pagesRead:textResult.pagesRead,totalPages:textResult.totalPages,error:formError}},{timeoutMs:30000,retryTimeoutMs:60000,message:'Document Renamer PDF analysis exceeded its 30-second safety limit.',retryMessage:'Document Renamer PDF analysis failed after one retry within 60 seconds.',signal});
  analysis=parsed.analysis;pagesRead=parsed.pagesRead;totalPages=parsed.totalPages;error=parsed.error;if(!pagesRead)error=error||'This PDF has no selectable text. Enter the fields manually after previewing the scan.';
 }catch(caught){throwIfSyncCancelled(signal);auditDetail=errorDetail(caught,'The PDF could not be read within the safety limit.');error=auditDetail}
 analysis={...analysis,organization:folderOrganization,evidence:[...analysis.evidence,`Organization set from containing folder: ${folderOrganization}`]};const target=buildTrackerFilename(analysis);
 return{item:{...candidate,...analysis,pagesRead,totalPages,error,selected:analysis.confidence==='High'&&!!target},auditDetail};
}
