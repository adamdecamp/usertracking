'use client';

import {useEffect,useRef,useState} from 'react';
import {decodeJsonResponse} from '../infrastructure/runtime-decoders';
import {decodeOutlookHeldList,type OutlookHeldItem,type OutlookHeldList} from '../infrastructure/outlook-intake-contract';
import {outlookHeldCorrection,outlookHeldDraft,outlookHeldFilename,outlookHeldReasonLabel,type OutlookHeldDraft} from '../application/outlook-intake';
import {artifactKinds} from '../filename-utils';
import type {UserRecord} from '../domain/tracker-models';
import type {OutlookIntakeRequest} from './OutlookIntakePanel';

const json={'Content-Type':'application/json'};
const emptyDraft:OutlookHeldDraft={userId:'',organization:'',kind:'',date:'',role:'',privilegedType:''};
const failure=(caught:unknown,fallback:string)=>caught instanceof Error?caught.message:fallback;

/** Outlook attachments intake held back for the operator to correct or dismiss. */
export function OutlookNeedsAttention({systemId,users,request,refreshKey}:{systemId:string;users:readonly UserRecord[];request:OutlookIntakeRequest;refreshKey:number}){
 const[list,setList]=useState<OutlookHeldList>(),[open,setOpen]=useState(''),[draft,setDraft]=useState<OutlookHeldDraft>(),[busy,setBusy]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState('');
 // The parent recreates `request` on every render, so reload only when a check finishes or the system changes.
 const latest=useRef(request);
 useEffect(()=>{latest.current=request});
 useEffect(()=>{
  let active=true;
  latest.current('outlook-held').then(response=>decodeJsonResponse(response,'Outlook Needs Attention',decodeOutlookHeldList)).then(value=>{if(active)setList(value)},caught=>{if(active)setError(failure(caught,'The Needs Attention list could not be read.'))});
  return()=>{active=false};
 },[refreshKey,systemId]);
 if(!list||!list.held.length)return error?<p className="restore-warning" role="alert">{error}</p>:null;
 const systemUsers=users.filter(user=>user.systemId===systemId).sort((left,right)=>`${left.last} ${left.first}`.localeCompare(`${right.last} ${right.first}`));
 const send=async(id:string,body:string,done:(next:OutlookHeldList)=>string)=>{
  setBusy(id);setError('');setStatus('');
  try{const next=await decodeJsonResponse(await request('outlook-held',{method:'POST',headers:json,body}),'Outlook Needs Attention',decodeOutlookHeldList);setList(next);setOpen('');setStatus(done(next))}
  catch(caught){setError(failure(caught,'The attachment could not be updated.'))}
  finally{setBusy('')}
 };
 const copied=(next:OutlookHeldList)=>next.assigned?`Copied ${next.assigned.filename} to ${next.assigned.organization} intake. Start Daily Sync to review it.`:'';
 const startFix=(item:OutlookHeldItem)=>{setOpen(item.id);setError('');setDraft(outlookHeldDraft(item,systemUsers,systemId,list.organizations))};
 const fix=(item:OutlookHeldItem)=>{try{void send(item.id,outlookHeldCorrection(item,draft??emptyDraft,systemUsers),copied)}catch(caught){setError(failure(caught,'The correction is incomplete.'))}};
 const dismiss=(item:OutlookHeldItem)=>void send(item.id,JSON.stringify({id:item.id,dismiss:true}),()=>`Dismissed ${item.filename}. The email is still in Outlook.`);
 const invalid=list.held.filter(item=>item.reason==='invalid').length;
 return <section className="outlook-attention" aria-label="Outlook Needs Attention">
  <h4>Needs Attention ({list.held.length})</h4>
  <p className="hint">These attachments were not copied. Correct each one to send it to organization intake for Daily Sync, or dismiss it. The emails stay in Outlook either way.</p>
  {status&&<p className="hint" role="status">{status}</p>}
  {error&&<p className="restore-warning" role="alert">{error}</p>}
  <ul className="outlook-intake-list">{list.held.map(item=>{
   const editing=open===item.id&&draft,built=editing&&(item.reason==='filename'||item.reason==='sender')?outlookHeldFilename(draft,systemUsers):undefined,set=(change:Partial<OutlookHeldDraft>)=>setDraft(current=>current&&{...current,...change});
   return <li key={item.id}>
    <b>{item.filename}</b> <span className={`status ${item.reason==='invalid'?'overdue':'due'}`}>{outlookHeldReasonLabel[item.reason]}</span>
    <small>{item.sender||'Hidden sender'} · {new Date(item.receivedUtc).toLocaleDateString()} · {item.detail}</small>
    {editing&&item.reason==='organization'&&<div className="form-grid"><label><span>Organization</span><select aria-label="Organization" value={draft.organization} onChange={event=>set({organization:event.target.value})}><option value="">Choose…</option>{list.organizations.map(value=><option key={value}>{value}</option>)}</select></label></div>}
    {editing&&(item.reason==='filename'||item.reason==='sender')&&<div className="form-grid">
     <label><span>User</span><select aria-label="User" value={draft.userId} onChange={event=>{const user=systemUsers.find(candidate=>candidate.id===event.target.value),own=user&&list.organizations.find(value=>value.toUpperCase()===user.organization.toUpperCase());set({userId:event.target.value,...(own&&!draft.organization?{organization:own}:{})})}}><option value="">Choose…</option>{systemUsers.map(user=><option key={user.id} value={user.id}>{user.last}, {user.first}{user.email?` (${user.email})`:''}</option>)}</select></label>
     <label><span>Organization</span><select aria-label="Organization" value={draft.organization} onChange={event=>set({organization:event.target.value})}><option value="">Choose…</option>{list.organizations.map(value=><option key={value}>{value}</option>)}</select></label>
     <label><span>Artifact Type</span><select aria-label="Artifact Type" value={draft.kind} onChange={event=>set({kind:event.target.value,role:event.target.value==='SAAR'?draft.role:''})}><option value="">Choose…</option>{artifactKinds.map(kind=><option key={kind}>{kind}</option>)}</select></label>
     <label><span>Document Date</span><input type="date" aria-label="Document Date" value={draft.date} onChange={event=>set({date:event.target.value})}/></label>
     {draft.kind==='SAAR'&&<label><span>SAAR Type</span><select aria-label="SAAR Type" value={draft.role} onChange={event=>set({role:event.target.value as OutlookHeldDraft['role']})}><option value="">Choose…</option><option value="GEN">General</option><option value="PRIV">Privileged</option></select></label>}
     {draft.kind==='SAAR'&&draft.role==='PRIV'&&<label><span>Privileged Type</span><input aria-label="Privileged Type" value={draft.privilegedType} maxLength={40} onChange={event=>set({privilegedType:event.target.value})}/></label>}
    </div>}
    {built&&<p className="hint">{'problem' in built?built.problem:<>Will be copied as <b>{built.filename}</b>{item.reason==='sender'?'. Sync still checks that the document belongs to this user.':''}</>}</p>}
    <div className="directory-actions">
     {item.reason==='conflict'&&<button type="button" disabled={!!busy} onClick={()=>fix(item)}>{busy===item.id?'Retrying…':'Retry'}</button>}
     {item.reason!=='conflict'&&item.reason!=='invalid'&&!editing&&<button type="button" disabled={!!busy} onClick={()=>startFix(item)}>Correct</button>}
     {editing&&<><button type="button" className="primary" disabled={!!busy||(built!==undefined&&'problem' in built)||(item.reason==='organization'&&!draft.organization)} onClick={()=>fix(item)}>{busy===item.id?'Copying…':'Copy to Intake'}</button><button type="button" disabled={!!busy} onClick={()=>setOpen('')}>Cancel</button></>}
     <button type="button" disabled={!!busy} onClick={()=>dismiss(item)}>Dismiss</button>
    </div>
   </li>;
  })}</ul>
  {invalid>1&&<div className="directory-actions"><button type="button" disabled={!!busy} onClick={()=>void send('all',JSON.stringify({dismissAll:true,reason:'invalid'}),next=>`Dismissed ${invalid-next.held.filter(item=>item.reason==='invalid').length} unusable attachments.`)}>Dismiss All Not Usable ({invalid})</button></div>}
 </section>;
}
