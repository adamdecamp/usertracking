export type NotificationState='Missing'|'Due Within 30 Days'|'Overdue';

export const dodCyberTrainingUrl='https://www.cyber.mil/cyber-awareness-challenge';
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
 const issue=state==='Missing'?`Our records indicate you are missing ${requirement}.`:state==='Due Within 30 Days'?`Our records indicate your ${requirement} is due within 30 days.`:`Our records indicate your ${requirement} is overdue.`;
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
 const trainingInstruction=requirement==='DoD Cyber Cert'?`\n\nComplete the DoD Cyber Awareness Challenge here:\n${dodCyberTrainingUrl}`:'';
 const filenameInstruction=`\n\nIMPORTANT - REQUIRED FILE NAME\nFormat: ${filenameStandard.format}\nExample: ${filenameStandard.example}\n\nFILES THAT DO NOT FOLLOW THIS NAMING STANDARD WILL BE REJECTED.\nRename the file before returning it. The naming standard matches evidence to the correct user and helps the tracker calculate due dates accurately.`;
 return `Hello,\n\n${issue}\n\nFailure to provide this requirement may result in loss of access to the system.${trainingInstruction}\n\nPlease provide a copy as soon as possible to maintain your account access.${filenameInstruction}`;
}
