// Compliance report presets and organization service lists. Moved unchanged from app/page.tsx.
import type {OrganizationServices} from './components/organization-services';
import {decodeJsonResponse} from './infrastructure/runtime-decoders';
import {decodeOperationReceipt} from './infrastructure/portable-contracts';
import {appendAudit,isPortableRoot,portableRequest,reportOperationalError,rootFor} from './storage-session';
import {warnAuditFailure} from './system-storage';
import {createOrganizationFolder,organizationFolderNames} from './evidence-storage';

export const organizationServices:OrganizationServices={audit:appendAudit,warnAudit:warnAuditFailure,report:async(context,error,systemId,fallback)=>(await reportOperationalError(context,error,systemId,{fallback})).message,mapped:systemId=>!!rootFor(systemId),listOrganizations:(systemId,recorded)=>{const root=rootFor(systemId);return root?organizationFolderNames(root,recorded):Promise.resolve(recorded)},createOrganization:(systemId,name)=>{const root=rootFor(systemId);if(!root)throw new Error('Map this information system folder first.');return createOrganizationFolder(root,name)},draft:async(systemId,request)=>{const root=rootFor(systemId);if(!root||!isPortableRoot(root))return null;const response=await portableRequest(root,'outlook-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});return(await decodeJsonResponse(response,'Outlook draft',decodeOperationReceipt)).operationId??''}};
export type ReportPreset={systemIds:string[];organizations:string[];emailing:boolean};
