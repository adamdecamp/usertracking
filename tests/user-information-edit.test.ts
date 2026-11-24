import assert from 'node:assert/strict';
import test from 'node:test';
import {relabelArtifactsForUserIdentity,runBestEffort} from '../app/application/user-information-edit.ts';

test('identity edits attempt every associated file and preserve an association when one move fails',async()=>{
 const prior={id:'user-1',systemId:'system-1',organization:'GOV',affiliatedOrganizations:[],last:'Ramey',first:'Edward',middle:'',email:'edward@example.mil',disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[{kind:'DoD Cyber Cert',filename:'Ramey_Edward_(GOV)_DoD_Cyber_Cert_18SEP2025.pdf.zip',path:'Organizations/GOV/GOV Archive/2025-09-18/Ramey_Edward_(GOV)_DoD_Cyber_Cert_18SEP2025.pdf.zip'},{kind:'User Agreement',filename:'Ramey_Edward_(GOV)_User_Agreement_08JAN2026.pdf.zip',path:'Organizations/GOV/GOV Rework/Ramey_Edward_(GOV)_User_Agreement_08JAN2026.pdf.zip'}]},next={...prior,organization:'EDITORG',last:'Edwards'},attempted:string[]=[];
 const result=await relabelArtifactsForUserIdentity(prior,next,async artifact=>({path:artifact.path!}),async(artifact,filename)=>{attempted.push(artifact.path!);if(artifact.kind==='User Agreement')throw new Error('Network file is locked.');return`Organizations/EDITORG/${filename}`});
 assert.deepEqual(attempted,prior.artifacts.map(artifact=>artifact.path));
 assert.equal(result.moves.length,1);
 assert.equal(result.issues.length,1);
 assert.equal(result.issues[0].artifact,prior.artifacts[1]);
});

test('best-effort evidence relabeling completes other files after an individual failure',async()=>{
 const visited:string[]=[];
 const result=await runBestEffort(['SAAR','DoD Cyber Cert','User Agreement'],async item=>{
  visited.push(item);
  if(item==='DoD Cyber Cert')throw new Error('stale evidence path');
  return`${item} moved`;
 },error=>error instanceof Error?error.message:'unknown error');

 assert.deepEqual(visited,['SAAR','DoD Cyber Cert','User Agreement']);
 assert.deepEqual(result.completed,['SAAR moved','User Agreement moved']);
 assert.deepEqual(result.failures,[{item:'DoD Cyber Cert',reason:'stale evidence path'}]);
});

test('best-effort evidence relabeling reports every failed file without throwing',async()=>{
 const result=await runBestEffort([1,2],async item=>{throw new Error(`failure ${item}`)},error=>error instanceof Error?error.message:'unknown error');
 assert.deepEqual(result.completed,[]);
 assert.deepEqual(result.failures,[{item:1,reason:'failure 1'},{item:2,reason:'failure 2'}]);
});

test('identity edits keep the .pdf extension of evidence stored as a plain PDF',async()=>{
 const prior={id:'user-2',systemId:'system-1',organization:'GOV',affiliatedOrganizations:[],last:'Ramey',first:'Edward',middle:'',email:'',disabled:false,roles:['General'],privilegedUsernames:[],privilegedTypes:[],artifacts:[{kind:'DoD Cyber Cert',filename:'Ramey_Edward_(GOV)_DoD_Cyber_Cert_18SEP2025.pdf',path:'Organizations/GOV/GOV DoD Cyber Cert/Ramey_Edward_(GOV)_DoD_Cyber_Cert_18SEP2025.pdf'},{kind:'User Agreement',filename:'Ramey_Edward_(GOV)_User_Agreement_08JAN2026.pdf.zip',path:'Organizations/GOV/GOV User Agreement/Ramey_Edward_(GOV)_User_Agreement_08JAN2026.pdf.zip'}]},next={...prior,last:'Edwards'},targets:string[]=[];
 const result=await relabelArtifactsForUserIdentity(prior,next,async artifact=>({path:artifact.path!}),async(_artifact,filename)=>{targets.push(filename);return`Organizations/GOV/${filename}`});
 assert.deepEqual(targets,['Edwards_Edward_(GOV)_DoD_Cyber_Cert_18SEP2025.pdf','Edwards_Edward_(GOV)_User_Agreement_08JAN2026.pdf.zip']);
 assert.deepEqual(result.moves.map(move=>move.after.filename),targets);
 assert.equal(result.issues.length,0);
});
