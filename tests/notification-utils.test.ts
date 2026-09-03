import test from 'node:test';
import assert from 'node:assert/strict';
import {availableNotificationKinds,notificationBody,notificationKindForState} from '../app/notification-utils.ts';

test('creates the approved missing-artifact message',()=>{
 assert.equal(notificationBody('Missing','DoD Cyber Cert'),'Hello,\n\nOur records indicate you are missing DoD Cyber Cert.\n\nFailure to provide this requirement may result in loss of access to the system.\n\nPlease provide a copy as soon as possible to maintain your account access.\n\nWhen returning the document, use this filename format:\nLast_First_(ORG)_DoD_Cyber_Cert_DDMMMYYYY.pdf\n\nIncorrectly formatted or incorrectly named files will be rejected. The naming standard matches evidence to the correct user and helps the tracker calculate due dates accurately.');
});

test('adds the appropriate filename instructions to every missing-artifact message',()=>{
 const expected=[
  ['SAAR','Last_First_(ORG)_GEN_SAAR_DDMMMYYYY.pdf or Last_First_(ORG)_PRIV_TYPE_SAAR_DDMMMYYYY.pdf'],
  ['User Agreement','Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf'],
  ['8140 Cert Memo','Last_First_(ORG)_8140_Cert_Memo_DDMMMYYYY.pdf'],
  ['Privileged User Training Cert','Last_First_(ORG)_PRIV_User_Training_DDMMMYYYY.pdf'],
  ['DTA Training Cert','Last_First_(ORG)_DTA_Training_Cert_DDMMMYYYY.pdf'],
 ] as const;
 for(const[requirement,format]of expected){
  const message=notificationBody('Missing',requirement);
  assert.ok(message.includes(format));
  assert.match(message,/incorrectly formatted or incorrectly named files will be rejected/i);
  assert.match(message,/calculate due dates accurately/i);
 }
});

test('creates the approved overdue-artifact message',()=>{
 assert.equal(notificationBody('Overdue','User Agreement'),'Hello,\n\nOur records indicate your User Agreement is overdue.\n\nFailure to provide this requirement may result in loss of access to the system.\n\nPlease provide a copy as soon as possible to maintain your account access.');
});

test('creates the approved due-within-30-days message',()=>{
 assert.equal(notificationBody('Due Within 30 Days','Privileged User Training Cert'),'Hello,\n\nOur records indicate your Privileged User Training Cert is due within 30 days.\n\nFailure to provide this requirement may result in loss of access to the system.\n\nPlease provide a copy as soon as possible to maintain your account access.');
});

test('replaces an invalid artifact selection when the notification status changes',()=>{
 const kinds=['SAAR','DoD Cyber Cert','User Agreement'];
 assert.deepEqual(availableNotificationKinds('Missing',kinds),kinds);
 assert.deepEqual(availableNotificationKinds('Overdue',kinds),['DoD Cyber Cert','User Agreement']);
 assert.equal(notificationKindForState('Overdue','SAAR',kinds),'DoD Cyber Cert');
 assert.equal(notificationKindForState('Overdue','User Agreement',kinds),'User Agreement');
});
