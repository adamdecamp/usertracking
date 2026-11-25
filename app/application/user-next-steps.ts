import type {UserRecord} from '../domain/tracker-models.ts';
import {daysOverdueFor,daysUntilDueFor,directoryStatusFor,exceptionFor,requiredKinds} from '../user-status-utils.ts';

const validEmail=(value:string)=>value.length<=254&&/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
const days=(count:number)=>`${count} day${count===1?'':'s'}`;

export type UserNextSteps={summary:string;steps:string[]};

/**
 * Plain-language next steps for a User Record: what is missing, overdue, or due
 * soon, and what the operator does about it. It uses the same statuses as the
 * directory, so the advice always matches what the record shows.
 */
export function userNextSteps(user:UserRecord,asOf=new Date()):UserNextSteps{
 if(user.disabled)return{summary:'This user is disabled.',steps:['No compliance action is needed unless the user is reactivated.']};
 const steps:string[]=[];let attention=0,soonest:{kind:string;days:number}|undefined;
 const hasEmail=validEmail(user.email.trim());
 if(!hasEmail)steps.push('Add the user’s Official Email with Edit User Information. Outlook drafts and Check Outlook need it.');
 for(const kind of requiredKinds(user)){
  const status=directoryStatusFor(user,kind,asOf),exception=exceptionFor(user,kind,asOf),covered=exception?` An exception is approved through ${exception.expiresOn}.`:'';
  if(status==='Missing'){attention++;steps.push(`${kind}: missing. Ask the user to send it.${covered}`)}
  else if(status==='Overdue'){attention++;steps.push(`${kind}: overdue ${days(daysOverdueFor(user,kind,asOf))}. Ask the user for a current copy.${covered}`)}
  else if(status==='Due Within 30 Days'){const left=daysUntilDueFor(user,kind,asOf)??0;attention++;steps.push(`${kind}: ${left===0?'due today':`due in ${days(left)}`}. Remind the user before then.`)}
  else{const left=daysUntilDueFor(user,kind,asOf);if(left!==undefined&&(!soonest||left<soonest.days))soonest={kind,days:left}}
 }
 if(attention&&hasEmail)steps.push('Choose Prepare Outlook Draft below to email the user about these items.');
 if(!attention)return{summary:hasEmail?'Nothing is needed now. Every required item is current.':'Every required item is current.',steps:[...steps,...(soonest?[`Next item due: ${soonest.kind} in ${days(soonest.days)}.`]:[])]};
 return{summary:`${attention} item${attention===1?' needs':'s need'} attention.`,steps};
}
