export type NotificationState='Missing'|'Due Within 30 Days'|'Overdue';

export function notificationBody(state:NotificationState,requirement:string){
 const issue=state==='Missing'?`Our records indicate you are missing ${requirement}.`:state==='Due Within 30 Days'?`Our records indicate your ${requirement} is due within 30 days.`:`Our records indicate your ${requirement} is overdue.`;
 return `Hello,\n\n${issue}\n\nFailure to provide this requirement may result in loss of access to the system.\n\nPlease provide a copy as soon as possible to maintain your account access.`;
}
