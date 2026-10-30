'use client';

import type {ProcessingStatus} from './ProcessingPanel';

export type OperationHistoryEntry={id:string;title:string;phase:string;state:'complete'|'error';detail?:string;completedAt:string};

export function OperationHistory({current,history,onClear}:{current:ProcessingStatus|null;history:OperationHistoryEntry[];onClear:()=>void}){
 if(!current&&!history.length)return null;
 return <details className="operation-history"><summary>Recent Activity{current?.state==='running'?' · Active':history.length?` · ${history.length}`:''}</summary><div className="operation-history-list">{current?.state==='running'&&<article className="running"><span>Active</span><strong>{current.title}</strong><small>{current.phase}{current.detail?` · ${current.detail}`:''}</small></article>}{history.map(item=><article key={item.id} className={item.state}><span>{item.state==='complete'?'Completed':'Needs Attention'}</span><strong>{item.title}</strong><small>{new Date(item.completedAt).toLocaleString()} · {item.phase}{item.detail?` · ${item.detail}`:''}</small></article>)}{history.length>0&&<button type="button" onClick={onClear}>Clear Activity History</button>}</div></details>
}
