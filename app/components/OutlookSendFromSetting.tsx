'use client';

import {useEffect,useRef,useState} from 'react';
import {decodeJsonResponse} from '../infrastructure/runtime-decoders';
import {decodeOutlookSendFrom} from '../infrastructure/outlook-intake-contract';
import type {OutlookIntakeRequest} from './OutlookIntakePanel';

/** Shows and changes this computer's group mailbox for every Outlook draft R.A.P.T.O.R. prepares. */
export function OutlookSendFromSetting({request}:{request?:OutlookIntakeRequest}){
 const[address,setAddress]=useState<string>(),[draft,setDraft]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // The parent recreates `request` on every render, so load once per availability change.
 const latest=useRef(request),available=!!request;
 useEffect(()=>{latest.current=request});
 useEffect(()=>{
  const current=latest.current;if(!available||!current)return;let active=true;
  current('outlook-sender').then(response=>decodeJsonResponse(response,'Outlook Send From',decodeOutlookSendFrom)).then(value=>{if(active)setAddress(value.address)},caught=>{if(active)setError(caught instanceof Error?caught.message:'The Send From mailbox could not be read.')});
  return()=>{active=false};
 },[available]);
 if(!request)return null;
 const save=async(next:string)=>{
  setBusy(true);setError('');
  try{const value=await decodeJsonResponse(await request('outlook-sender',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:next.trim()})}),'Outlook Send From',decodeOutlookSendFrom);setAddress(value.address);setEditing(false)}
  catch(caught){setError(caught instanceof Error?caught.message:'The Send From mailbox could not be saved.')}
  finally{setBusy(false)}
 };
 return <div className="outlook-intake" aria-label="Send From Mailbox">
  <p><b>Send From:</b> {address===undefined?'Checking…':address||'Your default Outlook account'} <small className="hint">(this computer)</small>{!editing&&<> <button type="button" disabled={address===undefined||busy} onClick={()=>{setDraft(address??'');setEditing(true)}}>Change</button></>}</p>
  {editing&&<div className="directory-actions"><input type="email" aria-label="Group mailbox address" placeholder="compliance@example.mil" value={draft} maxLength={254} onChange={event=>setDraft(event.target.value)}/><button type="button" className="primary" disabled={busy||!draft.trim()} onClick={()=>void save(draft)}>Save</button>{address&&<button type="button" disabled={busy} onClick={()=>void save('')}>Use My Account</button>}<button type="button" disabled={busy} onClick={()=>setEditing(false)}>Cancel</button></div>}
  <p className="hint">Every Outlook draft from R.A.P.T.O.R. on this computer opens from this mailbox, and you still review and send it. Your Exchange account needs Send As or Send on Behalf permission for a group mailbox. If classic Outlook is unavailable, no draft opens rather than one from your personal address.</p>
  {error&&<p className="restore-warning" role="alert">{error}</p>}
 </div>;
}
