import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeJsonResponse,RuntimeDecodeError} from '../app/infrastructure/runtime-decoders.ts';
import {
 decodeCachedMappingResponse,decodeEvidenceFilenameResponse,decodeEvidenceStatusResponse,decodeLauncherControlResponse,
 decodeLeaseAcquireResponse,decodeLeaseRenewResponse,decodeOperationReceipt,decodeOrganizationList,
 decodeOrganizationResponse,decodePathMutationResponse,decodePublishResponse,decodeSelectedFolderResponse,
 decodeStorageVerificationResponse,decodeStoredEvidenceResponse,
} from '../app/infrastructure/portable-contracts.ts';

const hash='a'.repeat(64);

test('portable response contracts accept bounded valid payloads',()=>{
 assert.deepEqual(decodeLeaseAcquireResponse({acquired:true}),{acquired:true});
 assert.deepEqual(decodeLeaseRenewResponse({renewed:false}),{renewed:false});
 assert.deepEqual(decodeEvidenceFilenameResponse({filename:'A.pdf'}),{filename:'A.pdf'});
 assert.deepEqual(decodeStoredEvidenceResponse({filename:'A.zip',path:'Org/A.zip',sha256:hash,stored:true}),{filename:'A.zip',path:'Org/A.zip',sha256:hash,pdfSha256:undefined,stored:true});
 assert.equal(decodeEvidenceStatusResponse({filename:'A.zip',path:'Org/A.zip',sha256:hash,stored:true}).stored,true);
 assert.deepEqual(decodeOrganizationList(['Alpha','Bravo']),['Alpha','Bravo']);
 assert.deepEqual(decodeOrganizationResponse({organization:'Alpha'}),{organization:'Alpha'});
 assert.deepEqual(decodeOperationReceipt({operationId:'op-1'}),{operationId:'op-1'});
 assert.deepEqual(decodeLauncherControlResponse({activeStorageRequests:2,longOperationActive:true,activeOperation:'sync'}),{activeStorageRequests:2,longOperationActive:true,activeOperation:'sync'});
 assert.equal(decodePathMutationResponse('archived','Archive')({archived:'Archive/A.zip'}).path,'Archive/A.zip');
 assert.equal(decodeStorageVerificationResponse({saved:'2026-10-16T00:00:00Z',backup:'2026-10-16T00:00:00Z',filename:'manifest.json',auditEntries:1,auditHeadHash:hash,manifestSha256:hash}).auditEntries,1);
 const publication=decodePublishResponse({saved:'2026-10-16T00:00:00Z',publishedFiles:2,noChanges:false,evidenceFastPath:true,stateHash:hash});
 assert.equal(publication.publishedFiles,2);
 assert.equal(publication.noChanges,false);
 assert.equal(publication.evidenceFastPath,true);
 assert.equal(publication.stateHash,hash);
 assert.deepEqual(decodeCachedMappingResponse({lastSystemId:'one',mappings:[]}),{lastSystemId:'one',mappings:[]});
 const mapping=decodeCachedMappingResponse({lastSystemId:'one',mappings:[{storageId:'storage-one',systemId:'one',folderName:'System One',manifest:{version:2},source:'local-cache',cachedAtUtc:'2026-10-16T00:00:00Z',stateHash:hash}]});
 assert.equal(mapping.mappings?.[0].folderName,'System One');
 assert.deepEqual(Object.keys(mapping.mappings?.[0]??{}).sort(),['cachedAtUtc','folderName','manifest','source','stateHash','storageId','systemId']);
 assert.deepEqual(decodeSelectedFolderResponse({cancelled:true}),{cancelled:true,folderName:undefined,manifest:undefined});
});

