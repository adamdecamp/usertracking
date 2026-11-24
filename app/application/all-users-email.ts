import {notificationRecipientBatches} from '../workflow-utils.ts';
import {outlookDraftSubject,type OutlookDraftSubjectTag} from '../notification-utils.ts';

type Recipient={systemId:string;email:string;disabled:boolean};

export const allUsersEmailTags:readonly OutlookDraftSubjectTag[]=['Notice','Action Required','For Review'];
export const allUsersEmailTopicLimit=60,allUsersEmailDetailLimit=60,allUsersEmailMessageLimit=20000;

const validEmail=(value:string)=>value.length<=254&&/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);

/** Official Emails of every enabled user in one information system, once each. */
export function activeUserEmails(users:readonly Recipient[],systemId:string){
 return Array.from(new Set(users.filter(user=>user.systemId===systemId&&!user.disabled).map(user=>user.email.trim().toLowerCase()).filter(validEmail))).sort();
}

/** Enabled users in the system who cannot be reached because their Official Email is blank or invalid. */
export function activeUsersWithoutEmail(users:readonly Recipient[],systemId:string){
 return users.filter(user=>user.systemId===systemId&&!user.disabled&&!validEmail(user.email.trim().toLowerCase())).length;
}

/** BCC-only batches; the launcher accepts at most 40 BCC recipients and no To address alongside them. */
export function allUsersEmailBatches(users:readonly Recipient[],systemId:string){return notificationRecipientBatches(activeUserEmails(users,systemId))}

export function allUsersEmailSubject(tag:OutlookDraftSubjectTag,systemName:string,topic:string,detail:string){
 return outlookDraftSubject(tag,systemName,topic.slice(0,allUsersEmailTopicLimit),detail.slice(0,allUsersEmailDetailLimit));
}

export function allUsersEmailBody(message:string){
 const text=message.replace(/\r\n?/g,'\n').trim().slice(0,allUsersEmailMessageLimit);
 return `Sir/Ma'am,\n\n${text}${text?'\n\n':''}Thank you.`;
}

/** The launcher draft request: BCC only, never a To address, so recipients cannot see each other. */
export function allUsersEmailRequest(batch:readonly string[],subject:string,body:string,systemId:string){
 if(!batch.length||batch.length>40)throw new Error('Each draft must contain between 1 and 40 BCC recipients.');
 return JSON.stringify({bcc:batch.join(';'),subject,body,auditSystemIds:[systemId]});
}
