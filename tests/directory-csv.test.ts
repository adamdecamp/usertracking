import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {csvCompliance,filteredDirectoryCsvRows} from '../app/csv-utils.ts';
import {dashboardStats} from '../app/application/dashboard-stats.ts';
import type {Artifact,SystemRecord,UserRecord} from '../app/domain/tracker-models.ts';

// Synthetic records only; no operational data.
const system:SystemRecord={id:'s1',name:'Test System',type:'Test',organization:'GOV',archived:false};
const user=(id:string,last:string,artifacts:Artifact[],extra:Partial<UserRecord>={}):UserRecord=>({id,systemId:'s1',organization:'GOV',affiliatedOrganizations:[],last,first:'Test',middle:'',email:`${id}@example.test`,disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts,...extra});
const file=(last:string,kind:string,token:string,date:string):Artifact=>({kind,filename:`${last}_Test_(GOV)_${token}_${date}.pdf`});
const complete=(last:string,date:string)=>[file(last,'SAAR','GEN_SAAR',date),file(last,'DoD Cyber Cert','DoD_Cyber_Cert',date),file(last,'User Agreement','User_Agreement',date)];
const asOf=new Date('2026-11-22T18:00:00.000Z');

/** Minimal RFC 4180 reader for the quoted export. */
function parse(csv:string){
 assert.equal(csv.charCodeAt(0),0xfeff,'the export starts with a byte-order mark for Excel');
 return csv.slice(1).split('\n').map(line=>line.slice(1,-1).split('","').map(value=>value.replaceAll('""','"')));
}

test('the export has one row per user with Compliance first',()=>{
 const users=[user('a','Current',complete('Current','01OCT2026')),user('b','Nothing',[]),user('c','Late',complete('Late','01JAN2025')),user('d','Soon',complete('Soon','01DEC2025'))];
 const result=filteredDirectoryCsvRows(users,system,asOf),[header,...rows]=parse(result.csv);
 assert.equal(result.rowCount,4);assert.equal(rows.length,4,'each user is exactly one line');
 assert.equal(header[0],'Compliance');
 const column=(name:string)=>header.indexOf(name),byLast=new Map(rows.map(row=>[row[column('Last name')],row]));
 assert.deepEqual(rows.map(row=>row[0]),[csvCompliance.compliant,csvCompliance.notCompliant,csvCompliance.notCompliant,csvCompliance.compliant]);
 assert.equal(result.notCompliant,2);
 assert.equal(byLast.get('Nothing')![column('Requirements not met')],'3');
 assert.equal(byLast.get('Nothing')![column('Action needed')],'SAAR: Missing; DoD Cyber Cert: Missing; User Agreement: Missing');
 assert.match(byLast.get('Late')![column('Action needed')],/^DoD Cyber Cert: Overdue \d+ Days; User Agreement: Overdue \d+ Days$/);
 assert.equal(byLast.get('Current')![column('SAAR')],'Present');
 assert.match(byLast.get('Soon')![column('User Agreement')],/^Due in \d+ Days?$/,'due soon is still compliant and says when');
 assert.equal(byLast.get('Current')![column('Action needed')],'');
});

test('compliance matches the dashboard count',()=>{
 const users=[user('a','Current',complete('Current','01OCT2026')),user('b','Nothing',[]),user('c','OnlySaar',[file('OnlySaar','SAAR','GEN_SAAR','01OCT2026')]),user('d','Late',complete('Late','01JAN2025')),user('e','Soon',complete('Soon','01DEC2025'))];
 const result=filteredDirectoryCsvRows(users,system,asOf),stats=dashboardStats(users,asOf);
 assert.equal(result.rowCount-result.notCompliant,stats.compliantUsers);
 assert.equal(result.notCompliant,stats.nonCompliantUsers);
});

test('requirements a user does not have say Not required, disabled users are marked Disabled, and exceptions are shown',()=>{
 const privileged=user('p','Admin',[],{roles:['General','Privileged'],privilegedTypes:['SA']}),general=user('g','General',complete('General','01OCT2026')),disabled=user('x','Gone',[],{disabled:true});
 const withException=user('e','Excused',[file('Excused','SAAR','GEN_SAAR','01OCT2026'),file('Excused','User Agreement','User_Agreement','01OCT2026')],{exceptions:[{id:'ex1',artifact:'DoD Cyber Cert',reason:'Course pending',approvedBy:'Approver',createdAt:'2026-11-01T00:00:00.000Z',createdBy:'Operator',expiresOn:'2026-12-31'}]});
 const [header,...rows]=parse(filteredDirectoryCsvRows([privileged,general,disabled,withException],system,asOf).csv),column=(name:string)=>header.indexOf(name),byLast=new Map(rows.map(row=>[row[column('Last name')],row]));
 const privilegedOnly=header.slice(column('Action needed')+1,column('Privileged username')).find(kind=>byLast.get('General')![column(kind)]==='Not required');
 assert.ok(privilegedOnly,'a privileged-only requirement shows Not required for a general user');
 assert.equal(byLast.get('Gone')![0],csvCompliance.disabled);
 assert.equal(byLast.get('Gone')![column('User status')],'Disabled');
 assert.equal(byLast.get('Excused')![0],csvCompliance.notCompliant,'an exception is shown but does not count as compliant');
 assert.equal(byLast.get('Excused')![column('DoD Cyber Cert')],'Missing (Exception through 2026-12-31)');
});

test('formula-like values are neutralized and the page names the file by organization',()=>{
 const [,row]=parse(filteredDirectoryCsvRows([user('f','=Formula',[])],system,asOf).csv);
 assert.equal(row[1],"'=Formula");
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/filteredDirectoryCsvRows\(visible,system,asOf\)/);
 assert.match(page,/orgFilter==='All organizations'\?'':`\$\{safeFilePart\(orgFilter,60\)\}_`\}Compliance_/);
});
