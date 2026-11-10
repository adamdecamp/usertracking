'use client';

import {useEffect,useRef,useState} from 'react';
import type {SystemRecord} from '../domain/tracker-models';
import type {AccessMode} from '../session-utils';
import {SessionChangeIndicator,type SessionChangeSummary} from './SessionChangeIndicator';

type Props={
 accessMode:AccessMode;
 sessionState:'unmapped'|'starting'|'active'|'idle'|'logged-off'|'blocked';
 syncRunning:boolean;
 canWrite:boolean;
 portableHost:boolean;
 systems:SystemRecord[];
 system?:SystemRecord;
 selectedSystemId:string;
 folderName?:string;
 version:string;
 syncText:string;
 pendingCleanupCount:number;
 storageStatus:string;
 sessionChanges:SessionChangeSummary;
 onMap:()=>void;
 onSync:()=>void;
 onStopSync:()=>void;
 onCleanup:()=>void;
 onCommit:()=>void;
 onLogOff:()=>void;
 onSelectSystem:(systemId:string)=>void;
 onManageSystems:()=>void;
 onManageOrganizations:()=>void;
 onArchivedSystems:()=>void;
 onUnarchive:()=>void;
 onReconciliation:()=>void;
 onAuditLog:()=>void;
 onOpenWorkspace:()=>void;
 onPerformance:()=>void;
 onReleaseHealth:()=>void;
 onRestore:()=>void;
 onComplianceSnapshot:()=>void;
};

export function OperatorDashboardHeader(props:Props){
 const mapped=Boolean(props.selectedSystemId&&props.folderName),active=props.sessionState==='active';
 const[openMenu,setOpenMenu]=useState<'users'|'reports'|'tools'|null>(null),menuGroup=useRef<HTMLDivElement>(null);
 useEffect(()=>{function outside(event:PointerEvent|FocusEvent){if(!menuGroup.current?.contains(event.target as Node))setOpenMenu(null)}function escape(event:KeyboardEvent){if(event.key==='Escape')setOpenMenu(null)}document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape)}},[]);
 const toggleMenu=(menu:'users'|'reports'|'tools')=>(event:React.SyntheticEvent<HTMLDetailsElement>)=>setOpenMenu(current=>event.currentTarget.open?menu:current===menu?null:current),runMenuAction=(action:()=>void)=>{setOpenMenu(null);action()};
 return <>
  <header className="hero">
   {/* eslint-disable-next-line @next/next/no-img-element -- The portable Vite build serves this small static launcher logo directly. */}
   <div className="hero-brand"><img className="brand-logo" src="/raptor-icon.png" alt="R.A.P.T.O.R. raptor claw and verified document logo"/><div><h1>R.A.P.T.O.R.</h1><p className="subtitle">Role-Based Access Personnel Tracking &amp; Oversight Registry</p><p className="brand-tagline">NIST SP 800-53-Aligned Administrative Tracking</p><a href="/user-guide" className="guide-link" target="_blank" rel="noopener noreferrer">Open the User Guide →</a></div></div>
   <div className="hero-actions daily-actions"><span className={`access-mode-badge ${props.accessMode}`}>{props.accessMode==='read-only'?'Read-Only Access':props.accessMode==='full'?'Full Access':'Choose Access'}</span><button className="secondary" disabled={props.syncRunning||props.accessMode==='unselected'||props.sessionState==='starting'} onClick={props.onMap}>{props.accessMode==='read-only'?'Map Existing System Folder':'Map System Folder'}</button>{props.canWrite&&<button className="primary" disabled={props.syncRunning||!props.system} onClick={props.onSync}>{props.syncText}</button>}{props.canWrite&&props.syncRunning&&<button className="secondary" onClick={props.onStopSync}>Stop Sync</button>}{props.canWrite&&<button className="secondary" disabled={props.syncRunning||!props.pendingCleanupCount} onClick={props.onCleanup}>Clean Up{props.pendingCleanupCount?` (${props.pendingCleanupCount})`:''}</button>}{props.canWrite&&props.portableHost&&<button className="secondary" disabled={props.syncRunning||!mapped||props.storageStatus==='saving'} onClick={props.onCommit}>Commit Session</button>}<button className="secondary" disabled={props.syncRunning||!active} onClick={props.onLogOff}>Log Off</button><small>Version {props.version} · {props.folderName??'No Folder Mapped for the Selected System'}</small></div>
  </header>
  {props.accessMode==='read-only'&&<section className="read-only-banner" role="status"><strong>Read-Only Access</strong><span>You can review, search, filter, report, and export. Record changes and file operations are unavailable until you switch to Full Access.</span></section>}
  <section className="toolbar"><div className="system-select"><label>Information System</label><select value={props.selectedSystemId} disabled={props.syncRunning||!props.systems.some(system=>!system.archived)} onChange={event=>props.onSelectSystem(event.target.value)}>{!props.systems.some(system=>!system.archived)&&<option value="">No Systems Configured</option>}{props.systems.filter(system=>!system.archived).map(system=><option key={system.id} value={system.id}>{system.name}</option>)}</select><span>{props.system?.type??(props.canWrite?'Add a System to Begin':'Map an Existing System to Begin')}</span></div><div ref={menuGroup} className="toolbar-menus">
   <details className="action-menu" open={openMenu==='users'} onToggle={toggleMenu('users')}><summary>User Administration</summary><div>{props.canWrite&&<button disabled={props.syncRunning} onClick={()=>runMenuAction(props.onManageSystems)}>Manage Systems</button>}{props.canWrite&&<button disabled={props.syncRunning||!active||!mapped} onClick={()=>runMenuAction(props.onManageOrganizations)}>Manage Organizations</button>}<button disabled={props.syncRunning} onClick={()=>runMenuAction(props.onArchivedSystems)}>Archived Systems</button>{props.canWrite&&<button disabled={props.syncRunning||!active||!mapped} onClick={()=>runMenuAction(props.onUnarchive)}>Unarchive Evidence</button>}</div></details>
   <details className="action-menu" open={openMenu==='reports'} onToggle={toggleMenu('reports')}><summary>Reports &amp; Oversight</summary><div>{props.canWrite&&<button disabled={props.syncRunning||!mapped} onClick={()=>runMenuAction(props.onReconciliation)}>Reconciliation</button>}<button disabled={props.syncRunning||!mapped} onClick={()=>runMenuAction(props.onAuditLog)}>View Audit Log</button>{props.canWrite&&<button disabled={props.syncRunning||!props.systems.length} onClick={()=>runMenuAction(props.onComplianceSnapshot)}>Compliance Snapshot</button>}</div></details>
   <details className="action-menu" open={openMenu==='tools'} onToggle={toggleMenu('tools')}><summary>System Tools</summary><div>{props.canWrite&&props.portableHost&&<button disabled={props.syncRunning||!mapped} onClick={()=>runMenuAction(props.onOpenWorkspace)}>Open Local Workspace</button>}<button disabled={props.syncRunning||!mapped||!props.portableHost} onClick={()=>runMenuAction(props.onPerformance)}>Performance</button>{props.canWrite&&<button disabled={props.syncRunning||!mapped} onClick={()=>runMenuAction(props.onReleaseHealth)}>Release Health</button>}{props.canWrite&&<button disabled={props.syncRunning||!props.system} onClick={()=>runMenuAction(props.onRestore)}>Restore Backup</button>}</div></details>
  </div></section>
  <SessionChangeIndicator summary={props.sessionChanges}/>
 </>
}
