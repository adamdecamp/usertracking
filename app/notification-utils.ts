export type NotificationState='Missing'|'Due Within 30 Days'|'Overdue';

export const dodCyberTrainingUrl='https://www.cyber.mil/cyber-awareness-challenge';
export const privilegedUserTrainingUrl='https://www.cdse.edu/Training/eLearning/DS-IA112/';
export const userAgreementTemplateFilename='Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf';
export const qualificationMemoTemplatePattern='8140_Qualification_Memo DDMMMYYYY.pdf';
export const annualRevalidationNotice='DoD Cyber Certifications, 8140 Certification Memos, DTA Training, Privileged User Training, and User Agreements must be revalidated annually.';

export type NotificationTemplate='user-agreement'|'8140-qualification-memo'|null;
export type NotificationIssue={state:NotificationState;requirement:string};

const filenameByRequirement:Record<string,{format:string;example:string}>={
 SAAR:{format:'Last_First_(ORG)_GEN_SAAR_DDMMMYYYY.pdf or Last_First_(ORG)_PRIV_TYPE_SAAR_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf or Brown_Jacob_(LM)_PRIV_DTA_SAAR_26AUG2026.pdf'},
 'DoD Cyber Cert':{format:'Last_First_(ORG)_DoD_Cyber_Cert_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf'},
 'User Agreement':{format:'Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_User_Agreement_26AUG2026.pdf'},
 '8140 Cert Memo':{format:'Last_First_(ORG)_8140_Cert_Memo_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_8140_Cert_Memo_26AUG2026.pdf'},
 'Privileged User Training Cert':{format:'Last_First_(ORG)_PRIV_User_Training_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_PRIV_User_Training_26AUG2026.pdf'},
 'DTA Training':{format:'Last_First_(ORG)_DTA_Training_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_DTA_Training_26AUG2026.pdf'},
};

export function notificationFilenameStandard(requirement:string){
 const fallback=`Last_First_(ORG)_${requirement.replace(/[^A-Za-z0-9]+/g,'_')}_DDMMMYYYY.pdf`;
 return filenameByRequirement[requirement]??{format:fallback,example:fallback.replace('Last_First_(ORG)','Brown_Jacob_(LM)').replace('DDMMMYYYY','26AUG2026')};
}

export function notificationUsesUserAgreementTemplate(state:NotificationState,requirement:string){
 return requirement==='User Agreement'&&['Missing','Due Within 30 Days','Overdue'].includes(state);
}

export function notificationTemplateFor(state:NotificationState,requirement:string):NotificationTemplate{
 if(notificationUsesUserAgreementTemplate(state,requirement))return'user-agreement';
 if(requirement==='8140 Cert Memo'&&['Missing','Due Within 30 Days','Overdue'].includes(state))return'8140-qualification-memo';
 return null;
}

export function availableNotificationKinds(state:NotificationState,kinds:readonly string[]){
 return state==='Missing'?[...kinds]:kinds.filter(kind=>kind!=='SAAR');
}

export function notificationKindForState(state:NotificationState,current:string,kinds:readonly string[]){
 const available=availableNotificationKinds(state,kinds);
 return available.includes(current)?current:available[0]??'';
}

