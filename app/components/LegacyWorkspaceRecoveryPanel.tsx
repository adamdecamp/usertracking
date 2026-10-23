'use client';

import {useState} from 'react';
import {exportLegacyWorkspaceRecovery,resetLegacyWorkspaceRecovery} from '../infrastructure/legacy-workspace-recovery.ts';
import type {LegacyWorkspaceRecoveryResult,LegacyWorkspaceRecoveryStatus,LegacyWorkspaceReviewPackage} from '../infrastructure/portable-contracts.ts';

export function LegacyWorkspaceRecoveryPanel({storageId,logicalSystemId,status,onRecovered,onContinueReadOnly}:{storageId:string;logicalSystemId:string;status:LegacyWorkspaceRecoveryStatus;onRecovered:(result:LegacyWorkspaceRecoveryResult)=>void|Promise<void>;onContinueReadOnly:()=>void|Promise<void>}){
 const[busy,setBusy]=useState<'export'|'reset'|'readonly'|''>(''),[confirmation,setConfirmation]=useState(''),[reviewPackage,setReviewPackage]=useState<LegacyWorkspaceReviewPackage|null>(null),[error,setError]=useState('');
 const runExport=async()=>{setBusy('export');setError('');try{setReviewPackage(await exportLegacyWorkspaceRecovery(storageId,logicalSystemId))}catch(value){setError(value instanceof Error?value.message:'The protected review package could not be created.')}finally{setBusy('')}};
 const runReset=async()=>{setBusy('reset');setError('');try{await onRecovered(await resetLegacyWorkspaceRecovery(storageId,logicalSystemId))}catch(value){setError(value instanceof Error?value.message:'The protected workspace could not be recovered.')}finally{setBusy('')}};
 const runReadOnly=async()=>{setBusy('readonly');setError('');try{await onContinueReadOnly()}catch(value){setError(value instanceof Error?value.message:'R.A.P.T.O.R. could not continue in Read-Only mode.')}finally{setBusy('')}};
 return <div className="backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="legacy-recovery-title">
  <p className="eyebrow">Protected Local Recovery</p><h2 id="legacy-recovery-title">Recover Legacy Workspace</h2>
  <p>This computer has unsent local changes from an older R.A.P.T.O.R. release, and another operator has since updated the verified shared master. R.A.P.T.O.R. blocked a stale overwrite.</p>
  <div className="notice"><strong>{status.systemName}</strong><br/>{status.userCount} local user record{status.userCount===1?'':'s'} · Last local save {status.savedAtUtc?new Date(status.savedAtUtc).toLocaleString():'Unknown'}<br/><small>Shared database and evidence files will not be changed by either recovery option.</small></div>
  <h3>1. Preserve For Review</h3><p>Create a SHA-256-verified local ZIP containing the stale local database and recovery details. Evidence remains preserved in the protected local workspace.</p>
  <button type="button" disabled={!!busy} onClick={()=>void runExport()}>{busy==='export'?'Creating Review Package…':'Export Preserved Workspace For Review'}</button>
  {reviewPackage&&<p className="success"><strong>Review package created:</strong> {reviewPackage.path}<br/><small>SHA-256: {reviewPackage.sha256}</small></p>}
  <h3>2. Back Up And Reset</h3><p>This creates another verified review package, moves the entire stale workspace into the protected local recovery archive, and initializes a fresh workspace from the newest verified shared master. No files are automatically deleted.</p>
  <label>Type <strong>BACK UP AND RESET</strong> to continue<input value={confirmation} disabled={!!busy} onChange={event=>setConfirmation(event.target.value)} autoComplete="off"/></label>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="form-actions"><button type="button" disabled={!!busy} onClick={()=>void runReadOnly()}>{busy==='readonly'?'Opening Read-Only…':'Continue In Read-Only'}</button><button type="button" className="primary" disabled={!!busy||confirmation!=='BACK UP AND RESET'} onClick={()=>void runReset()}>{busy==='reset'?'Recovering Workspace…':'Back Up And Discard Stale Workspace'}</button></div>
  <small>The exclusive Full Access lock remains held while this recovery panel is open. The action is recorded in the shared tamper-evident audit log.</small>
 </div></div>;
}
