/**
 * Manifest v10: each user's compliance history, kept as the dates on which the
 * user became compliant or stopped being compliant. A user changes state only a
 * few times a year, so this stays small while giving an exact past for any group
 * of users the User Directory filters can show.
 */
export type ComplianceLogEntry={
 /** The calendar day (YYYY-MM-DD, in the information system's time zone) the state began. */
 on:string;
 compliant:boolean;
};

export const complianceLogLimit=500;
const datePattern=/^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD form. */
export function isCalendarDay(value:unknown):value is string{
 const match=typeof value==='string'?datePattern.exec(value):null;if(!match)return false;
 const [year,month,day]=match.slice(1).map(Number),check=new Date(Date.UTC(year,month-1,day));
 return check.getUTCFullYear()===year&&check.getUTCMonth()===month-1&&check.getUTCDate()===day;
}

/** Decodes an untrusted stored log. Dates must be real and strictly increasing; anything else is rejected. */
export function decodeComplianceLog(value:unknown):ComplianceLogEntry[]|undefined{
 if(!Array.isArray(value)||value.length>complianceLogLimit)return;
 const log:ComplianceLogEntry[]=[];
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item))return;
  const entry=item as Partial<ComplianceLogEntry>;
  if(!isCalendarDay(entry.on)||typeof entry.compliant!=='boolean')return;
  if(log.length&&entry.on<=log[log.length-1].on)return;
  log.push({on:entry.on,compliant:entry.compliant});
 }
 return log;
}

/** The recorded state on `day`, or undefined before the first entry (no history yet). */
export function complianceOn(log:readonly ComplianceLogEntry[]|undefined,day:string):boolean|undefined{
 let state:boolean|undefined;
 for(const entry of log??[]){if(entry.on>day)break;state=entry.compliant}
 return state;
}

/**
 * Records the state that began on `on`. Returns the same log when nothing changes, so callers can tell.
 * A repeat of the current state adds nothing; a second change on the same day replaces that day's entry;
 * a date earlier than the newest entry (a clock set back) is ignored.
 */
export function recordCompliance(log:readonly ComplianceLogEntry[]|undefined,on:string,compliant:boolean):readonly ComplianceLogEntry[]|undefined{
 if(!isCalendarDay(on))return log;
 const current=log??[],last=current[current.length-1];
 if(!last)return[{on,compliant}];
 if(last.compliant===compliant||on<last.on)return log;
 if(on===last.on){
  // The day's earlier entry is replaced; if that returns to the state before it, the day recorded no change at all.
  const before=current[current.length-2];
  return before&&before.compliant===compliant?current.slice(0,-1):[...current.slice(0,-1),{on,compliant}];
 }
 return[...current,{on,compliant}].slice(-complianceLogLimit);
}
