/**
 * Calendar-day arithmetic for compliance due dates.
 *
 * Evidence dates come from filenames (for example 22NOV2025) and are calendar
 * days, not instants. Each information system records the IANA time zone its
 * operators work in, so an item turns Overdue on the same local calendar day
 * for every operator instead of at midnight UTC.
 */

const millisecondsPerDay=86_400_000;
const maxTimeZoneLength=64;

/** Commonly used zones listed first in the picker; every other IANA zone follows. */
export const preferredTimeZones=[
 'America/New_York',
 'America/Chicago',
 'America/Denver',
 'America/Phoenix',
 'America/Los_Angeles',
 'America/Anchorage',
 'Pacific/Honolulu',
 'America/Puerto_Rico',
 'Pacific/Guam',
 'Europe/Berlin',
 'Asia/Tokyo',
 'Asia/Seoul',
 'UTC',
] as const;

export function isValidTimeZone(value:unknown):value is string{
 if(typeof value!=='string'||!value||value.length>maxTimeZoneLength||/[\r\n\u0000]/.test(value))return false;
 try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true}catch{return false}
}

/** The time zone of this computer, used until a system has its own zone. */
export function fallbackTimeZone():string{
 try{const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;return isValidTimeZone(zone)?zone:'UTC'}catch{return 'UTC'}
}

/** The calendar date (YYYY-MM-DD) that `at` falls on in `timeZone`. */
export function calendarDateIn(at:Date,timeZone:string):string{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:isValidTimeZone(timeZone)?timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
 const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value??'';
 return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Whole days since 1970-01-01 for a YYYY-MM-DD calendar date, or undefined when invalid. */
export function dayNumberOfCalendarDate(value:string):number|undefined{
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return;
 const [year,month,day]=match.slice(1).map(Number),time=Date.UTC(year,month-1,day),check=new Date(time);
 if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return;
 return Math.round(time/millisecondsPerDay);
}

/** Day number for a date stored as UTC midnight, such as a parsed evidence date. */
export function dayNumberOfUtcDate(value:Date):number{
 return Math.floor(value.getTime()/millisecondsPerDay);
}

/** Day number of the local calendar day that `asOf` falls on in `timeZone`. */
export function localDayNumber(asOf:Date,timeZone:string):number{
 return dayNumberOfCalendarDate(calendarDateIn(asOf,timeZone))!;
}

const systemTimeZones=new Map<string,string>();

/** Refresh the system-to-zone lookup used by compliance status helpers. */
export function registerSystemTimeZones(systems:readonly{id:string;timeZone?:string}[]):void{
 systemTimeZones.clear();
 for(const system of systems)if(isValidTimeZone(system.timeZone))systemTimeZones.set(system.id,system.timeZone);
}

/** The zone that decides due dates for users in `systemId`. */
export function complianceTimeZoneFor(systemId?:string):string{
 return (systemId&&systemTimeZones.get(systemId))||fallbackTimeZone();
}

/** Every zone this browser knows, with the preferred zones first. */
export function timeZoneOptions():string[]{
 let all:string[]=[];
 try{all=(Intl as typeof Intl&{supportedValuesOf?:(key:string)=>string[]}).supportedValuesOf?.('timeZone')??[]}catch{all=[]}
 const preferred=preferredTimeZones.filter(zone=>isValidTimeZone(zone)),rest=all.filter(zone=>!preferred.includes(zone as typeof preferred[number])&&isValidTimeZone(zone)).sort((left,right)=>left.localeCompare(right));
 return [...preferred,...rest];
}

/** A readable label such as "America/Denver (GMT-7)". */
export function timeZoneLabel(timeZone:string,at=new Date()):string{
 if(!isValidTimeZone(timeZone))return timeZone;
 try{const offset=new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'shortOffset'}).formatToParts(at).find(part=>part.type==='timeZoneName')?.value;return offset?`${timeZone.replaceAll('_',' ')} (${offset})`:timeZone.replaceAll('_',' ')}catch{return timeZone.replaceAll('_',' ')}
}