export function notificationBody(state:NotificationState,requirement:string){
 const issue=state==='Missing'?`Our records show that we do not have a current ${requirement} for your account.`:state==='Due Within 30 Days'?`Our records show that your ${requirement} is due within 30 days.`:`Our records show that your ${requirement} is overdue.`;
 const filenameStandard=notificationFilenameStandard(requirement);
 const trainingInstruction=requirement==='DoD Cyber Cert'?`\n\nPlease complete the DoD Cyber Awareness Challenge at the official DoD Cyber Exchange website:\n${dodCyberTrainingUrl}`:requirement==='Privileged User Training Cert'?`\n\nPlease complete the CDSE Privileged User Cybersecurity Responsibilities training at the official CDSE website:\n${privilegedUserTrainingUrl}\n\nA free account is required to complete the training.`:requirement==='8140 Cert Memo'?`\n\nPlease complete and return the attached 8140 Qualification Memo. If you are using certifications to satisfy the requirement, do not attach the certification; enter the certification information on the memo instead.`:'';
 const trainingRequirement=['DoD Cyber Cert','Privileged User Training Cert','DTA Training'].includes(requirement),responseRequest=trainingRequirement?'Once complete, please send us a copy of your certificate using the filename format below.':requirement==='User Agreement'?'Please complete and return the User Agreement using the filename format below.':requirement==='SAAR'?'Please complete and return the SAAR using the filename format below.':requirement==='8140 Cert Memo'?'Please return the completed qualification memo using the filename format below.':`Please send us a current copy of your ${requirement} using the filename format below.`;
 const filenameInstruction=`\n\nUsing this format helps us associate the document with the correct account and accurately track its due date.\n\nIMPORTANT — REQUIRED FILE NAME\n\nFormat: ${filenameStandard.format}\nExample: ${filenameStandard.example}\n\nFiles that do not follow this naming standard may be returned for correction.`;
 return `Sir/Ma'am,\n\n${issue}\n\n${annualRevalidationNotice}${trainingInstruction}\n\n${responseRequest}${filenameInstruction}\n\nIf you have already submitted this document, please let us know so we can verify that it was received and properly recorded. Keeping this requirement current helps prevent an interruption to your system access.\n\nFor security, this message will never ask you to provide a password or other login credentials by email.\n\nThank you for your assistance.`;
}

export function individualNotificationBody(issues:readonly NotificationIssue[],attemptNumber=1){
 const unique=Array.from(new Map(issues.map(issue=>[`${issue.state}:${issue.requirement}`,issue])).values());
 if(!unique.length)throw new Error('At least one compliance requirement is needed to prepare an Outlook draft.');
 if(!Number.isSafeInteger(attemptNumber)||attemptNumber<1)throw new Error('The notification attempt number must be a positive whole number.');
 const issueLines=unique.map(issue=>`• ${issue.requirement} — ${issue.state}`).join('\n');
 const requirements=new Set(unique.map(issue=>issue.requirement));
 const instructions:string[]=[];
 if(requirements.has('DoD Cyber Cert'))instructions.push(`DoD Cyber Awareness Challenge:\n${dodCyberTrainingUrl}`);
 if(requirements.has('Privileged User Training Cert'))instructions.push(`CDSE Privileged User Cybersecurity Responsibilities training (a free account is required):\n${privilegedUserTrainingUrl}`);
 if(requirements.has('8140 Cert Memo'))instructions.push('Please complete and return the attached 8140 Qualification Memo. If you are using certifications to satisfy the requirement, do not attach the certification; enter the certification information on the memo instead.');
 if(requirements.has('User Agreement'))instructions.push('Please complete and return the attached User Agreement.');
 const standards=unique.map(issue=>{const standard=notificationFilenameStandard(issue.requirement);return `${issue.requirement}\nFormat: ${standard.format}\nExample: ${standard.example}`}).join('\n\n');
 const supplemental=instructions.length?`\n\n${instructions.join('\n\n')}`:'';
 const priorDrafts=attemptNumber-1,attemptStatement=priorDrafts===0?'Contact Attempt 1: This is our first documented outreach regarding these requirements.':`Contact Attempt ${attemptNumber}: Our records show that ${priorDrafts} previous Outlook draft${priorDrafts===1?' was':'s were'} prepared regarding these outstanding requirements.`;
 return `Sir/Ma'am,\n\nOur records show that the following account documents need your attention:\n\n${issueLines}\n\n${attemptStatement}\n\n${annualRevalidationNotice}${supplemental}\n\nPlease complete or provide the applicable documents using the filename standards below. Using these formats helps us associate each document with the correct account and accurately track its due date.\n\nIMPORTANT — REQUIRED FILE NAMES\n\n${standards}\n\nFiles that do not follow these naming standards may be returned for correction.\n\nIf you have already submitted any of these documents, please let us know so we can verify that they were received and properly recorded. Keeping these requirements current helps prevent an interruption to your system access.\n\nFor security, this message will never ask you to provide a password or other login credentials by email.\n\nThank you for your assistance.`;
}
