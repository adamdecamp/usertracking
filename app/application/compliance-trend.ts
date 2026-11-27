import type {UserRecord} from '../domain/tracker-models.ts';
import {complianceOn,recordCompliance} from '../domain/compliance-log.ts';
import {requirementDueDate} from '../compliance-rules.ts';
import {calendarDateIn,complianceTimeZoneFor,dayNumberOfCalendarDate,dayNumberOfUtcDate} from '../compliance-time-zone.ts';
import {parseDate} from '../filename-utils.ts';
import {newestArtifactFor,requiredKinds} from '../user-status-utils.ts';
import {userIsCompliant} from './user-compliance.ts';

const dayMs=86_400_000;
const dateOfDay=(day:number)=>new Date(day*dayMs).toISOString().slice(0,10);

/** For each required item: the day its current document is dated and the last day it is current (undefined = never expires). */
function currentDocuments(user:UserRecord){
 return requiredKinds(user).map(kind=>{
  const artifact=newestArtifactFor(user,kind),date=artifact?parseDate(artifact.filename):undefined,due=date?requirementDueDate(kind,date):undefined;
  return date?{documentDay:dayNumberOfUtcDate(date),dueDay:due?dayNumberOfUtcDate(due):undefined}:undefined;
 });
}

/**
 * The day a user who is not compliant today stopped being compliant, when the documents on record
 * decide it exactly: every required item has a document and at least one has expired. The lapse began
 * the day after the earliest expiry. Undefined when an item has no document (the day is then unknown).
 */
function lapseDay(user:UserRecord,today:number):number|undefined{
 const documents=currentDocuments(user);if(documents.some(item=>!item))return;
 const expired=documents.map(item=>item!.dueDay).filter((dueDay):dueDay is number=>dueDay!==undefined&&dueDay<today);
 return expired.length?Math.min(...expired)+1:undefined;
}

/**
 * Adds an entry to each active user's compliance history when their state has changed since the last
 * entry (or when they have no history yet). Returns the same array when nothing changed, so it is safe
 * to call after every change to the records. Disabled users and users outside `systemIds` are left alone.
 */
export function recordComplianceHistory(users:readonly UserRecord[],systemIds:ReadonlySet<string>,now=new Date()):readonly UserRecord[]{
 let changed=false;
 const next=users.map(user=>{
  if(user.disabled||!systemIds.has(user.systemId))return user;
  const today=calendarDateIn(now,complianceTimeZoneFor(user.systemId)),todayNumber=dayNumberOfCalendarDate(today)!,compliant=userIsCompliant(user,now),last=user.complianceLog?.at(-1);
  if(last&&last.compliant===compliant)return user;
  // A lapse caused only by an expired document is dated to the day it began, even if nobody opened the app that day.
  let on=today;
  if(last&&!compliant){const lapse=lapseDay(user,todayNumber),lastNumber=dayNumberOfCalendarDate(last.on);if(lapse!==undefined&&lastNumber!==undefined&&lapse>lastNumber&&lapse<=todayNumber)on=dateOfDay(lapse)}
  const log=recordCompliance(user.complianceLog,on,compliant);
  if(log===user.complianceLog||!log)return user;
  changed=true;return{...user,complianceLog:[...log]};
 });
 return changed?next:users;
}

export const trendRanges=[3,6,9,12] as const;
export type TrendRange=typeof trendRanges[number];
export type TrendPoint={
 /** YYYY-MM-DD in the information system's time zone. */
 date:string;
 day:number;
 /** Users with a known state on this day, and how many of them were compliant. */
 known:number;
 compliant:number;
 /** Undefined when no shown user has history that far back. */
 percent:number|undefined;
};
export type ComplianceTrend={points:TrendPoint[];startDay:number;endDay:number;
 /** The earliest recorded day among the users shown; undefined when none has history. */
 historyStartedOn:string|undefined};

/** The same calendar day `months` earlier (clamped to the end of a shorter month). */
function monthsBefore(date:string,months:number){
 const [year,month,day]=date.split('-').map(Number),first=new Date(Date.UTC(year,month-1-months,1)),lastDay=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(day,lastDay))).toISOString().slice(0,10);
}

/**
 * Weekly points from `months` ago to today for the users given (pass the active users the directory shows).
 * Today's point is the live status. A past day uses the user's recorded history, except that a document on
 * record that had already expired by that day always counts as not compliant. A user with no history yet on
 * a day is left out of that day rather than guessed.
 */
export function complianceTrend(users:readonly UserRecord[],months:number,now=new Date()):ComplianceTrend{
 const zone=complianceTimeZoneFor(users[0]?.systemId),today=calendarDateIn(now,zone),endDay=dayNumberOfCalendarDate(today)!,startDay=dayNumberOfCalendarDate(monthsBefore(today,months))!;
 const prepared=users.filter(user=>!user.disabled).map(user=>({user,documents:currentDocuments(user)}));
 const days:number[]=[];for(let day=endDay;day>=startDay;day-=7)days.unshift(day);
 const points=days.map((day):TrendPoint=>{
  const date=dateOfDay(day);let known=0,compliant=0;
  for(const{user,documents}of prepared){
   let state:boolean|undefined;
   if(day===endDay)state=userIsCompliant(user,now);
   else if(documents.some(item=>item&&item.documentDay<=day&&item.dueDay!==undefined&&item.dueDay<day))state=false;
   else state=complianceOn(user.complianceLog,date);
   if(state===undefined)continue;
   known++;if(state)compliant++;
  }
  return{date,day,known,compliant,percent:known?Math.round(compliant/known*1000)/10:undefined};
 });
 const starts=prepared.map(item=>item.user.complianceLog?.[0]?.on).filter((value):value is string=>!!value).sort();
 return{points,startDay,endDay,historyStartedOn:starts[0]};
}
