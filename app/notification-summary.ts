const comparable=(value:string)=>value.replace(/[\s.:;]+$/,'').trim().toLowerCase();

/** The visible line of a notice: the first line, unless it only repeats the title, in which case the reason from the Details line is shown. */
export function notificationSummary(title:string,lines:readonly string[]){
 const first=lines[0],detail=lines.find(line=>/^Details:\s*\S/i.test(line));
 return first!==undefined&&comparable(first)===comparable(title)&&detail?detail.replace(/^Details:\s*/i,''):first;
}
