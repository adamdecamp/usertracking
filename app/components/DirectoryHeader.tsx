import {useState,type Dispatch,type SetStateAction} from 'react';
import {complianceFilterAll,complianceFilterChoices,complianceLabels} from '../application/user-compliance';

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
 complianceFilter:string;
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
 setComplianceFilter:Setter;
 setVisibleColumnKinds:(value:string[])=>void;
 onFiltersChanged:()=>void;
 onReset:()=>void;
 onSnapshot:()=>void;
 onContacts:()=>void;
 onExport:()=>void;
 onAdd:()=>void;
};

type QuickView={label:string;matches:(props:DirectoryHeaderProps)=>boolean;apply:(props:DirectoryHeaderProps)=>void};

/** One-click views for the questions operators ask most. Each starts from the default filters, so a view never combines with a forgotten filter. */
const quickViews:QuickView[]=[
 {label:'Not Compliant',matches:props=>props.complianceFilter===complianceLabels.notCompliant,apply:props=>props.setComplianceFilter(complianceLabels.notCompliant)},
 {label:'Overdue',matches:props=>props.statusFilter==='Overdue',apply:props=>props.setStatusFilter('Overdue')},
 {label:'Due Within 30 Days',matches:props=>props.statusFilter==='Due Within 30 Days',apply:props=>props.setStatusFilter('Due Within 30 Days')},
 {label:'Missing Items',matches:props=>props.statusFilter==='Missing',apply:props=>props.setStatusFilter('Missing')},
 {label:'SAAR Missing',matches:props=>props.saarFilter==='SAAR missing',apply:props=>props.setSaarFilter('SAAR missing')},
 {label:'Official Email Missing',matches:props=>props.emailFilter==='Official Email missing',apply:props=>props.setEmailFilter('Official Email missing')},
];

