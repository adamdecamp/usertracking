export type SessionChangeSummary={state:'checking'|'clean'|'pending'|'committing'|'attention'|'unavailable';databaseChangePending?:boolean;pendingEvidenceCount?:number;interruptedRecovery?:boolean;lastCommittedAt?:string;message?:string};

export function SessionChangeIndicator({summary}:{summary:SessionChangeSummary}){
 const label=summary.state==='clean'?'No Local Changes':summary.state==='pending'?'Changes Pending Commit':summary.state==='committing'?'Commit in Progress':summary.state==='attention'?'Commit Recovery Needed':summary.state==='checking'?'Checking Local Changes':'Commit Status Unavailable';
 const detail=summary.message??(summary.state==='pending'?`${summary.databaseChangePending?'Database changes pending':'Database unchanged'} · ${summary.pendingEvidenceCount??0} evidence file${summary.pendingEvidenceCount===1?'':'s'} pending`:summary.state==='clean'&&summary.lastCommittedAt?`Committed ${new Date(summary.lastCommittedAt).toLocaleString()}`:'Protected local workspace status');
 return <div className={`session-change-indicator ${summary.state}`} role="status"><span/><div><strong>{label}</strong><small>{detail}</small></div></div>
}
