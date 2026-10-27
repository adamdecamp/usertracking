'use client';
/* eslint-disable @next/next/no-img-element -- The static brand asset must work in the portable Vite build. */
import {useEffect,useRef} from 'react';
import {lastLogonActionSummary} from '../last-logon-utils.ts';
import type {LastLogonRecord} from '../infrastructure/portable-contracts.ts';

export function LastLogonNotice({record,systemName,onClose}:{record:LastLogonRecord;systemName:string;onClose:()=>void}){
 const closeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{closeButton.current?.focus()},[]);
 const localTime=record.available?new Date(record.timestampUtc).toLocaleString():'';
 return <div className="last-logon-notice" role="dialog" aria-modal="true" aria-labelledby="last-logon-title"><div className="last-logon-card"><img className="access-mode-logo" src="/raptor-icon.png" alt=""/><p className="eyebrow">R.A.P.T.O.R. Session History</p><h2 id="last-logon-title">Previous Application Logon</h2><p className="last-logon-system">{systemName}</p>{record.available?<><dl><div><dt>Windows User</dt><dd>{record.actor}</dd></div><div><dt>Logon Time</dt><dd>{localTime}</dd></div><div><dt>Access</dt><dd>{record.accessMode}</dd></div></dl><div className="last-logon-summary"><strong>Brief Action Summary</strong><p>{lastLogonActionSummary(record)}</p></div></>:<p className="last-logon-empty">No prior application logon is recorded for this information system.</p>}<button ref={closeButton} className="primary" type="button" onClick={onClose}>Continue</button><small>The current session is recorded after this prior-session notice is loaded.</small></div></div>;
}
