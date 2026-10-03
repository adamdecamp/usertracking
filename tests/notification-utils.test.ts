import test from 'node:test';
import assert from 'node:assert/strict';
import {availableNotificationKinds,dodCyberTrainingUrl,notificationBody,notificationKindForState,notificationTemplateFor,notificationUsesUserAgreementTemplate,privilegedUserTrainingUrl,qualificationMemoTemplatePattern,userAgreementTemplateFilename} from '../app/notification-utils.ts';

test('creates the approved missing-artifact message',()=>{
 const message=notificationBody('Missing','DoD Cyber Cert');
 assert.match(message,/^Sir\/Ma'am,\n\nOur records show that we do not have a current DoD Cyber Cert for your account\./);
 assert.match(message,/official DoD Cyber Exchange website/);
 assert.match(message,/Once complete, please send us a copy of your certificate/);
 assert.match(message,/If you have already submitted this document/);
 assert.match(message,/will never ask you to provide a password or other login credentials by email/);
 assert.match(message,/Thank you for your assistance\.$/);
});

test('adds the official training URL to every actionable DoD Cyber message only',()=>{
 for(const state of['Missing','Due Within 30 Days','Overdue'] as const)assert.equal(notificationBody(state,'DoD Cyber Cert').split(dodCyberTrainingUrl).length,2,state);
 for(const state of['Missing','Due Within 30 Days','Overdue'] as const)assert.equal(notificationBody(state,'User Agreement').includes(dodCyberTrainingUrl),false,state);
});

test('adds the official CDSE course and free-account note to every Privileged User Training notification',()=>{
 for(const state of['Missing','Due Within 30 Days','Overdue'] as const){
  const message=notificationBody(state,'Privileged User Training Cert');
  assert.equal(message.split(privilegedUserTrainingUrl).length,2,state);
  assert.match(message,/free account is required to complete the training/i,state);
 }
 assert.equal(notificationBody('Missing','DTA Training').includes(privilegedUserTrainingUrl),false);
});

test('prominently adds the appropriate filename instructions to every notification',()=>{
 const expected=[
  ['SAAR','Last_First_(ORG)_GEN_SAAR_DDMMMYYYY.pdf or Last_First_(ORG)_PRIV_TYPE_SAAR_DDMMMYYYY.pdf'],
  ['User Agreement','Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf'],
  ['8140 Cert Memo','Last_First_(ORG)_8140_Cert_Memo_DDMMMYYYY.pdf'],
  ['Privileged User Training Cert','Last_First_(ORG)_PRIV_User_Training_DDMMMYYYY.pdf'],
  ['DTA Training','Last_First_(ORG)_DTA_Training_DDMMMYYYY.pdf'],
 ] as const;
 for(const state of['Missing','Due Within 30 Days','Overdue'] as const)for(const[requirement,format]of expected){
  const message=notificationBody(state,requirement);
  assert.ok(message.includes(`Format: ${format}`),`${state}: ${requirement}`);
  assert.match(message,/Example: Brown_Jacob_\(LM\)_/);
  assert.match(message,/IMPORTANT — REQUIRED FILE NAME/);
  assert.match(message,/Files that do not follow this naming standard may be returned for correction/);
  assert.match(message,/accurately track its due date/i);
 }
});

test('creates the approved overdue-artifact message',()=>{
 assert.match(notificationBody('Overdue','User Agreement'),/^Sir\/Ma'am,\n\nOur records show that your User Agreement is overdue\./);
 assert.match(notificationBody('Overdue','User Agreement'),/IMPORTANT — REQUIRED FILE NAME\n\nFormat: Last_First_\(ORG\)_User_Agreement_DDMMMYYYY\.pdf\nExample: Brown_Jacob_\(LM\)_User_Agreement_26AUG2026\.pdf/);
});

test('creates the approved due-within-30-days message',()=>{
 const message=notificationBody('Due Within 30 Days','Privileged User Training Cert');
 assert.match(message,/^Sir\/Ma'am,\n\nOur records show that your Privileged User Training Cert is due within 30 days\./);
 assert.match(message,/IMPORTANT — REQUIRED FILE NAME\n\nFormat: Last_First_\(ORG\)_PRIV_User_Training_DDMMMYYYY\.pdf\nExample: Brown_Jacob_\(LM\)_PRIV_User_Training_26AUG2026\.pdf/);
 assert.match(message,/A free account is required to complete the training\./);
});

test('uses the approved friendly anti-phishing tone for every state and artifact',()=>{
 const requirements=['SAAR','DoD Cyber Cert','User Agreement','8140 Cert Memo','Privileged User Training Cert','DTA Training'];
 for(const state of['Missing','Due Within 30 Days','Overdue'] as const)for(const requirement of requirements){
  if(state!=='Missing'&&requirement==='SAAR')continue;
  const message=notificationBody(state,requirement);
  assert.match(message,/^Sir\/Ma'am,/);
  assert.doesNotMatch(message,/Failure to provide/i);
  assert.match(message,/please/i);
  assert.match(message,/If you have already submitted this document/);
  assert.match(message,/For security, this message will never ask you to provide a password/);
  assert.match(message,/Thank you for your assistance\.$/);
 }
});

test('replaces an invalid artifact selection when the notification status changes',()=>{
 const kinds=['SAAR','DoD Cyber Cert','User Agreement'];
 assert.deepEqual(availableNotificationKinds('Missing',kinds),kinds);
 assert.deepEqual(availableNotificationKinds('Overdue',kinds),['DoD Cyber Cert','User Agreement']);
 assert.equal(notificationKindForState('Overdue','SAAR',kinds),'DoD Cyber Cert');
 assert.equal(notificationKindForState('Overdue','User Agreement',kinds),'User Agreement');
});

test('attaches only the exact User Agreement template for every actionable notice',()=>{
 assert.equal(userAgreementTemplateFilename,'Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf');
 assert.equal(notificationUsesUserAgreementTemplate('Missing','User Agreement'),true);
 assert.equal(notificationUsesUserAgreementTemplate('Overdue','User Agreement'),true);
 assert.equal(notificationUsesUserAgreementTemplate('Due Within 30 Days','User Agreement'),true);
 assert.equal(notificationUsesUserAgreementTemplate('Missing','DoD Cyber Cert'),false);
 assert.equal(notificationUsesUserAgreementTemplate('Due Within 30 Days','DoD Cyber Cert'),false);
});

test('attaches the dated 8140 qualification memo and explains certification handling',()=>{
 assert.equal(qualificationMemoTemplatePattern,'8140_Qualification_Memo DDMMMYYYY.pdf');
 for(const state of['Missing','Due Within 30 Days','Overdue'] as const){
  assert.equal(notificationTemplateFor(state,'8140 Cert Memo'),'8140-qualification-memo');
  const message=notificationBody(state,'8140 Cert Memo');
  assert.match(message,/do not attach the certification/i);
  assert.match(message,/enter the certification information on the memo/i);
 }
 assert.equal(notificationTemplateFor('Missing','User Agreement'),'user-agreement');
 assert.equal(notificationTemplateFor('Missing','DoD Cyber Cert'),null);
});
