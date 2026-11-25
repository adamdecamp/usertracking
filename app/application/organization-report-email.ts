import {validContactEmail,type OrganizationContact} from '../domain/organization-contacts.ts';
import {outlookDraftSubject} from '../notification-utils.ts';

/** The launcher accepts at most this many addresses on one draft's To line. */
export const organizationEmailRecipientLimit=20;

const same=(left:string,right:string)=>left.toUpperCase()===right.toUpperCase();

/** Unique email addresses of the organization's contacts in the given positions, in contact order. */
export function organizationContactEmails(contacts:readonly OrganizationContact[],organization:string,positions:readonly string[]){
 const wanted=positions.map(value=>value.toUpperCase());
 const emails=contacts.filter(contact=>same(contact.organization,organization)&&wanted.includes(contact.position.toUpperCase())).flatMap(contact=>contact.methods.filter(method=>method.type==='Email'&&validContactEmail(method.value.trim())).map(method=>method.value.trim().toLowerCase()));
 return Array.from(new Set(emails));
}

export type OrganizationEmailPlan={organization:string;recipients:string[];contacts:string[];overLimit:boolean};

/** One planned draft per organization; an organization with no matching email address is reported, not emailed. */
export function organizationEmailPlan(organizations:readonly string[],contacts:readonly OrganizationContact[],positions:readonly string[]):OrganizationEmailPlan[]{
 const wanted=positions.map(value=>value.toUpperCase());
 return organizations.map(organization=>{
  const recipients=organizationContactEmails(contacts,organization,positions);
  const named=contacts.filter(contact=>same(contact.organization,organization)&&wanted.includes(contact.position.toUpperCase())&&contact.methods.some(method=>method.type==='Email'));
  return{organization,recipients:recipients.slice(0,organizationEmailRecipientLimit),contacts:Array.from(new Set(named.map(contact=>`${contact.name} (${contact.position})`))),overLimit:recipients.length>organizationEmailRecipientLimit};
 });
}

export function organizationReportSubject(systemNames:readonly string[],organization:string){
 return outlookDraftSubject('For Review',systemNames.join(', '),'Compliance Snapshot',organization).slice(0,200);
}

export function organizationReportBody({organization,systemNames,reportingDate,userCount,reportId,sha256}:{organization:string;systemNames:readonly string[];reportingDate:string;userCount:number;reportId:string;sha256:string}){
 return `Sir/Ma'am,\n\nAttached is the R.A.P.T.O.R. Compliance Snapshot for ${organization} as of ${reportingDate}. It covers ${userCount} active user${userCount===1?'':'s'} on ${systemNames.join(', ')}. Disabled users and other organizations are not included.\n\nPlease review any requirement shown as missing, due, or overdue and send updated documents to the system administration team. Contact us if a record appears incorrect.\n\nReport ${reportId}\nSHA-256 ${sha256}`;
}

/** The launcher prepares one Outlook draft at a time; a later draft waits for the previous one to open. */
export const outlookDraftBusy=(error:unknown)=>error instanceof Error&&/another outlook draft is still being prepared/i.test(error.message);

export async function whileOutlookDraftBusy<T>(operation:()=>Promise<T>,{attempts=60,waitMs=2000,sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))}:{attempts?:number;waitMs?:number;sleep?:(ms:number)=>Promise<void>}={}):Promise<T>{
 for(let attempt=1;;attempt++){
  try{return await operation()}
  catch(error){if(!outlookDraftBusy(error)||attempt>=attempts)throw error;await sleep(waitMs)}
 }
}
