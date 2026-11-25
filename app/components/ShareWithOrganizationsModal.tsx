'use client';

import {useState} from 'react';
import type {SystemRecord,UserRecord} from '../domain/tracker-models';
import {filteredDirectoryCsvRows} from '../csv-utils';
import {oneLineText as oneLine} from '../error-utils';
import {organizationContactEmails} from '../application/organization-report-email';
import type {OrganizationServices} from './organization-services';

const safeFilePart=(value:string,maxLength=80)=>oneLine(value).replace(/[<>:"/\\|?*]/g,'_').replace(/[. ]+$/g,'').slice(0,maxLength)||'Unknown';

/**
 * One place to send status to organizations. It picks the organizations, then
 * offers the three formats: the Compliance Snapshot PDF (downloaded or emailed
 * to each organization's contacts), a one-row-per-user CSV, and the read-only
 * Organization Status File for an ISSO. The PDF and status file open their
 * existing windows with the organizations already chosen.
 */
export function ShareWithOrganizationsModal({system,users,services,onPdf,onStatusFile}:{system:SystemRecord;users:UserRecord[];services:OrganizationServices;onPdf:(organizations:string[],emailing:boolean)=>void;onStatusFile:(organization:string)=>void}){
 const active=users.filter(user=>!user.disabled),organizations=Array.from(new Set(active.map(user=>user.organization).filter(Boolean))).sort((left,right)=>left.localeCompare(right));
 const[selected,setSelected]=useState<string[]>(organizations),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const chosen=organizations.filter(value=>selected.includes(value)),contacts=system.organizationContacts??[],inScope=active.filter(user=>chosen.includes(user.organization));
 const toggle=(value:string)=>setSelected(current=>current.includes(value)?current.filter(item=>item!==value):[...current,value]);
 async function downloadCsv(){
  setBusy(true);setMessage('');
  try{
   const asOf=new Date(),result=filteredDirectoryCsvRows(inScope,system,asOf),label=chosen.length===1?`${safeFilePart(chosen[0],60)}_`:'',filename=`${safeFilePart(system.name,80)}_${label}Compliance_${asOf.toISOString().slice(0,10).replaceAll('-','')}.csv`;
   const link=document.createElement('a'),url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'}));link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
   services.warnAudit(await services.audit(`EXPORT ORGANIZATION COMPLIANCE CSV: system ${system.name}; organizations ${chosen.join(', ')}; ${result.rowCount} active users; ${result.notCompliant} not compliant`,system.id));
   setMessage(`${filename} was downloaded with ${result.rowCount} active user${result.rowCount===1?'':'s'}, one per row. ${result.notCompliant} ${result.notCompliant===1?'is':'are'} not compliant.`);
  }catch(error){setMessage(await services.report('Organization CSV export failed.',error,system.id,'The CSV could not be created.'))}finally{setBusy(false)}
 }
 return <><p className="eyebrow">{system.name}</p><h2>Share with Organizations</h2>
  <p className="hint">Choose the organizations, then how to share their status. Nothing is sent automatically; emails open as Outlook drafts for you to review.</p>
  <div className="directory-actions"><button type="button" onClick={()=>setSelected(organizations)}>Select All</button><button type="button" onClick={()=>setSelected([])}>Clear</button></div>
  <div className="check-grid" role="group" aria-label="Organizations to Share">{organizations.map(organization=>{const emails=organizationContactEmails(contacts,organization,['ISSM','ISSO']).length;return <label key={organization}><input type="checkbox" checked={selected.includes(organization)} onChange={()=>toggle(organization)}/>{organization}<small> {active.filter(user=>user.organization===organization).length} users · {emails?`${emails} ISSM/ISSO email${emails===1?'':'s'}`:'no ISSM/ISSO email'}</small></label>})}</div>
  {!organizations.length&&<div className="empty">No active users are in this system yet.</div>}
  <div className="share-options">
   <section className="change-box"><strong>Compliance Snapshot (PDF)</strong><p className="hint">A PDF of each requirement&apos;s status, stored and audited in the Reports folder. Email it to give each organization its own PDF, addressed to its Organization Contacts.</p><div className="directory-actions"><button type="button" disabled={!chosen.length} onClick={()=>onPdf(chosen,false)}>Create PDF</button><button type="button" className="primary" disabled={!chosen.length} onClick={()=>onPdf(chosen,true)}>Email Each Organization</button></div></section>
   <section className="change-box"><strong>Spreadsheet (CSV)</strong><p className="hint">One row per active user, with Compliance first so it can be filtered in Excel, and what each user still needs.</p><div className="directory-actions"><button type="button" disabled={busy||!inScope.length} onClick={()=>void downloadCsv()}>{busy?'Preparing…':'Download CSV'}</button></div></section>
   <section className="change-box"><strong>Organization Status File</strong><p className="hint">A read-only file for one organization&apos;s ISSO to open in R.A.P.T.O.R. without access to the shared folder.{chosen.length!==1?' Select exactly one organization.':''}</p><div className="directory-actions"><button type="button" disabled={chosen.length!==1} onClick={()=>onStatusFile(chosen[0])}>Create Status File</button></div></section>
  </div>
  {message&&<p className="renamer-message" aria-live="polite">{message}</p>}
 </>;
}
