// Small helpers shared by the page and its pop-up windows. Moved unchanged from app/page.tsx.
import {notify} from './components/NotificationCenter';
import {baseRequirementKinds} from './user-requirements';
import type {ScanRejection} from './tracker-workflow-types';
import {isPortableRoot,portableRequest,reportOperationalError,rootFor} from './storage-session';

export const syncRejectionTimedOut=(item:Pick<ScanRejection,'reason'>)=>/(?:time[ -]?out|timed out|stopped responding|network-aware retries|could not be read after)/i.test(item.reason);
export const baseKinds:string[]=[...baseRequirementKinds];
export const uid=()=>crypto.randomUUID();
export const validEmail=(value:string)=>value.length<=254&&/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
export const outlookRequest=(systemId:string)=>{const root=rootFor(systemId);return root&&isPortableRoot(root)?(action:string,init?:RequestInit)=>portableRequest(root,action,init):undefined};
/** Drops trailing periods and colons with one backward scan. An end-anchored regex for this retries from every position on long runs of them. */
export function withoutTrailingPunctuation(text:string){let end=text.length;while(end>0&&(text[end-1]==='.'||text[end-1]===':'))end--;return text.slice(0,end)}
export async function showOperationalError(context:string,error:unknown,systemId?:string,options?:{audit?:boolean;fallback?:string}){const reported=await reportOperationalError(context,error,systemId,options);notify(reported.message,'error',withoutTrailingPunctuation(context));return reported}
