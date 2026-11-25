import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {canonicalJson,decodeSavedReconciliation,decodeSavedSyncReview,lastResultExpired,lastResultsMaxAgeMs,lastResultsNotice,readLastResults,recordsFingerprint,restoredSyncReview,savedReconciliation,savedSyncReview,syncReviewItemCount} from '../app/application/last-results.ts';
import type {PendingSync} from '../app/tracker-workflow-types.ts';
import type {SystemRecord,UserRecord} from '../app/domain/tracker-models.ts';

const hash=async(text:string)=>createHash('sha256').update(text).digest('hex');
const root={kind:'portable' as const,systemId:'storage-1',name:'Mapped'};
const ref=(path:string)=>({kind:'portable' as const,systemId:'storage-1',path,name:path.split('/').pop()!});
const system={id:'sys-1',name:'Synthetic System'} as unknown as SystemRecord;
const user=(id:string,last:string)=>({id,systemId:'sys-1',last,first:'Test',artifacts:[]}) as unknown as UserRecord;
const now='2026-11-25T14:00:00.000Z';

function review(overrides:Partial<PendingSync>={}):PendingSync{
 return{baseSaveGeneration:4,systemId:'sys-1',handle:root,mode:'daily',fullRescan:false,syncRunIds:['11111111-1111-1111-1111-111111111111'],scanned:120,unchanged:100,validated:20,ignored:0,scanDurationMs:900,systems:[system],users:[user('u1','Alpha')],evidence:[{id:'e1',path:'Organizations/ORG/a.pdf',filename:'a.pdf',ref:ref('Organizations/ORG/a.pdf')}],externalSharedAdditions:[],candidates:[{id:'c1',userId:'u1',kind:'SAAR',filename:'a.pdf',path:'Organizations/ORG/a.pdf',status:'Active'}],archiveCandidates:[],zipCandidates:[{id:'z1',filename:'b.pdf',path:'Organizations/ORG/b.pdf',ref:ref('Organizations/ORG/b.pdf')}],reworkCandidates:[],collisionCandidates:[],newUsers:[],disabledStatusUpdates:[],reactivationCandidates:[],unmatched:[],rejected:[{filename:'bad.pdf',reason:'Unreadable'}],contentDuplicates:[],identityConflicts:[],...overrides} as PendingSync;
}

test('a saved Sync review drops the live storage handle and session generation, and round-trips through JSON',()=>{
 const saved=savedSyncReview(review(),'a'.repeat(64),'Operator One',now),wire=JSON.parse(JSON.stringify(saved));
 assert.equal('handle' in saved.review,false);
 assert.equal('baseSaveGeneration' in saved.review,false);
 const decoded=decodeSavedSyncReview(wire,'sys-1','storage-1');
 assert.ok(decoded);
 const restored=restoredSyncReview(decoded,root,9);
 assert.equal(restored.handle,root);
 assert.equal(restored.baseSaveGeneration,9);
 assert.equal(restored.candidates.length,1);
 assert.equal(syncReviewItemCount(decoded.review),2);
});

test('saved Sync reviews are rejected for another system, another storage root, or a malformed body',()=>{
 const wire=JSON.parse(JSON.stringify(savedSyncReview(review(),'a'.repeat(64),'Operator One',now)));
 assert.equal(decodeSavedSyncReview(wire,'sys-2','storage-1'),null);
 assert.equal(decodeSavedSyncReview(wire,'sys-1','storage-2'),null,'evidence references must point into the current storage root');
 assert.equal(decodeSavedSyncReview({...wire,baseStateHash:'nope'},'sys-1','storage-1'),null);
 assert.equal(decodeSavedSyncReview({...wire,review:{...wire.review,candidates:'x'}},'sys-1','storage-1'),null);
 assert.equal(decodeSavedSyncReview({...wire,review:{...wire.review,users:[{...wire.review.users[0],systemId:'sys-2'}]}},'sys-1','storage-1'),null,'a review cannot carry another system\'s users');
 const browserRef={...wire,review:{...wire.review,zipCandidates:[{id:'z1',filename:'b.pdf',path:'b.pdf',ref:{kind:'browser',path:'b.pdf',name:'b.pdf'}}]}};
 assert.equal(decodeSavedSyncReview(browserRef,'sys-1','storage-1'),null);
 assert.equal(decodeSavedSyncReview({...wire,kind:'reconciliation'},'sys-1','storage-1'),null);
});

test('saved Reconciliation results validate every issue',()=>{
 const issues=[{id:'i1',category:'File Collision' as const,severity:'High' as const,summary:'Two files',detail:'Detail',path:'Organizations/ORG/a.pdf'}];
 const wire=JSON.parse(JSON.stringify(savedReconciliation('sys-1',issues,50,'Operator One',now)));
 assert.equal(decodeSavedReconciliation(wire,'sys-1')?.issues.length,1);
 assert.equal(decodeSavedReconciliation(wire,'sys-2'),null);
 assert.equal(decodeSavedReconciliation({...wire,issues:[{...issues[0],category:'Made Up'}]},'sys-1'),null);
 assert.equal(decodeSavedReconciliation({...wire,issues:[{...issues[0],severity:'Low'}]},'sys-1'),null);
 assert.equal(decodeSavedReconciliation({...wire,scanned:-1},'sys-1'),null);
});

