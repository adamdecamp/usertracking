import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOperatorFullName,operatorIdentityLabel,validateOperatorFullName} from '../app/operator-identity.ts';
import {launcherHeaders} from '../app/infrastructure/launcher-session-client.ts';

test('operator identity combines the local full name with the verified Windows alias',()=>{
 assert.equal(operatorIdentityLabel('NOS\\gy730f','  Adam   DeCamp  '),'Adam DeCamp (NOS\\gy730f)');
 assert.equal(operatorIdentityLabel('NOS\\gy730f',''),'NOS\\gy730f');
});

test('operator full names are bounded and normalized without accepting control-only input',()=>{
 assert.equal(normalizeOperatorFullName('Adam\r\nDeCamp'),'Adam DeCamp');
 assert.equal(validateOperatorFullName('Adam DeCamp').valid,true);
 assert.equal(validateOperatorFullName('1').valid,false);
 assert.equal(validateOperatorFullName('7'.repeat(101)).valid,false);
});

test('operator registration preserves content type and authenticated launcher session headers',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{__trackerSessionToken:'clean-install-session',__trackerSessionId:'startup-lease'}});
 try{
  const headers=launcherHeaders({'Content-Type':'application/json'});
  assert.equal(headers.get('Content-Type'),'application/json');
  assert.equal(headers.get('X-RAPTOR-Session-Token'),'clean-install-session');
  assert.equal(headers.get('X-RAPTOR-Lease-Session'),'startup-lease');
 }finally{
  if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');
 }
});
