import {filenameIdentityMatches} from '../filename-utils.ts';
import type {OutlookIntakeFile,OutlookIntakeResult} from '../infrastructure/outlook-intake-contract.ts';

export const outlookIntakeLookbackDays=30;

type IntakeUser={systemId:string;email:string;last:string;first:string};

const address=(value:string)=>value.trim().toLowerCase();

/** Official Emails of this system's users: the only senders whose attachments intake will copy. */
export function outlookIntakeSenders(users:readonly IntakeUser[],systemId:string){
 return Array.from(new Set(users.filter(user=>user.systemId===systemId).map(user=>address(user.email)).filter(email=>/^[^@\s]+@[^@\s]+$/.test(email)))).sort();
}

export function outlookIntakeRequest(users:readonly IntakeUser[],systemId:string){
 const senders=outlookIntakeSenders(users,systemId);
 if(!senders.length)throw new Error('No user in this information system has an Official Email, so there is no approved sender to accept evidence from.');
 return JSON.stringify({senders,days:outlookIntakeLookbackDays});
}

/** A copied file named for someone other than its sender (for example, sent by a supervisor) needs a closer look in Sync review. */
export function sentOnBehalf(file:OutlookIntakeFile,users:readonly IntakeUser[],systemId:string){
 const senders=users.filter(user=>user.systemId===systemId&&address(user.email)===address(file.sender));
 return senders.length>0&&!senders.some(user=>filenameIdentityMatches(file.filename,user));
}

export function outlookIntakeSummary(result:OutlookIntakeResult){
 const copied=result.saved.length,skipped=result.skipped.length,plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
 const lead=copied?`Copied ${plural(copied,'PDF')} from ${result.folder||'Outlook'} into organization intake. Start Daily Sync to review ${copied===1?'it':'them'}; no user record changes until you approve.`:`No new evidence was found in ${result.folder||'Outlook'}.`;
 return `${lead} Read ${plural(result.scanned,'message')} from the last ${outlookIntakeLookbackDays} days${result.previouslyProcessed?` (${result.previouslyProcessed} already checked)`:''}${skipped?`; ${plural(skipped,'attachment')} skipped`:''}.`;
}
