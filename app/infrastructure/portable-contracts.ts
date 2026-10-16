import {booleanValue,numberValue,objectValue,optionalBoolean,optionalNumber,optionalString,stringArrayValue,stringValue,type RuntimeDecoder} from './runtime-decoders';

const sha256=(value:string)=>/^[a-f0-9]{64}$/i.test(value);

export type LeaseAcquireResponse={acquired:boolean};
export const decodeLeaseAcquireResponse:RuntimeDecoder<LeaseAcquireResponse>=value=>{const context='Lease acquisition',record=objectValue(value,context);return{acquired:booleanValue(record.acquired,context,'$.acquired')}};
export type LeaseRenewResponse={renewed:boolean};
export const decodeLeaseRenewResponse:RuntimeDecoder<LeaseRenewResponse>=value=>{const context='Lease renewal',record=objectValue(value,context);return{renewed:booleanValue(record.renewed,context,'$.renewed')}};

export type StoredEvidenceResponse={filename:string;path:string;sha256:string;pdfSha256?:string;stored?:boolean};
export const decodeEvidenceFilenameResponse:RuntimeDecoder<{filename:string}>=value=>{const context='Evidence storage',record=objectValue(value,context);return{filename:stringValue(record.filename,context,'$.filename',500)}};
export const decodeStoredEvidenceResponse:RuntimeDecoder<StoredEvidenceResponse>=value=>{
 const context='Evidence storage',record=objectValue(value,context),filename=stringValue(record.filename,context,'$.filename',500),path=stringValue(record.path,context,'$.path'),hash=stringValue(record.sha256,context,'$.sha256',64),pdfHash=optionalString(record,'pdfSha256',context,64);
 if(!sha256(hash)||pdfHash&&!sha256(pdfHash))throw new Error(`${context} returned an invalid SHA-256 receipt.`);
 return{filename,path,sha256:hash,pdfSha256:pdfHash,stored:optionalBoolean(record,'stored',context)};
};

export type EvidenceStatusResponse=StoredEvidenceResponse&{stored:boolean};
export const decodeEvidenceStatusResponse:RuntimeDecoder<EvidenceStatusResponse>=value=>{const decoded=decodeStoredEvidenceResponse(value);if(decoded.stored===undefined)throw new Error('Evidence status returned no stored flag.');return{...decoded,stored:decoded.stored}};

export type SelectedFolderResponse={cancelled?:boolean;folderName?:string;manifest?:unknown};
export const decodeSelectedFolderResponse:RuntimeDecoder<SelectedFolderResponse>=value=>{const context='Folder selection',record=objectValue(value,context);return{cancelled:optionalBoolean(record,'cancelled',context),folderName:optionalString(record,'folderName',context,500),manifest:record.manifest}};

export type CachedMappingResponse={lastSystemId?:string;mappings?:unknown[]};
export const decodeCachedMappingResponse:RuntimeDecoder<CachedMappingResponse>=value=>{const context='Saved mappings',record=objectValue(value,context),mappings=record.mappings;if(mappings!==undefined&&(!Array.isArray(mappings)||mappings.length>1000))throw new Error(`${context} returned an invalid mappings list.`);return{lastSystemId:optionalString(record,'lastSystemId',context,100),mappings:mappings as unknown[]|undefined}};

export type StorageVerificationResponse={saved:string;backup:string;filename:string;auditEntries:number;auditHeadHash:string;manifestSha256:string;checksumInitialized?:boolean;manifest?:unknown;localWorkspace?:boolean;workspacePath?:string;workspaceResumed?:boolean};
export const decodeStorageVerificationResponse:RuntimeDecoder<StorageVerificationResponse>=value=>{const context='Storage verification',record=objectValue(value,context),manifestSha256=stringValue(record.manifestSha256,context,'$.manifestSha256',64),auditHeadHash=stringValue(record.auditHeadHash,context,'$.auditHeadHash',64);if(!sha256(manifestSha256)||!sha256(auditHeadHash))throw new Error(`${context} returned an invalid cryptographic hash.`);return{saved:stringValue(record.saved,context,'$.saved',50),backup:stringValue(record.backup,context,'$.backup',50),filename:stringValue(record.filename,context,'$.filename',500),auditEntries:numberValue(record.auditEntries,context,'$.auditEntries'),auditHeadHash,manifestSha256,checksumInitialized:optionalBoolean(record,'checksumInitialized',context),manifest:record.manifest,localWorkspace:optionalBoolean(record,'localWorkspace',context),workspacePath:optionalString(record,'workspacePath',context),workspaceResumed:optionalBoolean(record,'workspaceResumed',context)}};

export type PathMutationResponse={path:string;collision?:boolean;existing?:string};
export function decodePathMutationResponse(field:string,context:string):RuntimeDecoder<PathMutationResponse>{return value=>{const record=objectValue(value,context);return{path:stringValue(record[field],context,`$.${field}`),collision:optionalBoolean(record,'collision',context),existing:optionalString(record,'existing',context)}}}

export const decodeOrganizationList:RuntimeDecoder<string[]>=value=>stringArrayValue(value,'Organization listing','$',1000,200);
export const decodeOrganizationResponse:RuntimeDecoder<{organization:string}>=value=>{const context='Organization creation',record=objectValue(value,context);return{organization:stringValue(record.organization,context,'$.organization',200)}};

export const decodeOperationReceipt:RuntimeDecoder<{operationId?:string}>=value=>{const context='Operation receipt',record=objectValue(value,context);return{operationId:optionalString(record,'operationId',context,100)}};

export const decodePublishResponse:RuntimeDecoder<{saved:string;backup?:string;publishedFiles?:number;completedFiles?:number;completionErrors?:string[];manifestSha256?:string;manifest?:unknown;compressedForPublication?:number;deferredLocalPdfs?:number;reusedFiles?:number;archivedConflicts?:number}>=value=>{const context='Workspace publication',record=objectValue(value,context),completionErrors=record.completionErrors===undefined?undefined:stringArrayValue(record.completionErrors,context,'$.completionErrors',10000,500);return{saved:stringValue(record.saved,context,'$.saved',50),backup:optionalString(record,'backup',context,50),publishedFiles:optionalNumber(record,'publishedFiles',context),completedFiles:optionalNumber(record,'completedFiles',context),completionErrors,manifestSha256:optionalString(record,'manifestSha256',context,64),manifest:record.manifest,compressedForPublication:optionalNumber(record,'compressedForPublication',context),deferredLocalPdfs:optionalNumber(record,'deferredLocalPdfs',context),reusedFiles:optionalNumber(record,'reusedFiles',context),archivedConflicts:optionalNumber(record,'archivedConflicts',context)}};
