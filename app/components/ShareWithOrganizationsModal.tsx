'use client';

import {useState} from 'react';
import type {SystemRecord,UserRecord} from '../domain/tracker-models';
import {organizationContactEmails,organizationEmailPlan,whileOutlookDraftBusy} from '../application/organization-report-email';
import {organizationCsv,organizationCsvEmail,organizationStatusEmail,organizationStatusFilename,organizationStatusPayload} from '../application/organization-share-email';
import {createOrganizationStatusPackage} from '../organization-status-package';
import type {OrganizationServices} from './organization-services';

/** Each organization's email goes to its Organization Contacts in these positions, as for the Compliance Snapshot. */
const emailPositions=['ISSM','ISSO'];

/**
 * One place to send status to organizations. It picks the organizations, then
 * offers the three formats: the Compliance Snapshot PDF, a one-row-per-user CSV,
 * and the read-only Organization Status File for an ISSO. Each can be downloaded
 * or emailed to each organization's contacts as its own Outlook draft. The PDF
 * and single status file open their existing windows with the organizations chosen.
 */
export function ShareWithOrganizationsModal({system,users,services,onPdf,onStatusFile}:{system:SystemRecord;users:UserRecord[];services:OrganizationServices;onPdf:(organizations:string[],emailing:boolean)=>void;onStatusFile:(organization:string)=>void}){
 const active=users.filter(user=>!user.disabled),organizations=Array.from(new Set(active.map(user=>user.organization).filter(Boolean))).sort((left,right)=>left.localeCompare(right));
 const[selected,setSelected]=useState<string[]>(organizations),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const chosen=organizations.filter(value=>selected.includes(value)),contacts=system.organizationContacts??[],inScope=active.filter(user=>chosen.includes(user.organization));
 const plan=organizationEmailPlan(chosen,contacts,emailPositions),emailable=plan.filter(item=>item.recipients.length),missing=plan.filter(item=>!item.recipients.length).map(item=>item.organization);
 const toggle=(value:string)=>setSelected(current=>current.includes(value)?current.filter(item=>item!==value):[...current,value]);
 async function downloadCsv(){
  setBusy(true);setMessage('');
  try{
   const asOf=new Date(),result=organizationCsv(system,active,chosen,asOf);
   const link=document.createElement('a'),url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'}));link.href=url;link.download=result.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
   services.warnAudit(await services.audit(`EXPORT ORGANIZATION COMPLIANCE CSV: system ${system.name}; organizations ${chosen.join(', ')}; ${result.rowCount} active users; ${result.notCompliant} not compliant`,system.id));
   setMessage(`${result.filename} was downloaded with ${result.rowCount} active user${result.rowCount===1?'':'s'}, one per row. ${result.notCompliant} ${result.notCompliant===1?'is':'are'} not compliant.`);
  }catch(error){setMessage(await services.report('Organization CSV export failed.',error,system.id,'The CSV could not be created.'))}finally{setBusy(false)}
 }
 /** Opens one Outlook draft per organization with its own attachment; each is audited before it opens. */
 async function emailEach(kind:'csv'|'status'){
  if(!services.mapped(system.id)){setMessage('Map this information system folder before emailing organizations so each export can be audited.');return}
  setBusy(true);setMessage('');let opened=0;const label=kind==='csv'?'CSV':'Status File';
  try{
   for(const item of emailable){
    const organization=item.organization,asOf=new Date();let attachment:{filename:string;text:string},email:{subject:string;body:string},detail:string;
    if(kind==='csv'){const result=organizationCsv(system,active,[organization],asOf);if(!result.rowCount)continue;attachment={filename:result.filename,text:result.csv};email=organizationCsvEmail(system,organization,asOf,result.rowCount,result.notCompliant);detail=`${result.rowCount} active users; ${result.notCompliant} not compliant`}
    else{const payload=organizationStatusPayload(system,users,organization,asOf),disabled=payload.users.filter(user=>user.disabled).length;attachment={filename:organizationStatusFilename(system,organization,asOf),text:JSON.stringify(await createOrganizationStatusPackage(payload),null,2)};email=organizationStatusEmail(system,organization,{total:payload.users.length,active:payload.users.length-disabled,disabled},payload.generatedAtUtc,false);detail=`${payload.users.length} users including ${disabled} disabled; protection integrity only`}
    if(!(await services.audit(`PREPARE ORGANIZATION ${kind==='csv'?'COMPLIANCE CSV':'STATUS FILE'} EMAIL: organization ${organization}; recipients ${item.recipients.join(', ')}; ${detail}; attachment ${attachment.filename}`,system.id)))throw new Error(`The audit record for the ${organization} email could not be written, so its draft was not opened.`);
    const operation=await whileOutlookDraftBusy(()=>services.draft(system.id,{to:item.recipients.join('; '),subject:email.subject,body:email.body,attachmentFilename:attachment.filename,attachmentText:attachment.text,auditSystemIds:[system.id]}));
    if(operation===null)throw new Error('Emailing each organization requires the R.A.P.T.O.R. portable application.');
    opened++;
   }
   setMessage(`${opened} Outlook draft${opened===1?'':'s'} with the ${label} attached ${opened===1?'is':'are'} opening for review.${missing.length?` Not emailed (no ISSM/ISSO email): ${missing.join(', ')}.`:''}`);
  }catch(error){const reported=await services.report(`Emailing each organization the ${label} failed.`,error,system.id,'The organization drafts could not be prepared.');setMessage(`${opened?`${opened} draft${opened===1?' was':'s were'} opened before this stopped. `:''}${reported}`)}finally{setBusy(false)}
 }
 const emailHint=missing.length?` ${missing.length} selected organization${missing.length===1?' has':'s have'} no ISSM/ISSO email and will be skipped.`:'';
 return <><p className="eyebrow">{system.name}</p><h2>Share with Organizations</h2>
  <p className="hint">Choose the organizations, then how to share their status. Nothing is sent automatically; emails open as Outlook drafts for you to review.</p>
  <div className="directory-actions"><button type="button" onClick={()=>setSelected(organizations)}>Select All</button><button type="button" onClick={()=>setSelected([])}>Clear</button></div>
  <div className="check-grid" role="group" aria-label="Organizations to Share">{organizations.map(organization=>{const emails=organizationContactEmails(contacts,organization,emailPositions).length;return <label key={organization}><input type="checkbox" checked={selected.includes(organization)} onChange={()=>toggle(organization)}/>{organization}<small> {active.filter(user=>user.organization===organization).length} users · {emails?`${emails} ISSM/ISSO email${emails===1?'':'s'}`:'no ISSM/ISSO email'}</small></label>})}</div>
  {!organizations.length&&<div className="empty">No active users are in this system yet.</div>}
  <div className="share-options">
   <section className="change-box"><strong>Compliance Snapshot (PDF)</strong><p className="hint">A PDF of each requirement&apos;s status, stored and audited in the Reports folder. Email it to give each organization its own PDF, addressed to its Organization Contacts.</p><div className="directory-actions"><button type="button" disabled={!chosen.length} onClick={()=>onPdf(chosen,false)}>Create PDF</button><button type="button" className="primary" disabled={!chosen.length} onClick={()=>onPdf(chosen,true)}>Email Each Organization</button></div></section>
   <section className="change-box"><strong>Spreadsheet (CSV)</strong><p className="hint">One row per active user, with Compliance first so it can be filtered in Excel, and what each user still needs. Email it to give each organization a spreadsheet of only its own users, addressed to its ISSM and ISSO.{emailHint}</p><div className="directory-actions"><button type="button" disabled={busy||!inScope.length} onClick={()=>void downloadCsv()}>{busy?'Preparing…':'Download CSV'}</button><button type="button" className="primary" disabled={busy||!emailable.length} onClick={()=>void emailEach('csv')}>Email Each Organization</button></div></section>
   <section className="change-box"><strong>Organization Status File</strong><p className="hint">A read-only file for an organization&apos;s ISSO to open in R.A.P.T.O.R. without access to the shared folder. Email it to give each organization its own file, addressed to its ISSM and ISSO; to encrypt a file with a passphrase, create it for one organization.{emailHint}</p><div className="directory-actions"><button type="button" disabled={busy||chosen.length!==1} title={chosen.length!==1?'Select exactly one organization.':undefined} onClick={()=>onStatusFile(chosen[0])}>Create Status File</button><button type="button" className="primary" disabled={busy||!emailable.length} onClick={()=>void emailEach('status')}>Email Each Organization</button></div></section>
  </div>
  {message&&<p className="renamer-message" aria-live="polite">{message}</p>}
 </>;
}
