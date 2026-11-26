import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {ccContactChoices,individualEmailCc,individualEmailCcLimit,type OrganizationContact} from '../app/domain/organization-contacts.ts';
import {readPageSource} from './page-source.ts';

const contact=(id:string,organization:string,position:string,name:string,...methods:OrganizationContact['methods']):OrganizationContact=>({id,organization,position,name,methods});
const contacts=[
 contact('c1','ORG','ISSO','Pat Example',{type:'Email',value:'isso@example.test'}),
 contact('c2','ORG','ISSM','Lee Example',{type:'Phone',value:'(555) 555-0100'},{type:'Email',value:'issm@example.test'}),
 contact('c3','ORG','Program Manager','Sam Example',{type:'Phone',value:'(555) 555-0101'}),
 contact('c4','OTHER','ISSO','Other Org',{type:'Email',value:'other@example.test'}),
 contact('c5','org','CPSO/FSO/GSSO','Kim Example',{type:'Email',value:'ISSO@example.test'}),
];

test('CC choices are the user\'s organization contacts that have an email address',()=>{
 assert.deepEqual(ccContactChoices(contacts,'org').map(item=>item.id),['c5','c2','c1'],'any case match, phone-only contacts and other organizations are excluded, standard position order');
});

test('CC recipients use each chosen contact\'s first email, without duplicates or the user\'s own address',()=>{
 assert.deepEqual(individualEmailCc(contacts,'ORG',['c1','c2','c3','c4'],'user@example.test'),{emails:['issm@example.test','isso@example.test'],labels:['ISSM Lee Example','ISSO Pat Example']});
 assert.deepEqual(individualEmailCc(contacts,'ORG',['c1','c5'],'user@example.test').emails,['isso@example.test'],'two contacts sharing an address are copied once');
 assert.deepEqual(individualEmailCc(contacts,'ORG',['c1'],'ISSO@example.test'),{emails:[],labels:[]},'the user is never copied on their own email');
 assert.deepEqual(individualEmailCc(contacts,'ORG',[],'user@example.test'),{emails:[],labels:[]});
 const many=Array.from({length:25},(_,index)=>contact(`m${index}`,'ORG','ISSO',`Person ${String(index).padStart(2,'0')}`,{type:'Email',value:`p${index}@example.test`}));
 assert.equal(individualEmailCc(many,'ORG',many.map(item=>item.id),'user@example.test').emails.length,individualEmailCcLimit);
});

test('the User Record offers CC choices and the draft carries them to Outlook and the audit',()=>{
 const page=readPageSource();
 assert.match(page,/<IndividualEmailCc contacts=\{system\.organizationContacts\?\?\[\]\} organization=\{draft\.organization\} userEmail=\{draft\.email\} selected=\{ccContactIds\}/);
 assert.match(page,/onPrepareNotification\(draft,notificationIssues,ccContactIds\)/);
 assert.match(page,/cc=individualEmailCc\(system\?\.organizationContacts\?\?\[\],user\.organization,ccContactIds,user\.email\)/);
 assert.match(page,/\.\.\.\(cc\.emails\.length\?\{cc:cc\.emails\.join\(';'\)\}:\{\}\)/);
 assert.match(page,/\$\{cc\.labels\.length\?`; CC \$\{cc\.labels\.join\(', '\)\}`:''\}/,'the audit names who was copied by position and name');
 assert.match(page,/&cc=\$\{encodeURIComponent\(cc\.emails\.join\(','\)\)\}/,'the mailto fallback carries CC too');
});

test('the launcher validates CC and sets it on the Outlook draft and both fallbacks',()=>{
 const program=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8'),fallback=readFileSync(new URL('../portable-launcher/OutlookDraftFallback.cs',import.meta.url),'utf8');
 assert.match(program,/cc = OutlookDraftFallback\.NormalizeCc\(cc, to\);/);
 assert.match(program,/messageType\.InvokeMember\("CC", BindingFlags\.SetProperty/);
 assert.match(program,/OutlookDraftFallback\.Open\(to, recipients, subject, htmlBody, body, attachmentPaths, cc\)/);
 assert.match(fallback,/writer\.WriteLine\("Cc: " \+ safeCc\)/);
 assert.match(fallback,/"&cc=" \+ Uri\.EscapeDataString/);
});
