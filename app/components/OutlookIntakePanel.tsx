'use client';

import {useState} from 'react';
import {decodeJsonResponse} from '../infrastructure/runtime-decoders';
import {decodeOutlookFolderResult,decodeOutlookIntakeResult,type OutlookIntakeResult} from '../infrastructure/outlook-intake-contract';
import {outlookIntakeLookbackDays,outlookIntakeRequest,outlookIntakeSummary,sentOnBehalf} from '../application/outlook-intake';
import type {UserRecord} from '../domain/tracker-models';

export type OutlookIntakeRequest=(action:'outlook-folder'|'outlook-intake',body?:string)=>Promise<Response>;

/** Copies approved-sender PDF replies from one Outlook folder into organization intake for the operator's next Daily Sync. */
export function OutlookIntakePanel({systemId,users,request}:{systemId:string;users:readonly UserRecord[];request?:OutlookIntakeRequest}){
 const[busy,setBusy]=useState<''|'folder'|'check'>(''),[status,setStatus]=useState(''),[error,setError]=useState(''),[result,setResult]=useState<OutlookIntakeResult>();
 if(!request)return null;
 const run=async(kind:'folder'|'check')=>{
  setBusy(kind);setError('');setStatus(kind==='folder'?'Choose the folder in the Outlook window. It may open behind this window.':'Reading Outlook…');
  try{
   if(kind==='folder'){const chosen=await decodeJsonResponse(await request('outlook-folder'),'Outlook folder selection',decodeOutlookFolderResult);setStatus(chosen.cancelled?'No folder was chosen.':`Outlook folder set to ${chosen.folder}. Choose Check Outlook to look for evidence.`);return}
   const checked=await decodeJsonResponse(await request('outlook-intake',outlookIntakeRequest(users,systemId)),'Outlook intake',decodeOutlookIntakeResult);setResult(checked);setStatus(outlookIntakeSummary(checked));
  }catch(caught){setStatus('');setError(caught instanceof Error?caught.message:'Outlook could not be checked.')}
  finally{setBusy('')}
 };
 return <section className="outlook-intake" aria-label="Evidence from Outlook">
  <h3>Evidence from Outlook</h3>
  <p className="hint">Copies correctly named PDF attachments from the last {outlookIntakeLookbackDays} days into organization intake, only from senders whose Official Email belongs to a user in this system. Outlook is only read: nothing is moved, deleted, or sent. Requires classic desktop Outlook.</p>
  <div className="directory-actions"><button type="button" disabled={!!busy} onClick={()=>void run('check')}>{busy==='check'?'Checking Outlook…':'Check Outlook'}</button><button type="button" disabled={!!busy} onClick={()=>void run('folder')}>{busy==='folder'?'Waiting for Outlook…':'Choose Outlook Folder'}</button></div>
  {status&&<p className="hint" role="status">{status}</p>}
  {error&&<p className="restore-warning" role="alert">{error}</p>}
  {result&&result.saved.length>0&&<ul className="outlook-intake-list">{result.saved.map(file=><li key={`${file.organization}/${file.filename}`}><b>{file.filename}</b> <small>from {file.sender}</small>{sentOnBehalf(file,users,systemId)&&<small className="restore-warning"> Sent for someone else. Confirm the identity in Sync review.</small>}</li>)}</ul>}
  {result&&result.skipped.length>0&&<details><summary>{result.skipped.length} Skipped Attachment{result.skipped.length===1?'':'s'}</summary><ul className="outlook-intake-list">{result.skipped.map((file,index)=><li key={`${index}:${file.filename}`}><b>{file.filename}</b> <small>{file.sender?`from ${file.sender}: `:''}{file.reason}</small></li>)}</ul></details>}
 </section>;
}