test('saved results expire after seven days and reject future timestamps',()=>{
 const saved=Date.parse(now);
 assert.equal(lastResultExpired(now,saved+lastResultsMaxAgeMs-1000),false);
 assert.equal(lastResultExpired(now,saved+lastResultsMaxAgeMs+1000),true);
 assert.equal(lastResultExpired(now,saved-60*60*1000),true);
 assert.equal(lastResultExpired('not a date',saved),true);
});

test('the records fingerprint ignores key order and undefined fields but sees every real change',async()=>{
 const a=[user('u2','Beta'),user('u1','Alpha')],reordered=[{first:'Test',last:'Alpha',artifacts:[],systemId:'sys-1',id:'u1',note:undefined},{artifacts:[],first:'Test',id:'u2',last:'Beta',systemId:'sys-1'}] as unknown as UserRecord[];
 const base=await recordsFingerprint([system],a,[],'sys-1',hash);
 assert.equal(await recordsFingerprint([system],reordered,[],'sys-1',hash),base);
 assert.equal(await recordsFingerprint([system],[...a,{...user('x','Other'),systemId:'sys-2'}],[],'sys-1',hash),base,'other systems do not affect the fingerprint');
 assert.notEqual(await recordsFingerprint([system],[user('u2','Beta'),user('u1','Alpha-Changed')],[],'sys-1',hash),base);
 assert.equal(canonicalJson({b:1,a:[undefined,{d:2,c:undefined}]}),'{"a":[null,{"d":2}],"b":1}');
});

test('the logon notice names each saved result and flags a summary-only Sync review',()=>{
 const sync=savedSyncReview(review({fullRescan:true}),'a'.repeat(64),'Operator One',now),reconciliation=savedReconciliation('sys-1',[],10,'Operator One',now);
 assert.match(lastResultsNotice({sync,reconciliation},true),/Full Scan Review from .*\(2 items\); Reconciliation from .*\(0 issues\)\. Open them from Reports & Oversight, Last Results\./);
 assert.match(lastResultsNotice({sync,reconciliation:null},false),/summary only because records changed/);
 assert.equal(lastResultsNotice({sync:null,reconciliation:null},true),'');
});

test('reading saved results discards invalid or expired copies from the launcher',async()=>{
 const calls:string[]=[],old=savedReconciliation('sys-1',[],10,'Operator One','2026-11-01T00:00:00.000Z');
 const request=async(action:string,init?:RequestInit)=>{calls.push(`${init?.method??'GET'} ${action}`);return new Response(JSON.stringify({sync:{version:1,kind:'sync'},reconciliation:old}))};
 const result=await readLastResults(request,'sys-1','storage-1',Date.parse(now));
 assert.deepEqual(result,{sync:null,reconciliation:null});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(calls.sort(),['DELETE last-results?kind=reconciliation','DELETE last-results?kind=sync','GET last-results']);
});

test('the page saves, restores, and clears last results at each Sync and Reconciliation step',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/setPendingSync\(review\);rememberSyncReview\(sourceSystem\.id,review,baseSystems,baseUsers\);/,'a new review is saved with the records it was built from');
 assert.match(page,/rememberSyncReview\(pendingSync\.systemId,remainingSync,pendingSync\.systems,nextUsers\);/,'a partial apply saves what remains, or clears it when nothing remains');
 assert.match(page,/setPendingSync\(null\);rememberSyncReview\(systemId,null\);/,'starting another Sync clears the saved review');
 assert.match(page,/setPendingSync\(null\);rememberSyncReview\(pendingSync\.systemId,null\);/,'a stale review is cleared');
 assert.match(page,/recordsFingerprint\(systems,users,recognitionAliases,systemId,sha256Hex\)===saved\.sync\.baseStateHash/,'a saved review is reopened for action only while the records match');
 assert.match(page,/restoredSyncReview\(saved\.sync,root,saveGenerations\.current\(systemId\)\)/);
 assert.match(page,/savedReconciliation\(effectiveSelected,issues,result\.scanned,currentActor\(\)\)/);
 assert.match(page,/setReconciliationSavedAt\(saved\.savedAtUtc\)/);
});

test('the launcher stores last results in the protected local workspace with bounded requests',()=>{
 const program=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8'),policy=readFileSync(new URL('../portable-launcher/LauncherPolicy.cs',import.meta.url),'utf8'),store=readFileSync(new URL('../portable-launcher/PortableLastResults.cs',import.meta.url),'utf8');
 assert.match(program,/action == "last-results" && \(parts\[0\] == "GET" \|\| parts\[0\] == "POST" \|\| parts\[0\] == "DELETE"\)/);
 assert.match(policy,/if \(action == "last-results"\) return 50L \* MiB;/);
 assert.match(store,/WriteProtectedLocalJson\(LastResultPath\(LocalWorkspaceRoot\(systemId\), kind\)/);
 assert.doesNotMatch(store,/Root\(systemId\)\s*,\s*"last-results/,'saved results never go to the shared folder');
 for(const script of ['../scripts/build-portable.ps1','../scripts/Test-PortableStorage.ps1'])assert.match(readFileSync(new URL(script,import.meta.url),'utf8'),/PortableLastResults\.cs/);
});
