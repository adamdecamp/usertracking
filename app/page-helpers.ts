// Small helpers shared by the page and its pop-up windows. Moved unchanged from app/page.tsx.
import {notify} from './components/NotificationCenter';
import {isEmailAddress} from './email-address';
import {baseRequirementKinds} from './user-requirements';
import type {ScanRejection} from './tracker-workflow-types';
import {isPortableRoot,portableRequest,reportOperationalError,rootFor} from './storage-session';

export const syncRejectionTimedOut=(item:Pick<ScanRejection,'reason'>)=>/(?:time[ -]?out|timed out|stopped responding|network-aware retries|could not be read after)/i.test(item.reason);
export const baseKinds:string[]=[...baseRequirementKinds];
export const uid=()=>crypto.randomUUID();
export const validEmail=(value:string)=>isEmailAddress(value,254);
export const outlookRequest=(systemId:string)=>{const root=rootFor(systemId);return root&&isPortableRoot(root)?(action:string,init?:RequestInit)=>portableRequest(root,action,init):undefined};
export async function showOperationalError(context:string,error:unknown,systemId?:string,options?:{audit?:boolean;fallback?:string}){const reported=await reportOperationalError(context,error,systemId,options);notify(reported.message,'error',context.replace(/[.:]+$/,''));return reported}
