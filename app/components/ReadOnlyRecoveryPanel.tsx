'use client';

import {useState} from 'react';
import type {ReadOnlyRecovery} from '../application/read-only-recovery';

export function ReadOnlyRecoveryPanel({recovery,onRetry,onRestore,onContinue}:{recovery:ReadOnlyRecovery;onRetry:()=>void|Promise<void>;onRestore:()=>void|Promise<void>;onContinue:()=>void}){
 const[busy,setBusy]=useState<'retry'|'restore'|null>(null),[error,setError]=useState('');
 async function run(action:'retry'|'restore',callback:()=>void|Promise<void>){setBusy(action);setError('');try{await callback()}catch(failure){setError(failure instanceof Error?failure.message:'The recovery action could not be completed.')}finally{setBusy(null)}}
 return <div className="session-lock" role="dialog" aria-modal="true" aria-labelledby="read-only-recovery-title"><div><p className="eyebrow">Protected Read-Only Recovery</p><h2 id="read-only-recovery-title">{recovery.title}</h2><p>{recovery.guidance}</p><div className="restore-warning"><strong>Why Full Access Was Blocked</strong><br/>{recovery.context}<br/><small>{recovery.detail}</small></div>{error&&<p className="restore-warning" role="alert">{error}</p>}<div className="session-lock-actions"><button className="primary" disabled={busy!==null} onClick={()=>void run('retry',onRetry)}>{busy==='retry'?'Verifying…':recovery.retryLabel}</button>{recovery.backupRestoreAvailable&&<button type="button" disabled={busy!==null} onClick={()=>void run('restore',onRestore)}>{busy==='restore'?'Opening Verified Backups…':'Restore Verified Backup'}</button>}<button type="button" disabled={busy!==null} onClick={onContinue}>Continue In Read-Only</button></div><small>Recovery never bypasses database, audit-chain, application-version, or exclusive-editor protections. No evidence files are deleted.</small></div></div>;
}
