import test from 'node:test';
import assert from 'node:assert/strict';
import {activeComplianceException,applySyncArtifactProvenance,committedRecordWithExceptions,duplicateContentGroups,evidenceAssociationMatchesTransfer,evidenceBelongsToUserArchiveScope,newestSaarAccountState,notificationRecipientBatches,proposedNewUserArtifacts,reconcileEvidence,requiresSaarFormClassification,reworkRetentionDisposition,type SyncProvenanceUser} from '../app/workflow-utils.ts';
import {verifySyncProvenance} from '../app/provenance-utils.ts';

test('records stale provenance references per file while completing the rest of the batch',async()=>{
 const targets=[{user:{last:'Brown',first:'Jacob'},artifact:{filename:'Brown_Jacob_(GOV)_GEN_SAAR_26AUG2026.pdf.zip'}},{user:{last:'Shaw',first:'Vivian'},artifact:{filename:'Shaw_Vivian_(LM)_DoD_Cyber_Cert_26AUG2026.pdf.zip'}}],evidence=targets.map((target,index)=>({filename:target.artifact.filename,path:`current/${index}.zip`,stale:index===0}));
 const result=await verifySyncProvenance(targets,evidence,async item=>{if(item.stale)throw new Error('The selected evidence file no longer exists.');return'b'.repeat(64)}, {concurrency:2});
 assert.equal(result.failures.length,1);assert.match(result.failures[0].error,/no longer exists/i);assert.equal(result.verified.length,1);assert.equal(result.verified[0].evidence.path,'current/1.zip');
 const retry=await verifySyncProvenance(result.failures.map(item=>item.target),[{...evidence[0],path:'refreshed/0.zip',stale:false}],async()=> 'a'.repeat(64));
 assert.equal(retry.failures.length,0);assert.equal(retry.verified[0].evidence.path,'refreshed/0.zip');
});

test('resolves a bulk loose-PDF to verified-ZIP transition and records the refreshed path',async()=>{
 const users:(SyncProvenanceUser&{organization:string})[]=Array.from({length:51},(_,index)=>({id:`u${index}`,last:`Last${index}`,first:`First${index}`,organization:'GDMS',artifacts:[{kind:'DoD Cyber Cert',filename:`Last${index}_First${index}_(GDMS)_DoD_Cyber_Cert_26AUG2026.pdf`}]})),targets=users.map(user=>({user,artifact:user.artifacts[0]!})),evidence=users.map(user=>({filename:`${user.artifacts[0]!.filename}.zip`,path:`GDMS/DoD Cyber Cert/${user.artifacts[0]!.filename}.zip`,folderOrganization:'GDMS',sha256:'a'.repeat(64)}));
 const verified=await verifySyncProvenance(targets,evidence,async item=>item.sha256,{concurrency:4});
 assert.equal(verified.failures.length,0);assert.equal(verified.verified.length,51);
 const applied=applySyncArtifactProvenance(users,new Set(users.map(user=>`${user.id}:DoD Cyber Cert`)),verified.verified.map(item=>item.evidence),'2026-09-03T12:00:00.000Z','DOMAIN\\operator');
 assert.ok(applied.every((user,index)=>user.artifacts[0]!.filename===evidence[index]!.filename&&user.artifacts[0]!.path===evidence[index]!.path&&user.artifacts[0]!.sha256==='a'.repeat(64)));
});

