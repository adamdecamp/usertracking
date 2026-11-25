'use client';

import {useState} from 'react';
import {contactLimits,contactMethodProblem,contactPositionChoices,normalizeContact,sortContacts,type ContactMethod,type ContactMethodType,type OrganizationContact} from '../domain/organization-contacts';

const otherPosition='__other__';
type Draft={id:string;organization:string;position:string;customPosition:string;name:string;methods:ContactMethod[]};

const placeholder=(type:ContactMethodType)=>type==='Email'?'name@example.mil':'(555) 555-0100 x123';

/** Program Manager, CPSO/FSO/GSSO, ISSM, ISSO, System Administrator, and custom positions for each organization. */
export function OrganizationContacts({organizations,contacts,onSave,readOnly=false}:{organizations:readonly string[];contacts:readonly OrganizationContact[];onSave:(contacts:OrganizationContact[])=>Promise<void>;readOnly?:boolean}){
 const[draft,setDraft]=useState<Draft>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[filter,setFilter]=useState('all');
 const choices=contactPositionChoices(contacts),allOrganizations=Array.from(new Set([...organizations,...contacts.map(contact=>contact.organization)])).sort((left,right)=>left.localeCompare(right));
 const shown=sortContacts(contacts.filter(contact=>filter==='all'||contact.organization===filter)),groups=Array.from(new Set(shown.map(contact=>contact.organization)));
 const save=async(next:OrganizationContact[],done:string)=>{setBusy(true);setError('');setStatus('');try{await onSave(sortContacts(next));setDraft(undefined);setStatus(done)}catch(caught){setError(caught instanceof Error?caught.message:'The contacts could not be saved.')}finally{setBusy(false)}};
 const startAdd=()=>{setError('');setStatus('');setDraft({id:crypto.randomUUID(),organization:filter!=='all'?filter:allOrganizations.length===1?allOrganizations[0]:'',position:'',customPosition:'',name:'',methods:[{type:'Email',value:''}]})};
 const startEdit=(contact:OrganizationContact)=>{setError('');setStatus('');setDraft({id:contact.id,organization:contact.organization,position:choices.includes(contact.position)?contact.position:otherPosition,customPosition:choices.includes(contact.position)?'':contact.position,name:contact.name,methods:contact.methods.map(method=>({...method}))})};
 const submit=()=>{if(!draft)return;try{const contact=normalizeContact({id:draft.id,organization:draft.organization,position:draft.position===otherPosition?draft.customPosition:draft.position,name:draft.name,methods:draft.methods},allOrganizations);const exists=contacts.some(item=>item.id===contact.id);void save(exists?contacts.map(item=>item.id===contact.id?contact:item):[...contacts,contact],`${exists?'Updated':'Added'} ${contact.position} ${contact.name} for ${contact.organization}.`)}catch(caught){setError(caught instanceof Error?caught.message:'The contact is incomplete.')}};
 const remove=(contact:OrganizationContact)=>{if(globalThis.confirm(`Remove ${contact.position} ${contact.name} from ${contact.organization}?`))void save(contacts.filter(item=>item.id!==contact.id),`Removed ${contact.position} ${contact.name} from ${contact.organization}.`)};
 const update=(change:Partial<Draft>)=>setDraft(current=>current&&{...current,...change});
 const updateMethod=(index:number,change:Partial<ContactMethod>)=>setDraft(current=>current&&{...current,methods:current.methods.map((method,position)=>position===index?{...method,...change}:method)});
 return <section className="organization-contacts" aria-label="Organization Contacts">
  <h3>Organization Contacts</h3>
  {readOnly?<p className="hint">This session is read-only, so contacts can be viewed but not changed. Select an email address or phone number to contact them.</p>:<p className="hint">Record who to contact for each organization. Choose a standard position or <b>Other</b> to create your own; custom positions are offered for every organization in this system. Changes are saved to the database, audited, and included in the next Session Commit.</p>}
  <div className="directory-actions">
   <label className="organization-contacts-filter">Organization<select aria-label="Filter Contacts by Organization" value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All Organizations</option>{allOrganizations.map(value=><option key={value}>{value}</option>)}</select></label>
   {!readOnly&&<button type="button" className="primary" disabled={busy||!!draft||!allOrganizations.length||contacts.length>=contactLimits.perSystem} onClick={startAdd}>Add Contact</button>}
  </div>
  {!readOnly&&!allOrganizations.length&&<p className="hint">Create an organization before adding its contacts.</p>}
  {draft&&<div className="organization-contact-form">
   <div className="form-grid">
    <label><span>Organization</span><select aria-label="Contact Organization" value={draft.organization} onChange={event=>update({organization:event.target.value})}><option value="">Choose…</option>{allOrganizations.map(value=><option key={value}>{value}</option>)}</select></label>
    <label><span>Position</span><select aria-label="Position" value={draft.position} onChange={event=>update({position:event.target.value})}><option value="">Choose…</option>{choices.map(value=><option key={value}>{value}</option>)}<option value={otherPosition}>Other…</option></select></label>
    {draft.position===otherPosition&&<label><span>New Position</span><input aria-label="New Position" value={draft.customPosition} maxLength={contactLimits.position} placeholder="Security Officer" onChange={event=>update({customPosition:event.target.value})}/></label>}
    <label><span>Name</span><input aria-label="Contact Name" value={draft.name} maxLength={contactLimits.name} onChange={event=>update({name:event.target.value})}/></label>
   </div>
   {draft.methods.map((method,index)=>{const problem=method.value.trim()?contactMethodProblem(method):undefined;return <div className="form-grid organization-contact-method" key={index}>
    <label><span>Contact By</span><select aria-label={`Contact Method ${index+1}`} value={method.type} onChange={event=>updateMethod(index,{type:event.target.value as ContactMethodType,value:''})}><option>Email</option><option>Phone</option></select></label>
    <label><span>{method.type==='Email'?'Email Address':'Phone Number'}</span><input aria-label={`${method.type==='Email'?'Email Address':'Phone Number'} ${index+1}`} type={method.type==='Email'?'email':'tel'} value={method.value} maxLength={method.type==='Email'?contactLimits.email:contactLimits.phone} placeholder={placeholder(method.type)} onChange={event=>updateMethod(index,{value:event.target.value})}/>{problem&&<small className="restore-warning">{problem}</small>}</label>
    {draft.methods.length>1&&<button type="button" onClick={()=>update({methods:draft.methods.filter((_,position)=>position!==index)})}>Remove</button>}
   </div>})}
   <div className="directory-actions">
    <button type="button" disabled={draft.methods.length>=contactLimits.methods} onClick={()=>update({methods:[...draft.methods,{type:draft.methods.some(method=>method.type==='Email')?'Phone':'Email',value:''}]})}>Add Email or Phone</button>
    <button type="button" className="primary" disabled={busy} onClick={submit}>{busy?'Saving…':'Save Contact'}</button>
    <button type="button" disabled={busy} onClick={()=>{setDraft(undefined);setError('')}}>Cancel</button>
   </div>
  </div>}
  {status&&<p className="renamer-message" aria-live="polite">{status}</p>}
  {error&&<p className="restore-warning" role="alert">{error}</p>}
  {groups.map(organization=><div key={organization} className="organization-contact-group">
   <h4>{organization}</h4>
   <div className="system-list">{shown.filter(contact=>contact.organization===organization).map(contact=><div key={contact.id}>
    <div><strong>{contact.position}</strong><small>{contact.name}</small><small>{contact.methods.map((method,index)=><span key={index}>{index>0?' · ':''}<a href={method.type==='Email'?`mailto:${method.value}`:`tel:${method.value.replace(/[^0-9+]/g,'')}`}>{method.value}</a></span>)}</small></div>
    {!readOnly&&<div className="directory-actions"><button type="button" disabled={busy||!!draft} onClick={()=>startEdit(contact)}>Edit</button><button type="button" disabled={busy||!!draft} onClick={()=>remove(contact)}>Remove</button></div>}
   </div>)}</div>
  </div>)}
  {!contacts.length&&(readOnly||allOrganizations.length>0)&&<div className="empty">No contacts have been added yet.</div>}
 </section>;
}
