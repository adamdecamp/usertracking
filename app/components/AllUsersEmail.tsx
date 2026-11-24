'use client';

import {useState} from 'react';
import {decodeJsonResponse} from '../infrastructure/runtime-decoders';
import {decodeOperationReceipt} from '../infrastructure/portable-contracts';
import {activeUsersWithoutEmail,allUsersEmailBatches,allUsersEmailBody,allUsersEmailDetailLimit,allUsersEmailRequest,allUsersEmailSubject,allUsersEmailTags,allUsersEmailTopicLimit} from '../application/all-users-email';
import type {OutlookDraftSubjectTag} from '../notification-utils';
import type {SystemRecord,UserRecord} from '../domain/tracker-models';

type DraftRequest=(action:'outlook-draft',init?:RequestInit)=>Promise<Response>;

/** One BCC-only Outlook draft per safe-size batch of every enabled user in one information system. */
export function AllUsersEmail({systems,users,systemId,request,audit}:{systems:readonly SystemRecord[];users:readonly UserRecord[];systemId:string;request?:DraftRequest;audit:(action:string,systemId:string)=>Promise<boolean>}){
 const[tag,setTag]=useState<OutlookDraftSubjectTag>('Notice'),[topic,setTopic]=useState(''),[detail,setDetail]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState<number|null>(null),[status,setStatus]=useState(''),[error,setError]=useState('');
 const system=systems.find(item=>item.id===systemId&&!item.archived);
 if(!system)return <section className="outlook-intake" aria-label="Email All Active Users"><h3>Email All Active Users</h3><p className="hint">Choose one information system above to email all of its active users.</p></section>;
 const batches=allUsersEmailBatches(users,system.id),recipients=batches.reduce((total,batch)=>total+batch.length,0),unreachable=activeUsersWithoutEmail(users,system.id),subject=allUsersEmailSubject(tag,system.name,topic,detail),ready=!!topic.trim()&&busy===null;
 const open=async(batch:string[],index:number)=>{
  setBusy(index);setError('');setStatus('Auditing and preparing the Outlook draft…');
  try{
   const body=allUsersEmailBody(message);
   if(!(await audit(`PREPARE ALL ACTIVE USERS OUTLOOK DRAFT BATCH ${index+1} OF ${batches.length}: system ${system.name}; ${batch.length} BCC recipients; subject ${subject}`,system.id)))throw new Error('The audit record could not be written, so no draft was opened.');
   if(request){const result=await decodeJsonResponse(await request('outlook-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:allUsersEmailRequest(batch,subject,body,system.id)}),'All active users Outlook draft',decodeOperationReceipt);setStatus(`Batch ${index+1} of ${batches.length} queued in Outlook with ${batch.length} BCC recipients${result.operationId?` · Operation ${result.operationId}`:''}. Review it before sending.`)}
   else{window.location.assign(`mailto:?bcc=${encodeURIComponent(batch.join(';'))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);setStatus(`Batch ${index+1} of ${batches.length} opened in the default email application with ${batch.length} BCC recipients.`)}
  }catch(caught){setStatus('');setError(caught instanceof Error?caught.message:'The Outlook draft could not be prepared.')}
  finally{setBusy(null)}
 };
 return <section className="outlook-intake" aria-label="Email All Active Users">
  <h3>Email All Active Users</h3>
  <p className="hint">Prepares Outlook drafts to every enabled user of {system.name}. Every address goes in BCC, so recipients never see each other, and large lists are split into batches of up to 40. Each batch is audited, and you review and send every draft yourself.</p>
  <div className="form-grid">
   <label><span>Subject Tag</span><select aria-label="Subject Tag" value={tag} onChange={event=>setTag(event.target.value as OutlookDraftSubjectTag)}>{allUsersEmailTags.map(value=><option key={value}>{value}</option>)}</select></label>
   <label><span>Topic</span><input aria-label="Topic" value={topic} maxLength={allUsersEmailTopicLimit} placeholder="System Maintenance" onChange={event=>setTopic(event.target.value)}/></label>
   <label><span>Detail (Optional)</span><input aria-label="Detail" value={detail} maxLength={allUsersEmailDetailLimit} placeholder="15 DEC 2026" onChange={event=>setDetail(event.target.value)}/></label>
  </div>
  <label className="all-users-message"><span>Message (Optional; you can also write it in Outlook)</span><textarea aria-label="Message" rows={4} value={message} onChange={event=>setMessage(event.target.value)}/></label>
  <p className="hint"><b>Subject:</b> {subject}</p>
  <div className="message-summary" aria-live="polite"><strong>{recipients} Recipient{recipients===1?'':'s'} · {batches.length} Batch{batches.length===1?'':'es'}</strong>{unreachable>0&&<span>{unreachable} active user{unreachable===1?' has':'s have'} no valid Official Email and will not be included</span>}</div>
  {!topic.trim()&&batches.length>0&&<p className="hint">Enter a topic to open the drafts.</p>}
  <div className="message-actions batch-actions">{batches.map((batch,index)=><button type="button" className="primary" disabled={!ready} key={batch.join('|')} onClick={()=>void open(batch,index)}>{busy===index?'Preparing…':`Open Batch ${index+1} of ${batches.length} (${batch.length})`}</button>)}</div>
  {!batches.length&&<p className="hint">No active user of {system.name} has a valid Official Email.</p>}
  {status&&<p className="renamer-message" aria-live="polite">{status}</p>}
  {error&&<p className="restore-warning" role="alert">{error}</p>}
 </section>;
}
