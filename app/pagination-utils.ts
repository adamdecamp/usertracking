export const cleanupPageSize=20;
export const directoryPageSize=100;

export function paginateItems<T>(items:T[],requestedPage:number,pageSize=cleanupPageSize){
 const safeSize=Math.max(1,Math.trunc(pageSize)),pageCount=Math.max(1,Math.ceil(items.length/safeSize)),page=Math.min(Math.max(0,Math.trunc(requestedPage)),pageCount-1),start=page*safeSize,end=Math.min(start+safeSize,items.length);
 return{items:items.slice(start,end),page,pageCount,start,end,total:items.length}
}
