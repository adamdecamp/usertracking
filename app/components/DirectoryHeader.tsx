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
 setQuery:Setter;
 setAccountFilter:Setter;
 setEmailFilter:Setter;
 setOrganizationFilter:Setter;
 setAffiliationFilter:Setter;
 setRoleFilter:Setter;
 setPrivilegedTypeFilter:Setter;
 setArtifactFilter:Setter;
 setStatusFilter:Setter;
 onFiltersChanged:()=>void;
 onReset:()=>void;
 onSnapshot:()=>void;
 onExport:()=>void;
 onAdd:()=>void;
};

export function DirectoryHeader(props:DirectoryHeaderProps){
 const change=(setter:Setter)=>(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>{setter(event.target.value);props.onFiltersChanged()};
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
   <input placeholder="Search Users, Usernames, Email, Storage Org, Agency, or Contractor…" value={props.query} onChange={change(props.setQuery)}/>
   <select aria-label="User Status Filter" value={props.accountFilter} onChange={change(props.setAccountFilter)}><option>Active users</option><option>Disabled users</option><option>All users</option></select>
   <select aria-label="Official Email Filter" value={props.emailFilter} onChange={change(props.setEmailFilter)}><option>All email statuses</option><option>Official Email missing</option><option>Official Email present</option></select>
   <select aria-label="Storage Organization Filter" value={props.organizationFilter} onChange={change(props.setOrganizationFilter)}><option value="All organizations">All Storage Organizations</option>{props.organizations.map(value=><option key={value}>{value}</option>)}</select>
   <select aria-label="Affiliated Organization Filter" value={props.affiliationFilter} onChange={change(props.setAffiliationFilter)}><option value="All affiliated organizations">All Affiliated Organizations</option>{props.affiliatedOrganizations.map(value=><option key={value}>{value}</option>)}</select>
   <select aria-label="Role Filter" value={props.roleFilter} onChange={event=>{props.setRoleFilter(event.target.value);if(event.target.value==='General')props.setPrivilegedTypeFilter('All privileged user types');props.onFiltersChanged()}}><option value="All roles">All Roles</option><option>General</option><option>Privileged</option></select>
   {props.roleFilter!=='General'&&<select aria-label="Privileged User Type Filter" value={props.privilegedTypeFilter} onChange={change(props.setPrivilegedTypeFilter)}><option value="All privileged user types">All Privileged User Types</option>{props.privilegedTypes.map(value=><option key={value}>{value}</option>)}</select>}
   <select aria-label="Artifact Filter" value={props.artifactFilter} onChange={change(props.setArtifactFilter)}><option value="All artifacts">All Artifacts</option>{props.artifactKinds.map(value=><option key={value}>{value}</option>)}</select>
   <select aria-label="Compliance Status Filter" value={props.statusFilter} onChange={change(props.setStatusFilter)}><option value="All statuses">All Statuses</option><option>Missing</option><option>Due Within 30 Days</option><option>Overdue</option><option>Current</option></select>
   <button type="button" onClick={props.onReset}>Reset Filters</button>
  </div>
 </div>
}
