import {lastResultsMaxAgeMs,savedResultLabel,syncReviewCounts,syncReviewItemCount,type LastResultKind,type SavedLastResults} from '../application/last-results';

export type LastResultsState=SavedLastResults&{syncCurrent:boolean;systemId:string};
type Props={results:LastResultsState|null;onOpenSync:()=>void;onOpenReconciliation:()=>void;onDiscard:(kind:LastResultKind)=>void};
const when=(value:string)=>new Date(value).toLocaleString();
const days=Math.round(lastResultsMaxAgeMs/86400000);

/** Lists the saved Sync review and Reconciliation for the selected system so they can be reopened without scanning again. */
export function LastResultsPanel({results,onOpenSync,onOpenReconciliation,onDiscard}:Props){
 const sync=results?.sync,reconciliation=results?.reconciliation,high=reconciliation?.issues.filter(issue=>issue.severity==='High').length??0;
 return <><p className="eyebrow">Saved on This Computer</p><h2>Last Results</h2><p className="hint">The last Sync or Full Scan review and the last Reconciliation are kept in this computer&apos;s protected local workspace for {days} days, so they can be reopened after logging off or closing the window.</p>
  {!results&&<div className="empty">Reading Saved Results…</div>}
  {results&&!sync&&!reconciliation&&<div className="empty">No saved results for this information system.</div>}
  {sync&&<article className="last-result"><div className="message-actions"><strong>{savedResultLabel(sync.review)}</strong><small>Saved {when(sync.savedAtUtc)}{sync.savedBy?` by ${sync.savedBy}`:''} · {sync.review.scanned.toLocaleString()} files scanned · {syncReviewItemCount(sync.review)} items</small></div>
   <div className="audit-summary">{syncReviewCounts(sync.review).filter(([,value])=>value>0).map(([label,value])=><span key={label}><b>{value}</b>{label}</span>)}</div>
   {results?.syncCurrent?<button type="button" className="primary full" onClick={onOpenSync}>Open Review</button>:<><p className="restore-warning"><b>Summary Only:</b> User records were saved after this review was prepared, so applying it would overwrite those newer changes. Run Sync again to review current evidence; files it already organized resume from the protected Sync journals.</p><button type="button" className="full" onClick={()=>onDiscard('sync')}>Discard Saved Review</button></>}
  </article>}
  {reconciliation&&<article className="last-result"><div className="message-actions"><strong>Reconciliation</strong><small>Saved {when(reconciliation.savedAtUtc)}{reconciliation.savedBy?` by ${reconciliation.savedBy}`:''} · {reconciliation.scanned.toLocaleString()} files scanned</small></div>
   <div className="audit-summary"><span><b>{reconciliation.issues.length}</b>Total Issues</span><span><b>{high}</b>High Priority</span></div>
   <button type="button" className="primary full" onClick={onOpenReconciliation}>Open Results</button><button type="button" className="full" onClick={()=>onDiscard('reconciliation')}>Discard Saved Results</button>
  </article>}
 </>
}
