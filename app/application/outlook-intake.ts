import {artifactKindFromFilename,evidenceDateIsInFuture,filenameIdentityMatches,parseDate} from '../filename-utils.ts';
import {buildTrackerFilename} from '../document-renamer-utils.ts';
import type {OutlookHeldItem,OutlookHeldReason,OutlookIntakeFile,OutlookIntakeResult} from '../infrastructure/outlook-intake-contract.ts';

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

/** Shown while the Outlook folder picker is open because Check Outlook has no usable folder on this computer. */
export function outlookFolderPrompt(missing?:string){
 return`${missing?`Outlook can no longer find the saved folder ${missing}. Choose it again`:'Choose the Outlook folder to check'} in the Outlook window. It may open behind this window.`;
}

export function outlookIntakeSummary(result:OutlookIntakeResult){
 const copied=result.saved.length,held=result.skipped.filter(file=>file.held).length,recorded=result.skipped.filter(file=>file.recorded).length,duplicates=result.skipped.filter(file=>file.duplicate).length,skipped=result.skipped.length-held-recorded-duplicates,plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
 const lead=copied?`Copied ${plural(copied,'PDF')} from ${result.folder||'Outlook'} into organization intake. Start Daily Sync to review ${copied===1?'it':'them'}; no user record changes until you approve.`:`No new evidence was found in ${result.folder||'Outlook'}.`;
 return `${lead} Read ${plural(result.scanned,'message')} from the last ${outlookIntakeLookbackDays} days${result.previouslyProcessed?` (${result.previouslyProcessed} already checked)`:''}${recorded?`; ${plural(recorded,'PDF')} already recorded and not copied`:''}${duplicates?`; ${plural(duplicates,'duplicate PDF')} already waiting and not copied again`:''}${held?`; ${plural(held,'attachment')} added to Needs Attention`:''}${skipped?`; ${plural(skipped,'attachment')} skipped`:''}.`;
}

/** The sentence above the results table: what happened and what to do next, without the per-category counts the table shows. */
export function outlookIntakeLead(result:OutlookIntakeResult){
 const copied=result.saved.length,folder=result.folder||'Outlook',plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
 const lead=copied?`Copied ${plural(copied,'PDF')} from ${folder}. Start Daily Sync to review ${copied===1?'it':'them'}; no user record changes until you approve.`:`No new evidence was found in ${folder}.`;
 return `${lead} Read ${plural(result.scanned,'message')} from the last ${outlookIntakeLookbackDays} days${result.previouslyProcessed?`, ${result.previouslyProcessed} of them already checked`:''}.`;
}

export type OutlookIntakeRow={key:'copied'|'recorded'|'duplicate'|'held'|'skipped';label:string;meaning:string;files:OutlookIntakeFile[]};

/** One row per outcome, always in the same order, so the operator can see at a glance where every attachment went. */
export function outlookIntakeRows(result:OutlookIntakeResult):OutlookIntakeRow[]{
 const held=result.skipped.filter(file=>file.held),recorded=result.skipped.filter(file=>!file.held&&file.recorded),duplicates=result.skipped.filter(file=>!file.held&&!file.recorded&&file.duplicate),other=result.skipped.filter(file=>!file.held&&!file.recorded&&!file.duplicate);
 return[
  {key:'copied',label:'Copied to Intake',meaning:'Waiting for your review in Daily Sync.',files:result.saved},
  {key:'recorded',label:'Already Recorded',meaning:'This exact PDF is already in the database, so it was not copied.',files:recorded},
  {key:'duplicate',label:'Duplicates',meaning:'The same PDF is already waiting for Sync or in Needs Attention, or came in another email.',files:duplicates},
  {key:'held',label:'Needs Attention',meaning:'Correct or dismiss each one in Needs Attention below.',files:held},
  {key:'skipped',label:'Skipped',meaning:'Not copied. Each file shows why.',files:other},
 ];
}

