import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodePendingEvidenceMoves,newPendingEvidenceMove,pendingEvidenceMoveSummary,queuePendingEvidenceMove,updatePendingEvidenceQueue,withPendingMoves,type PendingEvidenceMove} from '../app/domain/pending-evidence-moves.ts';
import {runPendingEvidenceMoves,type PendingEvidenceOperations} from '../app/application/pending-evidence-commit.ts';
import type {Artifact,SystemRecord,UserRecord} from '../app/domain/tracker-models.ts';

// Synthetic records only; no operational data.
const user=(id:string,last:string,artifacts:Artifact[],extra:Partial<UserRecord>={}):UserRecord=>({id,systemId:'s1',organization:'GOV',affiliatedOrganizations:[],last,first:'Test',middle:'',email:`${id}@example.test`,disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts,...extra});
const file=(last:string,kind:string,token:string,folder='GOV DoD Cyber Cert'):Artifact=>({kind,filename:`${last}_Test_(GOV)_${token}_01OCT2026.pdf.zip`,path:`Organizations/GOV/${folder}/${last}_Test_(GOV)_${token}_01OCT2026.pdf.zip`});
const at='2026-11-25T12:00:00.000Z';
const move=(work:PendingEvidenceMove['work'],person:{id:string;last:string;first:string},extra:Partial<PendingEvidenceMove>={}):PendingEvidenceMove=>({...newPendingEvidenceMove(work,person,'Operator',{},at),...extra});
const system=(moves:PendingEvidenceMove[]):SystemRecord=>({id:'s1',name:'Test System',type:'Test',organization:'GOV',archived:false,pendingEvidenceMoves:moves});
const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

class MissingFile extends Error{}
class LeaseLost extends Error{}
function operations(overrides:Partial<PendingEvidenceOperations>={}){
 const calls:string[]=[];
 const ops:PendingEvidenceOperations={
  archive:async(owner,artifact)=>{calls.push(`archive ${artifact.path}`);if(artifact.filename.includes('MISSING'))throw new MissingFile('gone');if(artifact.filename.includes('BUSY'))throw new Error('The shared folder is busy.');return artifact.path!.replace(/\/[^/]+\/([^/]+)$/,'/GOV Archive/2026-11-25/$1')},
  relabel:async next=>{calls.push(`relabel ${next.last}`);return{user:next,issues:0,detail:''}},
  restoreSaar:async next=>{calls.push(`restore ${next.last}`);return{artifact:{kind:'SAAR',filename:`${next.last}_Test_(GOV)_GEN_SAAR_01OCT2026.pdf.zip`,path:'Organizations/GOV/GOV SAAR/restored.pdf.zip'},destination:'Organizations/GOV/GOV SAAR/restored.pdf.zip'}},
  archiveDeletedUser:async deleted=>{calls.push(`delete ${deleted.last}`);return{moved:[{source:'a',destination:'b'}],missingErrors:[],blockingErrors:[]}},
  isArchived:path=>/ Archive\//i.test(path),
  isMissing:error=>error instanceof MissingFile,
  isFatal:error=>error instanceof LeaseLost,
  describe:error=>error instanceof Error?error.message:'failed',
  actor:'Operator',now:()=>at,
  ...overrides,
 };
 return{ops,calls};
}

