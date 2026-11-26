'use client';

import {useEffect,useState} from 'react';
import type {SystemRecord,UserRecord} from '../domain/tracker-models';
import type {OrganizationContact} from '../domain/organization-contacts';
import {validOrganizationFolderName} from '../document-renamer-utils';
import {oneLineText as oneLine} from '../error-utils';
import {OrganizationContacts} from './OrganizationContacts';
import type {OrganizationServices} from './organization-services';

const byName=(left:string,right:string)=>left.localeCompare(right);

/** Organization folders and contacts are read once, from storage when mapped and from user records otherwise. */
function useOrganizationNames(system:SystemRecord,users:UserRecord[],services:OrganizationServices){
 const[organizations,setOrganizations]=useState<string[]>([]),[loading,setLoading]=useState(true),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;const recorded=users.map(user=>user.organization);void services.listOrganizations(system.id,recorded).then(folders=>{if(active)setOrganizations(Array.from(new Set([...folders,...recorded.filter(validOrganizationFolderName)])).sort(byName))}).catch(async error=>{const reported=await services.report('Organization folder listing failed.',error,system.id,'The Organizations folder could not be read.');if(active){setOrganizations(Array.from(new Set(recorded.filter(validOrganizationFolderName))).sort(byName));setMessage(reported)}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[services,system.id,users]);
 return{organizations,setOrganizations,loading,message,setMessage};
}

function OrganizationsModal({system,users,services,onContacts}:{system:SystemRecord;users:UserRecord[];services:OrganizationServices;onContacts:(contacts:OrganizationContact[])=>Promise<void>}){
 const{organizations,setOrganizations,loading,message,setMessage}=useOrganizationNames(system,users,services),[name,setName]=useState(''),[saving,setSaving]=useState(false);
 async function create(){const requested=oneLine(name);if(!validOrganizationFolderName(requested)){setMessage('Enter a valid organization name. Document types such as SAAR are reserved and cannot be organizations.');return}if(organizations.some(value=>value.toUpperCase()===requested.toUpperCase())){setMessage(`${requested} already exists in the Organizations folder.`);return}setSaving(true);setMessage('');try{const created=await services.createOrganization(system.id,requested);setOrganizations(current=>[...current,created].sort(byName));setName('');setMessage(`${created} was created at Organizations/${created}.`);services.warnAudit(await services.audit(`CREATE ORGANIZATION FOLDER: Organizations/${created}`,system.id))}catch(error){setMessage(await services.report('Organization folder creation failed.',error,system.id,'The organization folder could not be created.'))}finally{setSaving(false)}}
 return <><p className="eyebrow">Mapped Folder Administration</p><h2>Manage Organizations</h2><p className="hint">Organization folders are stored under <b>Organizations</b> in this information system. Document-type folders such as SAAR are created inside an organization and are never treated as organizations.</p><div className="form-grid add-system"><input maxLength={80} placeholder="Organization Name" aria-label="New Organization Name" value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void create()}}/><button className="primary" disabled={saving||!name.trim()} onClick={()=>void create()}>{saving?'Creating…':'Create Organization'}</button></div>{message&&<p className="renamer-message" aria-live="polite">{message}</p>}<div className="system-list">{organizations.map(organization=><div key={organization}><div><strong>{organization}</strong><small>Organizations/{organization}</small></div></div>)}{loading&&<div className="empty">Reading Organization Folders…</div>}{!loading&&!organizations.length&&<div className="empty">No organizations have been created for this system.</div>}</div>{!loading&&<OrganizationContacts organizations={organizations} contacts={system.organizationContacts??[]} onSave={onContacts}/>}</>;
}

type ModalProps={system:SystemRecord;users:UserRecord[];services:OrganizationServices;canWrite:boolean;manage:boolean;onContacts:(contacts:OrganizationContact[])=>Promise<void>};

/**
 * Manage Organizations (folders and contacts) when `manage` is set; otherwise
 * Organization Contacts on their own, opened directly from the User Directory,
 * which read-only sessions can view and use.
 */
export function OrganizationContactsModal({manage,canWrite,...props}:ModalProps){
 return manage&&canWrite?<OrganizationsModal {...props}/>:<ContactsOnly {...props} canWrite={canWrite}/>;
}

function ContactsOnly({system,users,services,canWrite,onContacts}:Omit<ModalProps,'manage'>){
 const{organizations,loading,message}=useOrganizationNames(system,users,services);
 return <><p className="eyebrow">{system.name}</p><h2>Organization Contacts</h2>{message&&<p className="renamer-message" aria-live="polite">{message}</p>}{loading?<div className="empty">Reading Organizations…</div>:<OrganizationContacts organizations={organizations} contacts={system.organizationContacts??[]} onSave={onContacts} readOnly={!canWrite}/>}</>;
}
