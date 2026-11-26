'use client';

import {formatStepDuration,slowestStep,type ProcessingStep} from '../processing-steps.ts';
import type {ProcessingStatus} from './ProcessingPanel';

export type OperationHistoryEntry={id:string;title:string;phase:string;state:'complete'|'error';detail?:string;completedAt:string;steps?:ProcessingStep[]};

function slowestStepNote(steps?:ProcessingStep[]){const slowest=steps&&steps.length>1?slowestStep(steps):undefined;return slowest?` · Slowest step: ${slowest.phase} (${formatStepDuration(slowest.ms)})`:''}

export function OperationHistory({current,history,onClear}:{current:ProcessingStatus|null;history:OperationHistoryEntry[];onClear:()=>void}){
 if(!current&&!history.length)return null;
 return <details className="operation-history"><summary>Recent Activity{current?.state==='running'?' · Active':history.length?` · ${history.length}`:''}</summary><div className="operation-history-list">{current?.state==='running'&&<article className="running"><span>Active</span><strong>{current.title}</strong><small>{current.phase}{current.detail?` · ${current.detail}`:''}</small></article>}{history.map(item=><article key={item.id} className={item.state}><span>{item.state==='complete'?'Completed':'Needs Attention'}</span><strong>{item.title}</strong><small>{new Date(item.completedAt).toLocaleString()} · {item.phase}{item.detail?` · ${item.detail}`:''}{slowestStepNote(item.steps)}</small></article>)}{history.length>0&&<button type="button" onClick={onClear}>Clear Activity History</button>}</div></details>
}