export function DirectoryHeader(props:DirectoryHeaderProps){
 const[moreOpen,setMoreOpen]=useState(false);
 const change=(setter:Setter)=>(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>{setter(event.target.value);props.onFiltersChanged()};
 // Highlight any filter that is narrowing the list, so nothing filters silently.
 const on=(active:boolean)=>active?'active':undefined;
 const shownActive=[!!props.query.trim(),props.complianceFilter!==complianceFilterAll,props.statusFilter!=='All statuses',props.organizationFilter!=='All organizations'];
 const moreActive=[props.accountFilter!=='Active users',props.artifactFilter!=='All artifacts',props.roleFilter!=='All roles',props.privilegedTypeFilter!=='All privileged user types',props.saarFilter!=='All SAAR statuses',props.emailFilter!=='All email statuses',props.affiliationFilter!=='All affiliated organizations'].filter(Boolean).length;
 const activeCount=shownActive.filter(Boolean).length+moreActive,anyActive=activeCount>0;
 // A narrowing filter is never hidden: More Filters stays open while one of its filters is set.
 const showMore=moreOpen||moreActive>0;
 const toggleColumn=(kind:string)=>{const shown=props.visibleColumnKinds.includes(kind);props.setVisibleColumnKinds(shown?props.visibleColumnKinds.filter(value=>value!==kind):Array.from(new Set([...props.visibleColumnKinds,kind])))};
 const allColumnsShown=props.directoryColumns.every(([,kind])=>props.visibleColumnKinds.includes(kind));
 return <div className="directory-head">
  <div className="directory-title-row">
   <div><p className="eyebrow">User Directory</p><h2>{props.title??'No Information Systems Configured'}</h2></div>
   {/* Organization Contacts is one click away for every session, including read-only ones. */}
   <div className="directory-actions">
    <button disabled={!props.hasSystem} onClick={props.onContacts}>Organization Contacts</button>
    {props.canWrite&&<>
     <button disabled={!props.hasSystem||!props.hasUsers} onClick={props.onSnapshot}>Share with Organizations</button>
     <button disabled={!props.hasSystem||!props.hasVisibleUsers} onClick={props.onExport}>Export CSV</button>
     <button className="primary" disabled={!props.hasSystem} onClick={props.onAdd}>+ Add User</button>
    </>}
   </div>
  </div>
  <div className="quick-views" role="group" aria-label="Quick Views"><span>Quick Views</span>{quickViews.map(view=><button key={view.label} type="button" disabled={!props.hasSystem} aria-pressed={activeCount===1&&view.matches(props)} onClick={()=>{props.onReset();view.apply(props)}}>{view.label}</button>)}</div>
  <div className="filters">
   <input aria-label="Search User Directory" className={on(!!props.query.trim())} placeholder="Search Users, Usernames, Email, Storage Org, Agency, or Contractor…" value={props.query} onChange={change(props.setQuery)}/>
   <select aria-label="User Compliance Filter" className={on(props.complianceFilter!==complianceFilterAll)} value={props.complianceFilter} onChange={change(props.setComplianceFilter)}>{complianceFilterChoices.map(value=><option key={value} value={value}>{value===complianceFilterAll?'Any Compliance':value}</option>)}</select>
   <select aria-label="Compliance Status Filter" className={on(props.statusFilter!=='All statuses')} value={props.statusFilter} onChange={change(props.setStatusFilter)}><option value="All statuses">All Statuses</option><option>Missing</option><option>Due Within 30 Days</option><option>Overdue</option><option>Current</option></select>
   <select aria-label="Storage Organization Filter" className={on(props.organizationFilter!=='All organizations')} value={props.organizationFilter} onChange={change(props.setOrganizationFilter)}><option value="All organizations">All Storage Orgs</option>{props.organizations.map(value=><option key={value}>{value}</option>)}</select>
   <button type="button" className={on(moreActive>0)} aria-expanded={showMore} aria-controls="more-directory-filters" disabled={moreActive>0} title={moreActive>0?'Clear these filters or choose Reset Filters to hide them.':undefined} onClick={()=>setMoreOpen(value=>!value)}>{showMore?'Fewer Filters':'More Filters'}{moreActive>0?` (${moreActive} Set)`:''}</button>
  </div>
  {showMore&&<div className="filters more-filters" id="more-directory-filters">
   <select aria-label="User Status Filter" className={on(props.accountFilter!=='Active users')} value={props.accountFilter} onChange={change(props.setAccountFilter)}><option>Active users</option><option>Disabled users</option><option>All users</option></select>
   <select aria-label="Artifact Filter" className={on(props.artifactFilter!=='All artifacts')} value={props.artifactFilter} onChange={change(props.setArtifactFilter)}><option value="All artifacts">All Artifacts</option>{props.artifactKinds.map(value=><option key={value}>{value}</option>)}</select>
   <select aria-label="Role Filter" className={on(props.roleFilter!=='All roles')} value={props.roleFilter} onChange={event=>{props.setRoleFilter(event.target.value);if(event.target.value==='General')props.setPrivilegedTypeFilter('All privileged user types');props.onFiltersChanged()}}><option value="All roles">All Roles</option><option>General</option><option>Privileged</option></select>
   {props.roleFilter!=='General'&&<select aria-label="Privileged User Type Filter" className={on(props.privilegedTypeFilter!=='All privileged user types')} value={props.privilegedTypeFilter} onChange={change(props.setPrivilegedTypeFilter)}><option value="All privileged user types">All Privileged Types</option>{props.privilegedTypes.map(value=><option key={value}>{value}</option>)}</select>}
   <select aria-label="SAAR Status Filter" className={on(props.saarFilter!=='All SAAR statuses')} value={props.saarFilter} onChange={change(props.setSaarFilter)}><option>All SAAR statuses</option><option>SAAR missing</option><option>SAAR present</option></select>
   <select aria-label="Official Email Filter" className={on(props.emailFilter!=='All email statuses')} value={props.emailFilter} onChange={change(props.setEmailFilter)}><option>All email statuses</option><option>Official Email missing</option><option>Official Email present</option></select>
   <select aria-label="Affiliated Organization Filter" className={on(props.affiliationFilter!=='All affiliated organizations')} value={props.affiliationFilter} onChange={change(props.setAffiliationFilter)}><option value="All affiliated organizations">All Affiliations</option>{props.affiliatedOrganizations.map(value=><option key={value}>{value}</option>)}</select>
  </div>}
  <div className="directory-subbar">
   <div className="column-chips" role="group" aria-label="Requirement Columns"><span>Columns</span>{props.directoryColumns.map(([label,kind])=><button key={kind} type="button" aria-pressed={props.visibleColumnKinds.includes(kind)} onClick={()=>toggleColumn(kind)}>{label}</button>)}{!allColumnsShown&&<button type="button" className="show-all" onClick={()=>props.setVisibleColumnKinds(props.directoryColumns.map(([,kind])=>kind))}>Show All</button>}</div>
   <button type="button" disabled={!anyActive} onClick={props.onReset}>Reset Filters</button>
  </div>
 </div>
}