test('the queue cancels opposite requests, ignores repeats, and a deletion replaces the user’s other requests',()=>{
 const jane={id:'u1',last:'Doe',first:'Jane'};
 let queue=queuePendingEvidenceMove([],move('archive-user',jane));
 queue=queuePendingEvidenceMove(queue,move('archive-user',jane));
 assert.equal(queue.length,1,'disabling twice queues one archive');
 queue=queuePendingEvidenceMove(queue,move('restore-saar',jane));
 assert.deepEqual(queue.map(item=>item.work),['restore-saar'],'re-enabling cancels the waiting archive');
 queue=queuePendingEvidenceMove(queue,move('archive-user',jane));
 assert.deepEqual(queue.map(item=>item.work),['archive-user'],'disabling again cancels the waiting restore');
 const released=move('archive-file',jane,{file:{kind:'SAAR',filename:'x.pdf.zip',path:'Organizations/GOV/GOV SAAR/x.pdf.zip'}});
 queue=updatePendingEvidenceQueue(queue,[released,move('relabel-user',jane)]);
 queue=queuePendingEvidenceMove(queue,{...released,id:'other'});
 assert.equal(queue.filter(item=>item.work==='archive-file').length,1,'the same released file is queued once');
 const deleted=move('archive-deleted-user',jane,{user:{id:'u1',last:'Doe',first:'Jane',organization:'GOV',disabled:true,artifacts:[]}});
 assert.deepEqual(queuePendingEvidenceMove(queue,deleted).map(item=>item.work),['archive-file','archive-deleted-user'],'deleting keeps files released to other records');
 assert.deepEqual(updatePendingEvidenceQueue(queue,[],[{userId:'u1',work:'archive-user'}]).map(item=>item.work),['archive-file','relabel-user']);
 assert.equal('pendingEvidenceMoves'in withPendingMoves(system([]),[]),false,'an empty queue leaves the field off');
 assert.match(pendingEvidenceMoveSummary(queue),/^3 file changes are waiting for Session Commit: archive a disabled user’s files \(Doe, Jane\)/);
});

test('the decoder accepts a well-formed queue and rejects anything that does not match its work',()=>{
 const good=[move('archive-user',{id:'u1',last:'Doe',first:'Jane'}),move('archive-file',{id:'u2',last:'Roe',first:'Sam'},{file:{kind:'SAAR',filename:'x.pdf.zip',path:'Organizations/GOV/GOV SAAR/x.pdf.zip'}})];
 assert.deepEqual(decodePendingEvidenceMoves(JSON.parse(JSON.stringify(good))),good);
 for(const bad of[
  [{...good[0],work:'shred'}],
  [{...good[0],file:good[1].file}],
  [{...good[1],file:undefined}],
  [{...good[1],file:{...good[1].file,path:'../outside.pdf'}}],
  [good[0],good[0]],
  [{...good[0],requestedAt:'not a date'}],
  [move('archive-deleted-user',{id:'u1',last:'Doe',first:'Jane'},{user:{id:'someone-else',last:'Doe',first:'Jane',organization:'GOV',disabled:false,artifacts:[]}})],
 ])assert.equal(decodePendingEvidenceMoves(JSON.parse(JSON.stringify(bad))),undefined,JSON.stringify(bad).slice(0,80));
});

test('Session Commit archives a disabled user’s active files, keeps archived ones, and records the change',async()=>{
 const jane=user('u1','Doe',[file('Doe','DoD Cyber Cert','DoD_Cyber_Cert'),file('Doe','SAAR','GEN_SAAR','GOV SAAR Archive')],{disabled:true});
 const{ops,calls}=operations();
 const result=await runPendingEvidenceMoves(system([move('archive-user',jane)]),[jane],ops);
 assert.deepEqual(calls,['archive Organizations/GOV/GOV DoD Cyber Cert/Doe_Test_(GOV)_DoD_Cyber_Cert_01OCT2026.pdf.zip'],'a file already in an Archive folder is not moved again');
 assert.equal(result.users[0].artifacts[0].path,'Organizations/GOV/GOV Archive/2026-11-25/Doe_Test_(GOV)_DoD_Cyber_Cert_01OCT2026.pdf.zip');
 assert.equal(result.users[0].changes?.at(-1)?.action,'Archive Disabled User Evidence');
 assert.equal('pendingEvidenceMoves'in result.system,false,'a finished queue is cleared');
 assert.equal(result.retained,0);
 assert.match(result.audit[0],/^SESSION COMMIT FILE MOVES: Doe, Test; archived 1 disabled-user file/);
});

