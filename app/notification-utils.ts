export type NotificationState='Missing'|'Due Within 30 Days'|'Overdue';

export const dodCyberTrainingUrl='https://www.cyber.mil/cyber-awareness-challenge';
export const privilegedUserTrainingUrl='https://www.cdse.edu/Training/eLearning/DS-IA112/';
export const userAgreementTemplateFilename='Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf';

export function notificationUsesUserAgreementTemplate(state:NotificationState,requirement:string){
 return requirement==='User Agreement'&&['Missing','Due Within 30 Days','Overdue'].includes(state);
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
 const filenameByRequirement:Record<string,{format:string;example:string}>={
  SAAR:{format:'Last_First_(ORG)_GEN_SAAR_DDMMMYYYY.pdf or Last_First_(ORG)_PRIV_TYPE_SAAR_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf or Brown_Jacob_(LM)_PRIV_DTA_SAAR_26AUG2026.pdf'},
  'DoD Cyber Cert':{format:'Last_First_(ORG)_DoD_Cyber_Cert_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf'},
  'User Agreement':{format:'Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_User_Agreement_26AUG2026.pdf'},
  '8140 Cert Memo':{format:'Last_First_(ORG)_8140_Cert_Memo_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_8140_Cert_Memo_26AUG2026.pdf'},
  'Privileged User Training Cert':{format:'Last_First_(ORG)_PRIV_User_Training_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_PRIV_User_Training_26AUG2026.pdf'},
  'DTA Training':{format:'Last_First_(ORG)_DTA_Training_DDMMMYYYY.pdf',example:'Brown_Jacob_(LM)_DTA_Training_26AUG2026.pdf'},
 };
 const fallback=`Last_First_(ORG)_${requirement.replace(/[^A-Za-z0-9]+/g,'_')}_DDMMMYYYY.pdf`;
 const filenameStandard=filenameByRequirement[requirement]??{format:fallback,example:fallback.replace('Last_First_(ORG)','Brown_Jacob_(LM)').replace('DDMMMYYYY','26AUG2026')};
 const trainingInstruction=requirement==='DoD Cyber Cert'?`\n\nPlease complete the DoD Cyber Awareness Challenge at the official DoD Cyber Exchange website:\n${dodCyberTrainingUrl}`:requirement==='Privileged User Training Cert'?`\n\nPlease complete the CDSE Privileged User Cybersecurity Responsibilities training at the official CDSE website:\n${privilegedUserTrainingUrl}\n\nA free account is required to complete the training.`:'';
 const trainingRequirement=['DoD Cyber Cert','Privileged User Training Cert','DTA Training'].includes(requirement),responseRequest=trainingRequirement?'Once complete, please send us a copy of your certificate using the filename format below.':requirement==='User Agreement'?'Please complete and return the User Agreement using the filename format below.':requirement==='SAAR'?'Please complete and return the SAAR using the filename format below.':`Please send us a current copy of your ${requirement} using the filename format below.`;
 const filenameInstruction=`\n\nUsing this format helps us associate the document with the correct account and accurately track its due date.\n\nIMPORTANT — REQUIRED FILE NAME\n\nFormat: ${filenameStandard.format}\nExample: ${filenameStandard.example}\n\nFiles that do not follow this naming standard may be returned for correction.`;
 return `Sir/Ma'am,\n\n${issue}${trainingInstruction}\n\n${responseRequest}${filenameInstruction}\n\nIf you have already submitted this document, please let us know so we can verify that it was received and properly recorded. Keeping this requirement current helps prevent an interruption to your system access.\n\nFor security, this message will never ask you to provide a password or other login credentials by email.\n\nThank you for your assistance.`;
}
