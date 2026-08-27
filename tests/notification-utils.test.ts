import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationBody} from '../app/notification-utils.ts';

test('creates the approved missing-artifact message',()=>{
 assert.equal(notificationBody('Missing','DoD Cyber Cert'),'Hello,\n\nOur records indicate you are missing DoD Cyber Cert.\n\nFailure to provide this requirement may result in loss of access to the system.\n\nPlease provide a copy as soon as possible to maintain your account access.');
});

test('creates the approved overdue-artifact message',()=>{
 assert.equal(notificationBody('Overdue','GEN User Agreement'),'Hello,\n\nOur records indicate your GEN User Agreement is overdue.\n\nFailure to provide this requirement may result in loss of access to the system.\n\nPlease provide a copy as soon as possible to maintain your account access.');
});

test('creates the approved due-within-30-days message',()=>{
 assert.equal(notificationBody('Due Within 30 Days','Privileged User Training Cert'),'Hello,\n\nOur records indicate your Privileged User Training Cert is due within 30 days.\n\nFailure to provide this requirement may result in loss of access to the system.\n\nPlease provide a copy as soon as possible to maintain your account access.');
});
