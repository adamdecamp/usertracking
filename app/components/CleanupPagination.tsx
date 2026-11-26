'use client';

// Page controls shared by the Sync Review and Unarchive windows. Moved unchanged from app/page.tsx.


export function CleanupPagination({page,pageCount,start,end,total,onPage}:{page:number;pageCount:number;start:number;end:number;total:number;onPage:(page:number)=>void}){
 if(total===0)return null;
 return <div className="cleanup-pagination"><span>Items {start+1}–{end} of {total} · Page {page+1} of {pageCount}</span><div><button type="button" disabled={page===0} onClick={()=>onPage(page-1)}>Previous</button><button type="button" disabled={page>=pageCount-1} onClick={()=>onPage(page+1)}>Next</button></div></div>
}
