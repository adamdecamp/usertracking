'use client';

import {useState} from 'react';
import {decodeJsonResponse} from '../infrastructure/runtime-decoders';
import {decodeOutlookFolderResult,decodeOutlookIntakeCheck,type OutlookIntakeResult} from '../infrastructure/outlook-intake-contract';
import {outlookFolderPrompt,outlookIntakeLookbackDays,outlookIntakeRequest,outlookIntakeSummary,sentOnBehalf} from '../application/outlook-intake';
import type {UserRecord} from '../domain/tracker-models';
import {OutlookNeedsAttention} from './OutlookNeedsAttention';

export type OutlookIntakeRequest=(action:'outlook-folder'|'outlook-intake'|'outlook-sender'|'outlook-held',init?:RequestInit)=>Promise<Response>;

/** Copies approved-sender PDF replies from one Outlook folder into organization intake for the operator's next Daily Sync. */
export function OutlookIntakePanel({systemId,users,request}:{systemId:string;users:readonly UserRecord[];request?:OutlookIntakeRequest}){
 const[busy,setBusy]=useState<''|'folder'|'check'>(''),[status,setStatus]=useState(''),[error,setError]=useState(''),[result,setResult]=useState<OutlookIntakeResult>(),[checks,setChecks]=useState(0);
 if(!request)return null;
 const skipped=result?.skipped.filter(file=>!file.held)??[];
 const run=async(kind:'folder'|'check')=>{
  setBusy(kind);setError('');setStatus(kind==='folder'?'Choose the folder in the Outlook window. It may open behind this window.':'Reading Outlook…');
  const chooseFolder=async()=>decodeJsonResponse(await request('outlook-folder',{method:'POST'}),'Outlook folder selection',decodeOutlookFolderResult);
  const check=async()=>decodeJsonResponse(await request('outlook-intake',{method:'POST',headers:{'Content-Type':'application/json'},body:outlookIntakeRequest(users,systemId)}),'Outlook intake',decodeOutlookIntakeCheck);
  try{
   if(kind==='folder'){const chosen=await chooseFolder();setStatus(chosen.cancelled?'No folder was chosen.':`Outlook folder set to ${chosen.folder}. Choose Check Outlook to look for evidence.`);return}
   let checked=await check();
   if('needsFolder' in checked){
    // First use on this computer, or the saved folder can no longer be found: ask for it, then check.
    setBusy('folder');setStatus(outlookFolderPrompt(checked.missing));
    const chosen=await chooseFolder();
    if(chosen.cancelled){setStatus('No folder was chosen, so Outlook was not checked.');return}
    setBusy('check');setStatus('Reading Outlook…');checked=await check();
    if('needsFolder' in checked)throw new Error('Outlook could not open the folder you chose. Choose Outlook Folder and try again.');
   }
   setResult(checked);setStatus(outlookIntakeSummary(checked));setChecks(count=>count+1);
  }catch(caught){setStatus('');setError(caught instanceof Error?caught.message:'Outlook could not be checked.')}
  finally{setBusy('')}
 };
 return <section className="outlook-intake" aria-label="Evidence from Outlook">
  <h3>Evidence from Outlook</h3>
  <p className="hint">Copies correctly named PDF attachments from the last {outlookIntakeLookbackDays} days into organization intake, only from senders whose Official Email belongs to a user in this system. Anything that does not match is listed under Needs Attention for you to correct or dismiss. Outlook is only read: nothing is moved, deleted, or sent. Requires classic desktop Outlook.</p>
  <div className="directory-actions"><button type="button" disabled={!!busy} onClick={()=>void run('check')}>{busy==='check'?'Checking Outlook…':'Check Outlook'}</button><button type="button" disabled={!!busy} onClick={()=>void run('folder')}>{busy==='folder'?'Waiting for Outlook…':'Choose Outlook Folder'}</button></div>
  {status&&<p className="hint" role="status">{status}</p>}
  {error&&<p className="restore-warning" role="alert">{error}</p>}
  {result&&result.saved.length>0&&<ul className="outlook-intake-list">{result.saved.map(file=><li key={`${file.organization}/${file.filename}`}><b>{file.filename}</b> <small>from {file.sender}</small>{sentOnBehalf(file,users,systemId)&&<small className="restore-warning"> Sent for someone else. Confirm the identity in Sync review.</small>}</li>)}</ul>}
  <OutlookNeedsAttention systemId={systemId} users={users} request={request} refreshKey={checks}/>
  {skipped.length>0&&<details><summary>{skipped.length} Skipped Attachment{skipped.length===1?'':'s'}</summary><ul className="outlook-intake-list">{skipped.map((file,index)=><li key={`${index}:${file.filename}`}><b>{file.filename}</b> <small>{file.sender?`from ${file.sender}: `:''}{file.reason}</small></li>)}</ul></details>}
 </section>;
}
