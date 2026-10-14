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

test('active compliance exceptions satisfy newly required privilege evidence',()=>{
 assert.match(userModal,/changeKinds=modify\?newRequired\.filter\(kind=>!baseKinds\.includes\(kind\)&&!originalRequired\.includes\(kind\)&&!exceptionFor\(draft,kind\)\):\[\]/);
 assert.doesNotMatch(userModal,/changeKinds\.every\(kind=>uploads\[kind\]\)/);
 assert.match(userModal,/missingChangeKinds=changeKinds\.filter\(kind=>!uploads\[kind\]\)/);
 assert.match(userModal,/left newly required evidence Missing/);
 assert.match(userModal,/will remain Missing and will not block this account upgrade/);
});

test('multiple compliance exceptions accumulate from the current draft instead of replacing one another',()=>{
 assert.match(userModal,/exceptions=\[\.\.\.\(draft\.exceptions\?\?\[\]\),item\]/);
 assert.match(userModal,/const exceptions=\(draft\.exceptions\?\?\[\]\)\.map/);
 assert.doesNotMatch(userModal,/exceptions=\[\.\.\.\(user\.exceptions\?\?\[\]\),item\]/);
});

test('verified SAAR Sync candidates carry detected account roles and privileged types',()=>{
 assert.match(page,/roles:detectedAccount\.roles,privilegedTypes:detectedAccount\.privilegedTypes/);
 assert.match(page,/action:'Update account role from verified SAAR'/);
 assert.match(page,/verifiedTouchedArtifactKeys\.has\(`\$\{user\.id\}:SAAR`\)/);
});