export const outlookHeldReasonLabel:Record<OutlookHeldReason,string>={sender:'Unknown Sender',filename:'Filename Not Recognized',organization:'Organization Not Found',conflict:'Name Already Waiting',invalid:'Not a Usable PDF'};

/** What the operator corrects for each held attachment. Daily Sync still validates the PDF afterward. */
export type OutlookHeldDraft={userId:string;organization:string;kind:string;date:string;role:''|'GEN'|'PRIV';privilegedType:string};
type DraftUser=IntakeUser&{id:string;organization:string;privilegedTypes:readonly string[]};

const isoDate=(date:Date|undefined)=>date?date.toISOString().slice(0,10):'';

/** Prefills the correction from the filename and sender so the operator usually changes only the field that failed. */
export function outlookHeldDraft(item:OutlookHeldItem,users:readonly DraftUser[],systemId:string,organizations:readonly string[]):OutlookHeldDraft{
 const own=users.filter(user=>user.systemId===systemId),byName=own.filter(user=>filenameIdentityMatches(item.filename,user)),bySender=own.filter(user=>address(user.email)===address(item.sender));
 const user=byName.length===1?byName[0]:bySender.length===1?bySender[0]:undefined,key=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]+/g,''),known=(value:string)=>value.trim()?organizations.find(organization=>key(organization)===key(value))??'':'';
 const kind=artifactKindFromFilename(item.filename)??'',upper=item.filename.toUpperCase(),role:OutlookHeldDraft['role']=kind!=='SAAR'?'':/(^|[^A-Z])PRIV/.test(upper)?'PRIV':/(^|[^A-Z])GEN/.test(upper)?'GEN':'';
 return{userId:user?.id??'',organization:known(item.organization)||known(item.code)||known(user?.organization??''),kind,date:isoDate(parseDate(item.filename)),role,privilegedType:role==='PRIV'&&user?.privilegedTypes.length===1?user.privilegedTypes[0]:''};
}

/** The standard evidence filename for a completed draft, or why it cannot be built yet. */
export function outlookHeldFilename(draft:OutlookHeldDraft,users:readonly DraftUser[]):{filename:string}|{problem:string}{
 const user=users.find(candidate=>candidate.id===draft.userId);
 if(!user)return{problem:'Choose the user this file belongs to.'};
 if(!draft.organization)return{problem:'Choose the organization.'};
 if(!draft.kind)return{problem:'Choose the artifact type.'};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.date))return{problem:'Enter the document date.'};
 if(evidenceDateIsInFuture(new Date(`${draft.date}T00:00:00Z`)))return{problem:'The document date cannot be in the future.'};
 if(draft.kind==='SAAR'&&!draft.role)return{problem:'Choose whether the SAAR is General or Privileged.'};
 if(draft.kind==='SAAR'&&draft.role==='PRIV'&&!draft.privilegedType.trim())return{problem:'Enter the privileged access type.'};
 const filename=buildTrackerFilename({kind:draft.kind,first:user.first,last:user.last,organization:draft.organization,date:draft.date,role:draft.kind==='SAAR'?draft.role:'',privilegedType:draft.privilegedType});
 return filename?{filename}:{problem:'These details do not make a valid evidence filename.'};
}

/** The launcher request that resolves one held attachment. */
export function outlookHeldCorrection(item:OutlookHeldItem,draft:OutlookHeldDraft,users:readonly DraftUser[]){
 if(item.reason==='invalid')throw new Error('This attachment is not a usable PDF. Dismiss it and ask the sender for a PDF.');
 if(item.reason==='conflict')return JSON.stringify({id:item.id,organization:item.organization});
 if(item.reason==='organization'){if(!draft.organization)throw new Error('Choose the organization.');return JSON.stringify({id:item.id,organization:draft.organization})}
 const built=outlookHeldFilename(draft,users);if('problem' in built)throw new Error(built.problem);
 const user=users.find(candidate=>candidate.id===draft.userId)!;
 return JSON.stringify({id:item.id,organization:draft.organization,filename:built.filename,forUser:`${user.last}, ${user.first}`});
}
