export function downloadTextFile(filename:string,text:string,type='application/json;charset=utf-8'){
 const link=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));
 link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
}

export function downloadJsonFile(filename:string,value:unknown){downloadTextFile(filename,JSON.stringify(value,null,2))}
