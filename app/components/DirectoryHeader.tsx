import type {Dispatch,SetStateAction} from 'react';

type Setter=Dispatch<SetStateAction<string>>;

type DirectoryHeaderProps={
 title?:string;
 canWrite:boolean;
 hasSystem:boolean;
 hasUsers:boolean;
 hasVisibleUsers:boolean;
 query:string;
 accountFilter:string;
 emailFilter:string;
 saarFilter:string;
 organizationFilter:string;
 affiliationFilter:string;
 roleFilter:string;
 privilegedTypeFilter:string;
 artifactFilter:string;
 statusFilter:string;
 organizations:string[];
 affiliatedOrganizations:string[];
 privilegedTypes:string[];
 artifactKinds:readonly string[];
 directoryColumns:readonly (readonly [string,string])[];
 visibleColumnKinds:string[];
 setQuery:Setter;
 setAccountFilter:Setter;
 setEmailFilter:Setter;
 setSaarFilter:Setter;
 setOrganizationFilter:Setter;
 setAffiliationFilter:Setter;
 setRoleFilter:Setter;
 setPrivilegedTypeFilter:Setter;
 setArtifactFilter:Setter;
 setStatusFilter:Setter;
 setVisibleColumnKinds:(value:string[])=>void;
 onFiltersChanged:()=>void;
 onReset:()=>void;
 onSnapshot:()=>void;
 onExport:()=>void;
 onAdd:()=>void;
};

export function DirectoryHeader(props:DirectoryHeaderProps){
 const change=(setter:Setter)=>(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>{setter(event.target.value);props.onFiltersChanged()};
 // Highlight any filter that is narrowing the list, so nothing filters silently.
 const on=(active:boolean)=>active?'active':undefined;
 const anyActive=!!props.query.trim()||props.accountFilter!=='Active users'||props.statusFilter!=='All statuses'||props.roleFilter!=='All roles'||props.emailFilter!=='All email statuses'||props.saarFilter!=='All SAAR statuses'||props.organizationFilter!=='All organizations'||props.affiliationFilter!=='All affiliated organizations'||props.privilegedTypeFilter!=='All privileged user types'||props.artifactFilter!=='All artifacts';
 const toggleColumn=(kind:string)=>{const shown=props.visibleColumnKinds.includes(kind);props.setVisibleColumnKinds(shown?props.visibleColumnKinds.filter(value=>value!==kind):Array.from(new Set([...props.visibleColumnKinds,kind])))};
 const allColumnsShown=props.directoryColumns.every(([,kind])=>props.visibleColumnKinds.includes(kind));
 return <div className="directory-head">
  <div className="directory-title-row">
   <div><p className="eyebrow">User Directory</p><h2>{props.title??'No Information Systems Configured'}</h2></div>
   {props.canWrite&&<div className="directory-actions">
    <button disabled={!props.hasSystem||!props.hasUsers} onClick={props.onSnapshot}>Organization Snapshot</button>
    <button disabled={!props.hasSystem||!props.hasVisibleUsers} onClick={props.onExport}>Export CSV</button>
    <button className="primary" disabled={!props.hasSystem} onClick={props.onAdd}>+ Add User</button>
   </div>}
  </div>
  <div className="filters">
   <input aria-label="Search User Directory" className={on(!!props.query.trim())} placeholder="Search Users, Usernames, Email, Storage Org, Agency, or Contractor…" value={props.query} onChange={change(props.setQuery)}/>
   <select aria-label="User Status Filter" className={on(props.accountFilter!=='Active users')} value={props.accountFilter} onChange={change(props.setAccountFilter)}><option>Active users</option><option>Disabled users</option><option>All users</option></select>
   <select aria-label="Compliance Status Filter" className={on(props.statusFilter!=='All statuses')} value={props.statusFilter} onChange={change(props.setStatusFilter)}><option value="All statuses">All Statuses</option><option>Missing</option><option>Due Within 30 Days</option><option>Overdue</option><option>Current</option></select>
   <select aria-label="Artifact Filter" className={on(props.artifactFilter!=='All artifacts')} value={props.artifactFilter} onChange={change(props.setArtifactFilter)}><option value="All artifacts">All Artifacts</option>{props.artifactKinds.map(value=><option key={value}>{value}</option>)}</select>
   <select aria-label="Role Filter" className={on(props.roleFilter!=='All roles')} value={props.roleFilter} onChange={event=>{props.setRoleFilter(event.target.value);if(event.target.value==='General')props.setPrivilegedTypeFilter('All privileged user types');props.onFiltersChanged()}}><option value="All roles">All Roles</option><option>General</option><option>Privileged</option></select>
   {props.roleFilter!=='General'&&<select aria-label="Privileged User Type Filter" className={on(props.privilegedTypeFilter!=='All privileged user types')} value={props.privilegedTypeFilter} onChange={change(props.setPrivilegedTypeFilter)}><option value="All privileged user types">All Privileged Types</option>{props.privilegedTypes.map(value=><option key={value}>{value}</option>)}</select>}
   <select aria-label="SAAR Status Filter" className={on(props.saarFilter!=='All SAAR statuses')} value={props.saarFilter} onChange={change(props.setSaarFilter)}><option>All SAAR statuses</option><option>SAAR missing</option><option>SAAR present</option></select>
   <select aria-label="Official Email Filter" className={on(props.emailFilter!=='All email statuses')} value={props.emailFilter} onChange={change(props.setEmailFilter)}><option>All email statuses</option><option>Official Email missing</option><option>Official Email present</option></select>
   <select aria-label="Storage Organization Filter" className={on(props.organizationFilter!=='All organizations')} value={props.organizationFilter} onChange={change(props.setOrganizationFilter)}><option value="All organizations">All Storage Orgs</option>{props.organizations.map(value=><option key={value}>{value}</option>)}</select>
   <select aria-label="Affiliated Organization Filter" className={on(props.affiliationFilter!=='All affiliated organizations')} value={props.affiliationFilter} onChange={change(props.setAffiliationFilter)}><option value="All affiliated organizations">All Affiliations</option>{props.affiliatedOrganizations.map(value=><option key={value}>{value}</option>)}</select>
  </div>
  <div className="directory-subbar">
   <div className="column-chips" role="group" aria-label="Requirement Columns"><span>Columns</span>{props.directoryColumns.map(([label,kind])=><button key={kind} type="button" aria-pressed={props.visibleColumnKinds.includes(kind)} onClick={()=>toggleColumn(kind)}>{label}</button>)}{!allColumnsShown&&<button type="button" className="show-all" onClick={()=>props.setVisibleColumnKinds(props.directoryColumns.map(([,kind])=>kind))}>Show All</button>}</div>
   <button type="button" disabled={!anyActive} onClick={props.onReset}>Reset Filters</button>
  </div>
 </div>
}