test('does not guess provenance when more than one current file matches the same user and artifact',async()=>{
 const target={user:{last:'Brown',first:'Jacob',organization:'LM'},artifact:{kind:'DoD Cyber Cert',filename:'Brown_Jacob_(LM)_old-name.pdf'}},evidence=[
  {filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_25AUG2026.pdf.zip',path:'LM/DoD Cyber Cert/one.zip',folderOrganization:'LM'},
  {filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf.zip',path:'LM/DoD Cyber Cert/two.zip',folderOrganization:'LM'},
 ];
 const result=await verifySyncProvenance([target],evidence,async()=> 'a'.repeat(64));
 assert.equal(result.verified.length,0);assert.match(result.failures[0].error,/Multiple current DoD Cyber Cert files/);
});

test('groups exact duplicate PDF content hashes without trusting filenames',()=>{
 const same='a'.repeat(64),groups=duplicateContentGroups([{filename:'one.pdf',path:'GOV/one.pdf',sha256:same},{filename:'different-name.pdf.zip',path:'GOV/different-name.pdf.zip',sha256:same.toUpperCase()},{filename:'unique.pdf',path:'GOV/unique.pdf',sha256:'b'.repeat(64)},{filename:'invalid.pdf',path:'GOV/invalid.pdf',sha256:'not-a-hash'}]);
 assert.deepEqual(groups,[{sha256:same,files:[{filename:'different-name.pdf.zip',path:'GOV/different-name.pdf.zip'},{filename:'one.pdf',path:'GOV/one.pdf'}]}]);
});

test('classifies only loose SAAR PDFs and never reopens accepted ZIP evidence',()=>{
 assert.equal(requiresSaarFormClassification('Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf'),true);
 assert.equal(requiresSaarFormClassification('Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.PDF'),true);
 assert.equal(requiresSaarFormClassification('Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf.zip'),false);
 assert.equal(requiresSaarFormClassification('Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.ZIP'),false);
 assert.equal(requiresSaarFormClassification('Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf'),false);
});

test('returns only an active, unrevoked compliance exception',()=>{
 const exceptions=[{id:'old',artifact:'8140 Cert Memo',reason:'old',approvedBy:'A',createdAt:'2026-01-01T00:00:00Z',createdBy:'B',expiresOn:'2026-01-31'},{id:'active',artifact:'8140 Cert Memo',reason:'temporary',approvedBy:'A',createdAt:'2026-08-01T00:00:00Z',createdBy:'B',expiresOn:'2026-09-30'}];
 assert.equal(activeComplianceException(exceptions,'8140 Cert Memo',new Date('2026-08-28T12:00:00Z'))?.id,'active');
 assert.equal(activeComplianceException(exceptions,'SAAR',new Date('2026-08-28T12:00:00Z')),undefined);
});

test('archives obsolete Rework evidence without expiring SAARs',()=>{
 const asOf=new Date('2026-09-01T12:00:00Z');
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_DoD_Cyber_Cert_31AUG2025.pdf',asOf),'Archive');
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_User_Agreement_31AUG2020.pdf.zip',asOf),'Superseded');
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_GEN_SAAR_31AUG2019.pdf',asOf),undefined);
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_GENSAAR_31AUG2019.pdf',asOf),undefined);
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_DoD_Cyber_Cert_01SEP2025.pdf',asOf),undefined);
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_DoD_Cyber_Cert_NO_DATE.pdf',asOf),undefined);
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_DoD_Cyber_Cert_2024.pdf',asOf),'Archive');
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_User_Agreement_2020.pdf.zip',asOf),'Superseded');
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_DoD_Cyber_Cert_2025.pdf',asOf),undefined);
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_GEN_SAAR_2018.pdf',asOf),undefined);
 assert.equal(reworkRetentionDisposition('Brown_Jacob_(LM)_8140_Memo.pdf',asOf),undefined);
});

test('deduplicates and splits notification recipients by count and encoded length',()=>{
 assert.deepEqual(notificationRecipientBatches(['A@example.mil','a@example.mil','b@example.mil'],1),[['a@example.mil'],['b@example.mil']]);
 assert.deepEqual(notificationRecipientBatches(['one@example.mil','two@example.mil'],40,20),[['one@example.mil'],['two@example.mil']]);
});

test('commits exception changes without leaking unrelated draft edits',()=>{
 const committed={id:'u1',roles:['General'],exceptions:[]},draft={...committed,roles:['Privileged']},exception={id:'e1',artifact:'DoD Cyber Cert',reason:'temporary',approvedBy:'AO',createdAt:'2026-08-28T12:00:00Z',createdBy:'operator',expiresOn:'2026-09-30'};
 const updated=committedRecordWithExceptions(committed,[exception]);
 assert.deepEqual(updated.roles,['General']);assert.deepEqual(updated.exceptions,[exception]);assert.deepEqual(draft.roles,['Privileged']);
});

test('scopes delete-user archiving to the matching identity and authoritative organization',()=>{
 const user={last:'Brown',first:'Jacob',organization:'GDMS'};
 assert.equal(evidenceBelongsToUserArchiveScope({filename:'Brown_Jacob_(WRONG)_DoD_Cyber_Cert_26AUG2026.pdf.zip',folderOrganization:'GDMS'},user),true);
 assert.equal(evidenceBelongsToUserArchiveScope({filename:'Brown_Jacob_(GDMS)_User_Agreement_26AUG2026.pdf.zip',folderOrganization:'NGC'},user),false);
 assert.equal(evidenceBelongsToUserArchiveScope({filename:'Brown_Jane_(GDMS)_User_Agreement_26AUG2026.pdf.zip',folderOrganization:'GDMS'},user),false);
});

test('transfers only the same evidence association to the selected profile',()=>{
 const target={last:'Brown',first:'Jacob'},hash='a'.repeat(64),incoming={kind:'DoD Cyber Cert',filename:'Brown_Jacob_(GDMS)_DoD_Cyber_Cert_26AUG2026.pdf.zip',sha256:hash,path:'User Evidence/GDMS/Brown_Jacob/current.zip'};
 assert.equal(evidenceAssociationMatchesTransfer({kind:'DoD Cyber Cert',filename:'incorrect-owner-file.zip',sha256:hash},incoming,target),true);
 assert.equal(evidenceAssociationMatchesTransfer({kind:'DoD Cyber Cert',filename:incoming.filename},incoming,target),true);
 assert.equal(evidenceAssociationMatchesTransfer({kind:'User Agreement',filename:incoming.filename,sha256:hash},incoming,target),false);
 assert.equal(evidenceAssociationMatchesTransfer({kind:'DoD Cyber Cert',filename:'Smith_Jane_(GDMS)_DoD_Cyber_Cert_26AUG2026.pdf.zip'},incoming,target),false);
});

test('adds provenance only to Sync-touched artifacts',()=>{
 const users=[{id:'u1',last:'Brown',first:'Jacob',artifacts:[{kind:'SAAR',filename:'Brown_Jacob_(GOV)_GEN_SAAR_26AUG2026.pdf.zip'},{kind:'DoD Cyber Cert',filename:'Brown_Jacob_(GOV)_DoD_Cyber_Cert_26AUG2026.pdf.zip'}]}],hash='a'.repeat(64),storedAt='2026-08-28T12:00:00Z';
 const updated=applySyncArtifactProvenance(users,new Set(['u1:SAAR']),[{filename:users[0].artifacts[0].filename,path:'User Evidence/GOV/Brown_Jacob/saar.zip',sha256:hash}],storedAt,'operator');
 assert.deepEqual(updated[0].artifacts[0],{...users[0].artifacts[0],sha256:hash,path:'User Evidence/GOV/Brown_Jacob/saar.zip',storedAt,storedBy:'operator',source:'Sync'});assert.deepEqual(updated[0].artifacts[1],users[0].artifacts[1]);
});

test('seeds a new user from the SAAR before matching supporting evidence',()=>{
 const saar='Brown_Jacob_(GDMS)_GENSAAR_26AUG2026.pdf',files=[
  saar,
  'Brown_Jacob_(GDMS)_DoDCyberCert_26AUG2026.pdf',
  'Brown_Jacob_(GDMS)_GENUserAgreement_26AUG2026.pdf',
  'Someone_Else_(GDMS)_DoDCyberCert_26AUG2026.pdf',
 ];
 assert.deepEqual(proposedNewUserArtifacts(files,{last:'Brown',first:'Jacob'},['SAAR','DoD Cyber Cert','User Agreement'],saar),[
  {kind:'SAAR',filename:saar},
  {kind:'DoD Cyber Cert',filename:'Brown_Jacob_(GDMS)_DoDCyberCert_26AUG2026.pdf'},
  {kind:'User Agreement',filename:'Brown_Jacob_(GDMS)_GENUserAgreement_26AUG2026.pdf'},
 ]);
});

test('never attaches an archive-only disabled SAAR to a new user',()=>{
 const saar='Brown_Jacob_(GDMS)_GEN_SAAR_DISABLED_26AUG2026.pdf';
 assert.deepEqual(proposedNewUserArtifacts([saar],{last:'Brown',first:'Jacob',organization:'GDMS'},['SAAR'],saar),[]);
});

test('uses the newest dated SAAR to determine a disabled account state',()=>{
 const olderDisabled='Brown_Jacob_(GDMS)_GEN_SAAR_25AUG2026_DISABLED.pdf.zip',newerActive='Brown_Jacob_(GDMS)_GEN_SAAR_26AUG2026.pdf.zip',newerDisabled='Brown_Jacob_(GDMS)_GEN_SAAR_27AUG2026_DISABLED.pdf.zip';
 assert.deepEqual(newestSaarAccountState([olderDisabled,newerActive]),{filename:newerActive,date:new Date('2026-08-26T00:00:00.000Z'),disabled:false});
 assert.deepEqual(newestSaarAccountState([newerActive,newerDisabled]),{filename:newerDisabled,date:new Date('2026-08-27T00:00:00.000Z'),disabled:true});
 assert.equal(newestSaarAccountState(['Brown_Jacob_(GDMS)_User_Agreement_28AUG2026.pdf.zip']),undefined);
});

test('gives a same-day disabled SAAR precedence over an active copy',()=>{
 const active='Brown_Jacob_(GDMS)_GEN_SAAR_26AUG2026.pdf.zip',disabled='Brown_Jacob_(GDMS)_GEN_SAAR_26AUG2026_DISABLED.pdf.zip';
 assert.equal(newestSaarAccountState([active,disabled])?.filename,disabled);
});

test('scopes supporting evidence for a new SAAR user to the same organization',()=>{
 const saar='Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf',files=[saar,'Brown_Jacob_(GOV)_DoD_Cyber_Cert_30AUG2026.pdf','Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf'];
 assert.deepEqual(proposedNewUserArtifacts(files,{last:'Brown',first:'Jacob',organization:'LM'},['SAAR','DoD Cyber Cert'],saar),[
  {kind:'SAAR',filename:saar},
  {kind:'DoD Cyber Cert',filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf'},
 ]);
});

test('treats the containing organization folder as authoritative during reconciliation',()=>{
 const users=[{id:'u1',last:'Brown',first:'Jacob',email:'jacob@example.invalid',organization:'GDMS',artifacts:[]}];
 const issues=reconcileEvidence(users,[{filename:'Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf',path:'GDMS/Brown_Jacob/file.pdf',folderOrganization:'GDMS'}],[]);
 assert.ok(issues.some(issue=>issue.id.startsWith('folder-organization:')&&issue.detail.includes('GDMS')));
 assert.ok(!issues.some(issue=>issue.id.startsWith('organization:u1:')));
});

test('reconciles missing, orphaned, conflicting, duplicate, and rejected evidence',()=>{
 const users=[{id:'u1',last:'Brown',first:'Jacob',email:'shared@example.mil',organization:'LM',artifacts:[{kind:'SAAR',filename:'Brown_Jacob_(LM)_GEN_SAAR_26AUG2026.pdf.zip'}]},{id:'u2',last:'Brown',first:'Jacob',email:'shared@example.mil',organization:'GOV',artifacts:[{kind:'DoD Cyber Cert',filename:'Brown_Jacob_(GOV)_DoD_Cyber_Cert_26AUG2026.pdf.zip',sha256:'a'.repeat(64)}]}];
 const evidence=[{filename:'Brown_Jacob_(GOV)_DoD_Cyber_Cert_26AUG2026.pdf.zip',path:'User Evidence/GOV/Brown_Jacob/cert.zip',sha256:'b'.repeat(64)},{filename:'Smith_Jill_(LM)_GEN_SAAR_26AUG2026.pdf.zip',path:'User Evidence/LM/Smith_Jill/file.zip'}];
 const issues=reconcileEvidence(users,evidence,[{filename:'bad.pdf',reason:'Unreadable',path:'bad.pdf'}]);
 assert.ok(issues.some(issue=>issue.category==='Missing File'));assert.ok(issues.some(issue=>issue.category==='Content Changed'));assert.ok(issues.some(issue=>issue.category==='Orphan Evidence'));assert.ok(issues.some(issue=>issue.category==='Organization Conflict'));assert.ok(issues.some(issue=>issue.category==='Duplicate Identity'));assert.ok(issues.some(issue=>issue.category==='Duplicate Email'));assert.ok(issues.some(issue=>issue.category==='Rejected Evidence'));
});