test('a missing file is reported and dropped, a busy folder keeps the request, and a lost lease stops the commit',async()=>{
 const missing=user('u1','Gone',[{...file('Gone','DoD Cyber Cert','DoD_Cyber_Cert'),filename:'MISSING.pdf.zip'}],{disabled:true});
 const busy=user('u2','Busy',[{...file('Busy','DoD Cyber Cert','DoD_Cyber_Cert'),filename:'BUSY.pdf.zip'}],{disabled:true});
 const result=await runPendingEvidenceMoves(system([move('archive-user',missing),move('archive-user',busy)]),[missing,busy],operations().ops);
 assert.equal(result.retained,1);
 assert.deepEqual(result.system.pendingEvidenceMoves?.map(item=>item.userId),['u2'],'only the busy request waits for the next commit');
 assert.equal(result.users[1].artifacts[0].filename,'BUSY.pdf.zip','a file that did not move keeps its reference');
 assert.ok(result.warnings.some(item=>item.includes('gone'))&&result.warnings.some(item=>item.includes('busy')));
 await assert.rejects(runPendingEvidenceMoves(system([move('archive-user',busy)]),[busy],operations({archive:async()=>{throw new LeaseLost('lease lost')}}).ops),LeaseLost);
});

test('archiving a disabled user’s files together gives the same results as one file at a time',async()=>{
 const people=()=>[user('u1','Doe',[file('Doe','DoD Cyber Cert','DoD_Cyber_Cert'),file('Doe','SAAR','GEN_SAAR','GOV SAAR Archive'),{...file('Doe','User Agreement','User_Agreement'),filename:'MISSING.pdf.zip'}],{disabled:true}),user('u2','Busy',[{...file('Busy','DoD Cyber Cert','DoD_Cyber_Cert'),filename:'BUSY.pdf.zip'}],{disabled:true})];
 const queue=(records:UserRecord[])=>system(records.map(record=>move('archive-user',record)));
 const single=operations(),singleUsers=people(),oneAtATime=await runPendingEvidenceMoves(queue(singleUsers),singleUsers,single.ops);
 const batches:string[][]=[],batched=operations();
 batched.ops.archiveMany=async(owner,artifacts)=>{batches.push(artifacts.map(artifact=>artifact.filename));const outcomes:({ok:true;value:string}|{ok:false;error:unknown})[]=[];for(const artifact of artifacts)try{outcomes.push({ok:true,value:await batched.ops.archive(owner,artifact)})}catch(error){outcomes.push({ok:false,error})}return outcomes};
 const batchedUsers=people(),together=await runPendingEvidenceMoves(queue(batchedUsers),batchedUsers,batched.ops);
 assert.deepEqual(batches,[['Doe_Test_(GOV)_DoD_Cyber_Cert_01OCT2026.pdf.zip','MISSING.pdf.zip'],['BUSY.pdf.zip']],'one call per user, without files already in Archive');
 assert.deepEqual({users:together.users,audit:together.audit,retained:together.retained,warnings:together.warnings},{users:oneAtATime.users,audit:oneAtATime.audit,retained:oneAtATime.retained,warnings:oneAtATime.warnings});
 const failedUsers=people(),failed=await runPendingEvidenceMoves(queue(failedUsers),failedUsers,operations({archiveMany:async()=>{throw new Error('The launcher stopped responding.')}}).ops);
 assert.equal(failed.retained,2,'a failed batch keeps every request for the next commit');
 assert.equal(failed.users[0].artifacts[0].filename,'Doe_Test_(GOV)_DoD_Cyber_Cert_01OCT2026.pdf.zip','files that did not move keep their references');
 const leaseUsers=people();await assert.rejects(runPendingEvidenceMoves(queue(leaseUsers),leaseUsers,operations({archiveMany:async()=>{throw new LeaseLost('lease lost')}}).ops),LeaseLost);
});

