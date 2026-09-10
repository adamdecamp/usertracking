type PdfTextItemLike={str?:unknown;transform?:unknown};

export function topDownPdfText(items:unknown[]){
 const values=(items as PdfTextItemLike[]).filter(item=>item!=null&&typeof item.str==='string').map((item,index)=>{const transform=Array.isArray(item.transform)?item.transform:[];return{text:item.str as string,x:typeof transform[4]==='number'?transform[4]:0,y:typeof transform[5]==='number'?transform[5]:0,index}});
 return values.sort((left,right)=>Math.abs(right.y-left.y)>2?right.y-left.y:left.x-right.x||left.index-right.index).map(item=>item.text).join(' ').replace(/\s+/g,' ').trim();
}
