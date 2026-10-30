'use client';

import {useEffect,useState} from 'react';

export type ProcessingStatus={title:string;phase:string;processed:number;total?:number;unit:string;state:'running'|'complete'|'error';detail?:string};

export function ProcessingPanel({status,onDismiss}:{status:ProcessingStatus;onDismiss:()=>void}){
 const [elapsedSeconds,setElapsedSeconds]=useState(0);
 useEffect(()=>{if(status.state!=='running')return;const timer=window.setInterval(()=>setElapsedSeconds(value=>value+1),1000);return()=>window.clearInterval(timer)},[status.state]);
 const hasTotal=status.total!==undefined,percentage=hasTotal?(status.total===0?(status.state==='complete'?100:0):Math.min(100,Math.round(status.processed/status.total!*100))):undefined,count=hasTotal?`${Math.min(status.processed,status.total!)} of ${status.total} ${status.unit} processed`:status.processed>0?`${status.processed} ${status.unit} processed · Total still being discovered`:'Workload total is still being discovered',elapsed=elapsedSeconds<60?`${elapsedSeconds}s`:`${Math.floor(elapsedSeconds/60)}m ${elapsedSeconds%60}s`;
 return <section className={`processing-panel ${status.state}`} role="status" aria-live="polite"><div className="processing-heading"><div><p className="eyebrow">Processing Status</p><strong>{status.title}</strong><small>Stage: {status.phase}</small></div><div className="processing-value">{percentage!==undefined?`${percentage}%`:status.state==='running'?'Working…':status.state==='complete'?'Complete':'Attention'}{status.state!=='running'&&<button type="button" aria-label="Dismiss Processing Status" onClick={onDismiss}>×</button>}</div></div><div className={`processing-track ${hasTotal?'':'indeterminate'}`} role="progressbar" aria-label={`${status.title}: ${status.phase}`} aria-valuemin={0} aria-valuemax={hasTotal?100:undefined} aria-valuenow={percentage}><span style={percentage!==undefined?{width:`${percentage}%`}:undefined}/></div><div className="processing-detail"><span>{count} · Elapsed {elapsed}</span>{status.detail&&<small><b>Current:</b> {status.detail}</small>}</div></section>
}