test('requests follow the record as it stands at commit and run renames before archives',async()=>{
 const active=user('u1','Back',[file('Back','DoD Cyber Cert','DoD_Cyber_Cert')]);
 const disabled=user('u2','Away',[file('Away','DoD Cyber Cert','DoD_Cyber_Cert')],{disabled:true});
 const{ops,calls}=operations();
 const result=await runPendingEvidenceMoves(system([move('archive-user',active),move('archive-user',disabled),move('relabel-user',disabled),move('restore-saar',disabled),move('restore-saar',active)]),[active,disabled],ops);
 assert.deepEqual(calls,['relabel Away','restore Back','archive Organizations/GOV/GOV DoD Cyber Cert/Away_Test_(GOV)_DoD_Cyber_Cert_01OCT2026.pdf.zip'],'renaming runs first; an archive for a re-enabled user and a restore for a disabled user are skipped');
 assert.equal(result.users[0].artifacts.find(item=>item.kind==='SAAR')?.path,'Organizations/GOV/GOV SAAR/restored.pdf.zip');
 assert.equal(result.retained,0);
});

test('released files and deleted users are archived at commit, and a blocked deletion waits for the next commit',async()=>{
 const deleted=move('archive-deleted-user',{id:'u9',last:'Left',first:'Test'},{user:{id:'u9',last:'Left',first:'Test',organization:'GOV',disabled:false,artifacts:[]}});
 const released=move('archive-file',{id:'u3',last:'Prior',first:'Owner'},{file:{kind:'SAAR',filename:'Prior_Owner_(GOV)_GEN_SAAR_01OCT2026.pdf.zip',path:'Organizations/GOV/GOV SAAR/Prior_Owner_(GOV)_GEN_SAAR_01OCT2026.pdf.zip'}});
 const{ops,calls}=operations();
 const done=await runPendingEvidenceMoves(system([deleted,released]),[],ops);
 assert.deepEqual(calls,['archive Organizations/GOV/GOV SAAR/Prior_Owner_(GOV)_GEN_SAAR_01OCT2026.pdf.zip','delete Left']);
 assert.equal(done.retained,0);
 const blocked=await runPendingEvidenceMoves(system([deleted]),[],operations({archiveDeletedUser:async()=>({moved:[],missingErrors:[],blockingErrors:['x.pdf.zip: access denied']})}).ops);
 assert.equal(blocked.retained,1);
 assert.match(blocked.audit[0],/kept for the next commit: x\.pdf\.zip: access denied/);
});

test('record changes queue their file moves, and Session Commit and logoff run them before publishing',()=>{
 const page=read('app/page.tsx'),launcher=read('portable-launcher/PortableManifestValidation.cs'),storage=read('portable-launcher/PortableStorage.cs');
 const commit=page.slice(page.indexOf(' async function commitSession(){'),page.indexOf(' async function logOff(){'));
 assert.ok(commit.indexOf('runQueuedEvidenceMoves(root,systemId,')<commit.indexOf('publishSystemWorkspace(root,systemId,queued.systems,queued.users'),'queued moves finish before the database is published');
 assert.match(page,/writeSystemManifest\(root,systemId,nextSystems,result\.users\);setSystems\(nextSystems\);setUsers\(result\.users\)/,'the moved references are saved locally before publication');
 assert.match(page,/nextSystems=systems\.map\(item=>item\.id===u\.systemId\?withPendingMoves\(item,updatePendingEvidenceQueue\(item\.pendingEvidenceMoves,moves,\[\{userId:u\.id,work:u\.disabled\?'restore-saar':'archive-user'\}\]\)\):item\)/,'every user save keeps the queue consistent with the record');
 assert.match(page,/newPendingEvidenceMove\('archive-file',owner,currentActor\(\)/,'an evidence transfer queues the prior owner’s file');
 assert.doesNotMatch(page.slice(page.indexOf(' async function saveUser('),page.indexOf(' async function editUserInformation')),/archiveEvidence\(/,'saving a user never moves files');
 assert.match(launcher,/internal static void ValidateSystemPendingEvidenceMoves/);
 assert.match(storage,/ValidateSystemOrganizationContacts\(system\);ValidateSystemPendingEvidenceMoves\(system\);/);
 assert.match(storage,/if \(version != 9 \|\| !value\.ContainsKey\("systems"\)/);
});
