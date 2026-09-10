import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const userModal=page.slice(page.indexOf('function UserModal('),page.indexOf('function MessageAutomation('));

test('privilege modification accepts an operator-entered Privileged User Type',()=>{
 assert.match(userModal,/\[privilegedTypeText,setPrivilegedTypeText\]/);
 assert.match(userModal,/Privileged User Type\(s\)<input[^>]*value=\{privilegedTypeText\}[^>]*onChange=\{e=>setDraftPrivilegedTypes\(e\.target\.value\)\}/);
 assert.match(userModal,/A leading underscore is optional/);
 assert.doesNotMatch(userModal,/Privileged Username\(s\)/);
 assert.doesNotMatch(userModal,/Derived PRIV User Type\(s\)/);
});

test('privilege modification records type changes rather than requiring a username suffix',()=>{
 assert.match(userModal,/draft\.privilegedTypes\.length>0&&draft\.privilegedTypes\.every\(validPrivilegedType\)/);
 assert.match(userModal,/changed Privileged User Types from/);
 assert.doesNotMatch(userModal,/changed privileged usernames from/);
});