test('portable response contracts reject type confusion, control characters, bad hashes, and oversized arrays',()=>{
 assert.throws(()=>decodeLeaseAcquireResponse({acquired:'true'}),RuntimeDecodeError);
 assert.throws(()=>decodeLauncherControlResponse({activeStorageRequests:-1,longOperationActive:true}),RuntimeDecodeError);
 assert.throws(()=>decodeLauncherControlResponse({activeStorageRequests:1,longOperationActive:'yes'}),RuntimeDecodeError);
 assert.throws(()=>decodeEvidenceFilenameResponse({filename:'bad\nname.pdf'}),RuntimeDecodeError);
 assert.throws(()=>decodeStoredEvidenceResponse({filename:'A.zip',path:'A.zip',sha256:'not-a-hash'}),/SHA-256/);
 assert.throws(()=>decodeEvidenceStatusResponse({filename:'A.zip',path:'A.zip',sha256:hash}),/stored flag/);
 assert.throws(()=>decodeOrganizationList(new Array(1001).fill('Org')),RuntimeDecodeError);
 assert.throws(()=>decodeCachedMappingResponse({mappings:new Array(1001).fill({})}),/mappings list/);
 assert.throws(()=>decodeCachedMappingResponse({mappings:[{systemId:'one',folderName:'One',manifest:null}]}),RuntimeDecodeError);
 assert.throws(()=>decodeCachedMappingResponse({mappings:[{storageId:'s',systemId:'one',folderName:'One',manifest:null,stateHash:'bad'}]}),/state hash/);
 assert.throws(()=>decodeStorageVerificationResponse({saved:'now',backup:'now',filename:'x',auditEntries:-1,auditHeadHash:hash,manifestSha256:hash}),RuntimeDecodeError);
 assert.throws(()=>decodePublishResponse({saved:'now',completionErrors:new Array(10001).fill('x')}),RuntimeDecodeError);
 assert.throws(()=>decodePublishResponse({saved:'now',stateHash:'bad'}),/state hash/);
});

function random(seed:number){let state=seed>>>0;return()=>{state=(state+0x6D2B79F5)>>>0;let value=state;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return((value^(value>>>14))>>>0)/4294967296}}
function randomJson(next:()=>number,depth=0):unknown{
 const choice=Math.floor(next()*(depth>3?5:7));
 if(choice===0)return null;
 if(choice===1)return next()<.5;
 if(choice===2)return Math.floor((next()-.5)*Number.MAX_SAFE_INTEGER*2);
 if(choice===3)return String.fromCharCode(...Array.from({length:Math.floor(next()*24)},()=>Math.floor(next()*128)));
 if(choice===4)return next()<.2?undefined:`value-${Math.floor(next()*10000)}`;
 if(choice===5)return Array.from({length:Math.floor(next()*8)},()=>randomJson(next,depth+1));
 const record:Record<string,unknown>={};
 for(let index=0;index<Math.floor(next()*8);index++)record[`key${index}`]=randomJson(next,depth+1);
 return record;
}

test('all portable decoders fail deterministically and never hang on randomized JSON-shaped input',()=>{
 const decoders=[
  decodeLeaseAcquireResponse,decodeLeaseRenewResponse,decodeEvidenceFilenameResponse,decodeStoredEvidenceResponse,
  decodeEvidenceStatusResponse,decodeSelectedFolderResponse,decodeCachedMappingResponse,decodeLauncherControlResponse,
  decodeStorageVerificationResponse,decodePathMutationResponse('path','Path mutation'),decodeOrganizationList,
  decodeOrganizationResponse,decodeOperationReceipt,decodePublishResponse,
 ];
 const seed=0x52415054,next=random(seed);
 for(let caseIndex=0;caseIndex<2500;caseIndex++){
  const value=randomJson(next);
  for(const decoder of decoders){
   try{
    const decoded=decoder(value);
    assert.notEqual(decoded,undefined,`decoder returned undefined at seed ${seed}, case ${caseIndex}`);
   }catch(error){
    assert.ok(error instanceof Error,`non-Error throw at seed ${seed}, case ${caseIndex}`);
    assert.ok(error.message.length>0&&error.message.length<2000,`unbounded error at seed ${seed}, case ${caseIndex}`);
   }
  }
 }
});

test('JSON response decoding rejects malformed bodies without leaking parser details',async()=>{
 await assert.rejects(
  decodeJsonResponse(new Response('{not-json',{headers:{'content-type':'application/json'}}),'Manifest',value=>value),
  (error:unknown)=>error instanceof RuntimeDecodeError&&/valid JSON/.test(error.message),
 );
 await assert.rejects(
  decodeJsonResponse(new Response(JSON.stringify({value:'x'.repeat(100)})),'Bounded response',value=>value,32),
  (error:unknown)=>error instanceof RuntimeDecodeError&&/no larger than 32 bytes/.test(error.message),
 );
 await assert.rejects(
  decodeJsonResponse(new Response('{}',{headers:{'content-length':'999'}}),'Declared response',value=>value,32),
  (error:unknown)=>error instanceof RuntimeDecodeError&&/no larger than 32 bytes/.test(error.message),
 );
});
