import assert from 'node:assert/strict';
import test from 'node:test';
import {readPageSource} from './page-source.ts';

const page=readPageSource();
const userModal=page.slice(page.indexOf('function UserModal('),page.indexOf('function MessageAutomation('));

test('privilege modification accepts an operator-entered Privileged User Type',()=>{
 assert.match(userModal,/\[privilegedTypeText,setPrivilegedTypeText\]/);
 assert.match(userModal,/Privileged User Type\(s\)<input[^>]*value=\{privilegedTypeText\}[^>]*onChange=\{e=>setDraftPrivilegedTypes\(e\.target\.value\)\}/);
 assert.match(userModal,/A leading underscore is optional/);
 assert.doesNotMatch(userModal,/Privileged Username\(s\)/);
 assert.doesNotMatch(userModal,/Derived PRIV User Type\(s\)/);
});

test('the User Record window closes once an update is stored, and stays open when it fails',()=>{
 assert.match(page,/onSave=\{saveUser\} onSaved=\{\(\)=>setModal\(null\)\}/);
 // Both calls sit after the awaited save inside the try, so a failed save leaves the window and the entries in place.
 assert.match(userModal,/await onSave\(updated,`MODIFY USER: [^\n]*\n\s*setDraft\(updated\);\s*\/\/[^\n]*\n\s*notify\(`\$\{updated\.last\}, \$\{updated\.first\} was updated and saved\.[^\n]*'success','User Record Saved'\);onSaved\(\);\s*\}catch\(error\)/);
 assert.match(userModal,/const updated=await onEditInfo\(user,[^\n]*setEditingInfo\(false\);onSaved\(\)\}catch\(error\)/);
 // Exceptions and Outlook drafts are steps within a review, so they keep the window open.
 assert.equal(userModal.match(/onSaved\(\)/g)?.length,2);
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
