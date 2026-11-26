'use client';

import {useEffect,useRef,useState} from 'react';
import type {ProcessingStatus} from './ProcessingPanel';
import {AccessibleModal} from './AccessibleModal';
import {recognitionAliasSnapshot,RecognitionAliasPanel,RenamerReviewCard} from './RenamerReview';
import {mapWithConcurrency} from '../concurrency-utils';
import {analyzeDocumentText,organizationFromFolderPath} from '../document-renamer-utils';
import {errorAuditAction,errorDetail} from '../error-utils';
import {inspectEvidenceBytes} from '../evidence-validation';
import type {SystemRecord,UserRecord} from '../domain/tracker-models';
import type {RenamerItem,RenamerPreview,RenamerStats,ScannedEvidence,StorageRoot} from '../tracker-workflow-types';
import {openPdfInReservedWindow,reservePdfPreviewWindow,showPdfPreviewWindowError} from '../application/pdf-preview-window';
import {aliasesFromReviewedItems} from '../application/recognition-alias-service';
import {renamerProposalState} from '../application/renamer-review-service';
import {appendAudits,currentActor,reportOperationalError,requireActiveLease,writeErrorReport} from '../storage-session';
import {clearRenamerQueue,readRenamerQueue,renamerBatchSize,renamerReadConcurrency,saveRenamerQueue,scanPathKey,warnAuditFailure,withStorageMutationTimeout} from '../system-storage';
import {normalizeEvidenceDate,readEvidencePayload} from '../evidence-storage';
import {uid} from '../page-helpers';
import {analyzeRenamerPdf,discoverRenamerPdfs} from '../renamer-analysis';

export function DocumentRenamerModal({system,users,root,onProcessing}:{system:SystemRecord;users:UserRecord[];root:StorageRoot;onProcessing:(status:ProcessingStatus)=>void}){
 const bridge=recognitionAliasSnapshot(),aliases=bridge.aliases.filter(alias=>alias.systemId===system.id),onAliasesChange=bridge.save;
 const[items,setItems]=useState<RenamerItem[]>([]),[loading,setLoading]=useState(true),[applying,setApplying]=useState(false),[message,setMessage]=useState(''),[stats,setStats]=useState<RenamerStats>({renamed:0,needsInput:0,collisions:0,skippedZips:0,skippedArchives:0}),[preview,setPreview]=useState<RenamerPreview|null>(null),pauseRequested=useRef(false),previewSequence=useRef(0);
 useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url)},[preview?.url]);
 const proposalState=renamerProposalState;
 async function renameBatch(source:RenamerItem[],automatic:boolean){
  const plan=proposalState(source),prepared=source.map(item=>automatic&&plan.duplicateIds.has(item.id)?{...item,selected:false}:item),eligible=prepared.filter(item=>{const target=plan.targets.get(item.id);return !!target&&target!==item.filename&&!plan.duplicateIds.has(item.id)&&(automatic?item.confidence==='High':item.selected)}),completed=new Set<string>(),patches=new Map<string,Partial<RenamerItem>>(),auditActions:string[]=[];let failures=0;
  if(!eligible.length)return{remaining:prepared,renamed:0,failures:0};
  await requireActiveLease(root);
  onProcessing({title:'Document Renamer',phase:automatic?'Automatically Renaming High-Confidence PDFs':'Renaming Selected PDFs',processed:0,total:eligible.length,unit:'files',state:'running'});
  for(const[index,item]of eligible.entries()){
   const target=plan.targets.get(item.id)!;
   try{
    const result=await withStorageMutationTimeout(`Renaming ${item.filename}`,()=>normalizeEvidenceDate(root,{id:item.id,path:item.path,filename:item.filename,ref:item.ref},target));
    if(result.collisionPath){failures++;const detail=`Collision: ${target} already exists. Neither file was changed.`;patches.set(item.id,{error:detail,selected:false});auditActions.push(errorAuditAction(`Document Renamer collision for ${item.path}.`,detail))}
    else{completed.add(item.id);auditActions.push(`RENAME PDF WITHOUT CONTENT CHANGE: ${item.path} renamed to ${result.path}; SHA-256 verified`)}
   }catch(error){failures++;const detail=errorDetail(error,'Rename failed; the original file remains unchanged.');patches.set(item.id,{error:`Rename failed; the original file remains unchanged. Details: ${detail}`,selected:false});auditActions.push(errorAuditAction(`Document Renamer rename failed for ${item.filename}.`,detail));await writeErrorReport(`Document Renamer rename failed for ${item.filename}.`,detail,system.id).catch(()=>undefined)}
   onProcessing({title:'Document Renamer',phase:automatic?'Automatically Renaming High-Confidence PDFs':'Renaming Selected PDFs',processed:index+1,total:eligible.length,unit:'files',state:'running',detail:`${item.filename} → ${target}`});
  }
  if(auditActions.length)warnAuditFailure(await appendAudits(auditActions,system.id));
  return{remaining:prepared.filter(item=>!completed.has(item.id)).map(item=>patches.has(item.id)?{...item,...patches.get(item.id)!}:item),renamed:completed.size,failures};
 }
 function reconcileMetadata(source:RenamerItem[],discovery:Awaited<ReturnType<typeof discoverRenamerPdfs>>){
  const freshByPath=new Map(discovery.items.map(item=>[scanPathKey(item.path),item])),known=new Set(source.map(item=>scanPathKey(item.path))),reconciled=source.map(item=>{const fresh=freshByPath.get(scanPathKey(item.path));return fresh?{...item,...fresh,ref:fresh.ref}:{...item,selected:false,error:'Metadata verification could not find this PDF at its analyzed location. Choose Analyze Again before taking action.'}});
  for(const fresh of discovery.items){if(known.has(scanPathKey(fresh.path)))continue;const folderOrganization=organizationFromFolderPath(fresh.path,root.name),analysis=analyzeDocumentText('',fresh.filename,users,folderOrganization,aliases);reconciled.push({...fresh,...analysis,organization:folderOrganization,selected:false,error:'Found during metadata verification. Choose Analyze Again to inspect this PDF.'})}
  return reconciled;
 }
 async function analyze(restart=false){
  pauseRequested.current=false;setLoading(true);setMessage('');setItems([]);setStats({renamed:0,needsInput:0,collisions:0,skippedZips:0,skippedArchives:0});onProcessing({title:'Document Renamer',phase:'Finding PDFs That Need Standard Names',processed:0,unit:'files',state:'running'});
  try{
   if(restart)await clearRenamerQueue(root);
   const discovery=await discoverRenamerPdfs(root,root.name),candidates=discovery.items,saved=restart?undefined:await readRenamerQueue(root,system.id),savedByPath=new Map((saved?.items??[]).map(item=>[scanPathKey(item.path),item])),next:RenamerItem[]=[],remaining:ScannedEvidence[]=[];
   for(const candidate of candidates){const cached=savedByPath.get(scanPathKey(candidate.path)),sameSource=cached&&cached.filename===candidate.filename&&cached.size===candidate.size&&cached.lastModifiedUnixMs===candidate.lastModifiedUnixMs;if(sameSource)next.push({...cached,ref:candidate.ref});else remaining.push(candidate)}
   setItems([...next]);onProcessing({title:'Document Renamer',phase:saved&&next.length?'Resuming Saved Analysis':'Reading Names and Signed Dates',processed:next.length,total:candidates.length,unit:'files',state:'running',detail:next.length?`${next.length} previously analyzed PDFs restored.`:undefined});
   for(let offset=0;offset<remaining.length;offset+=renamerBatchSize){
    if(pauseRequested.current){await saveRenamerQueue(root,system.id,next);setItems([...next]);setMessage(`Analysis paused after ${next.length} of ${candidates.length} PDFs. Reopen Document Renamer to resume.`);onProcessing({title:'Document Renamer',phase:'Analysis Paused and Saved',processed:next.length,total:candidates.length,unit:'files',state:'complete',detail:'The resumable queue is stored in the mapped system folder.'});return}
    const batch=remaining.slice(offset,offset+renamerBatchSize),processedBefore=next.length,analyzed=await mapWithConcurrency(batch,renamerReadConcurrency,candidate=>analyzeRenamerPdf(candidate,users,root.name,aliases),{onCompleted:(completed,total,index)=>onProcessing({title:'Document Renamer',phase:'Reading Names and Signed Dates',processed:processedBefore+completed,total:candidates.length,unit:'files',state:'running',detail:`Batch ${Math.floor(offset/renamerBatchSize)+1}: ${batch[index].filename}`})});next.push(...analyzed.map(result=>result.item));const failures=analyzed.filter(result=>!!result.auditDetail).map(result=>errorAuditAction(`Document Renamer PDF analysis skipped ${result.item.path}.`,result.auditDetail));if(failures.length)warnAuditFailure(await appendAudits(failures,system.id));await saveRenamerQueue(root,system.id,next);setItems([...next]);await new Promise(resolve=>window.setTimeout(resolve,0))
   }
   await clearRenamerQueue(root);
   const automatic=await renameBatch(next,true),verification=await discoverRenamerPdfs(root,root.name),review=reconcileMetadata(automatic.remaining,verification),reviewPlan=proposalState(review),collisions=reviewPlan.collisionIds.size,needsInput=Math.max(0,review.length-collisions);
   setItems(review);setStats({renamed:automatic.renamed,needsInput,collisions,skippedZips:verification.skippedZips,skippedArchives:verification.skippedArchives});
   const detail=candidates.length?`${automatic.renamed} high-confidence PDF${automatic.renamed===1?' was':'s were'} renamed automatically. ${needsInput} need operator input; ${collisions} have collisions.`:'No nonstandard loose PDF filenames were found in the active evidence folders.';
   setMessage(detail);onProcessing({title:'Document Renamer',phase:review.length?'Automatic Pass Complete — Operator Review Ready':'Automatic Renaming Complete',processed:candidates.length,total:candidates.length,unit:'files',state:'complete',detail});
  }catch(error){const reported=await reportOperationalError('Document Renamer analysis failed.',error,system.id,{fallback:'The PDFs could not be analyzed.'});setMessage(reported.message);onProcessing({title:'Document Renamer',phase:'Analysis Failed',processed:0,unit:'files',state:'error',detail:reported.message})}finally{setLoading(false)}
 }
 useEffect(()=>{queueMicrotask(()=>void analyze());return()=>{pauseRequested.current=true}},[]);// eslint-disable-line react-hooks/exhaustive-deps
 function update(id:string,change:Partial<RenamerItem>){setItems(current=>current.map(item=>item.id===id?{...item,...change}:item))}
 function applySimilar(source:RenamerItem){if(!source.normalizedPattern)return;setItems(current=>current.map(item=>item.normalizedPattern===source.normalizedPattern?{...item,last:source.last,first:source.first,organization:source.organization,kind:source.kind,date:source.date,role:source.role,privilegedType:source.privilegedType,selected:true}:item))}
 async function showPreview(item:RenamerItem){const sequence=++previewSequence.current,target=reservePdfPreviewWindow(item.filename);if(!target)setPreview({loading:true,filename:item.filename,path:item.path});try{const{bytes}=await readEvidencePayload(item.ref,undefined,30000,item.filename),inspected=inspectEvidenceBytes(item.filename,bytes),copy=new Uint8Array(inspected.pdfBytes.byteLength);copy.set(inspected.pdfBytes);const url=URL.createObjectURL(new Blob([copy],{type:'application/pdf'}));if(sequence!==previewSequence.current){URL.revokeObjectURL(url);return}if(target&&openPdfInReservedWindow(target,url)){setPreview(null);return}setPreview({loading:false,url,filename:item.filename,path:item.path})}catch(error){const reported=await reportOperationalError(`Document Renamer preview failed for ${item.filename}.`,error,system.id,{fallback:'The PDF preview could not be opened.'});if(sequence===previewSequence.current&&!showPdfPreviewWindowError(target,reported.message))setPreview({loading:false,filename:item.filename,path:item.path,error:reported.message})}}
 const plan=proposalState(items),ready=items.filter(item=>{const target=plan.targets.get(item.id);return item.selected&&!!target&&target!==item.filename&&!plan.duplicateIds.has(item.id)}),collisionItems=items.filter(item=>plan.collisionIds.has(item.id)),needsInputItems=items.filter(item=>!plan.collisionIds.has(item.id));
 async function applyReviewed(){
  if(!ready.length)return;setApplying(true);setMessage('');
  try{
   const result=await renameBatch(items,false),verification=await discoverRenamerPdfs(root,root.name),review=reconcileMetadata(result.remaining,verification),reviewPlan=proposalState(review),collisions=reviewPlan.collisionIds.size,needsInput=Math.max(0,review.length-collisions),detail=`${result.renamed} selected PDF${result.renamed===1?' was':'s were'} renamed and SHA-256 verified${result.failures?`; ${result.failures} remained unchanged for review`:''}.`;
   const approvedAliases=aliasesFromReviewedItems(bridge.aliases,ready.map(item=>({...item,targetFilename:plan.targets.get(item.id)})),{systemId:system.id,operator:currentActor(),atUtc:new Date().toISOString(),id:uid});if(approvedAliases.approved)await onAliasesChange(approvedAliases.aliases,`RECOGNITION ALIAS APPROVED: ${approvedAliases.approved} reviewed filename pattern${approvedAliases.approved===1?'':'s'}; future matches remain subject to the strict filename storage gate`);
   setItems(review);setStats(current=>({renamed:current.renamed+result.renamed,needsInput,collisions,skippedZips:verification.skippedZips,skippedArchives:verification.skippedArchives}));setMessage(detail);onProcessing({title:'Document Renamer',phase:review.length?'Rename Complete — Review Items Remain':'Rename Complete',processed:ready.length,total:ready.length,unit:'files',state:'complete',detail});
  }catch(error){const reported=await reportOperationalError('Document Renamer rename pass failed.',error,system.id,{fallback:'The selected PDFs could not be renamed.'});setMessage(reported.message);onProcessing({title:'Document Renamer',phase:'Rename Pass Failed',processed:0,total:ready.length,unit:'files',state:'error',detail:reported.message})}finally{setApplying(false)}
 }
 function renderRenamerItem(item:RenamerItem){
  const target=plan.targets.get(item.id),duplicate=plan.duplicateIds.has(item.id);
  const similarCount=item.normalizedPattern?items.filter(value=>value.normalizedPattern===item.normalizedPattern).length:0;return <RenamerReviewCard key={item.id} item={item} target={target} duplicate={duplicate} applying={applying} similarCount={similarCount} onUpdate={change=>update(item.id,change)} onApplySimilar={()=>applySimilar(item)} onPreview={()=>void showPreview(item)}/>
 }
 return <><p className="eyebrow">Local Batch Preparation</p><h2>Document Renamer</h2><p className="hint">The first pass reads only loose PDFs that do not already have valid tracker names. Unique high-confidence results are renamed automatically. A second metadata-only pass verifies the current locations without reopening document contents. PDF bytes are never rewritten; every rename is SHA-256 verified and audited.</p>
  <RecognitionAliasPanel/>
  <div className="renamer-summary"><strong>{loading?'Analyzing PDFs…':`${items.length} PDF${items.length===1?'':'s'} Need Review`}</strong><span>{ready.length} selected and ready</span>{loading?<button onClick={()=>{pauseRequested.current=true}}>Pause Analysis</button>:<button disabled={applying} onClick={()=>void analyze(true)}>Analyze Again</button>}<div className="renamer-stats"><span><b>{stats.renamed}</b> Renamed</span><span><b>{needsInputItems.length}</b> Need Input</span><span><b>{collisionItems.length}</b> Collisions</span><span><b>{stats.skippedZips}</b> ZIPs Skipped</span><span><b>{stats.skippedArchives}</b> Archive Trees Excluded</span></div></div>
  {message&&<p className="renamer-message">{message}</p>}
  <div className="renamer-list">{collisionItems.length>0&&<section className="renamer-group"><h3>Collisions <span>{collisionItems.length}</span></h3><p>These PDFs propose the same target name or a target file already exists. Review them individually.</p>{collisionItems.map(renderRenamerItem)}</section>}{needsInputItems.length>0&&<section className="renamer-group"><h3>Needs Operator Input <span>{needsInputItems.length}</span></h3><p>Complete or correct the fields, preview when needed, select the rows, and apply the reviewed names.</p>{needsInputItems.map(renderRenamerItem)}</section>}{!loading&&!items.length&&<div className="empty">No PDFs currently need renaming.</div>}</div>
  {preview&&<AccessibleModal label={`${preview.filename} Preview`} onClose={()=>{previewSequence.current++;setPreview(null)}} backdropClassName="renamer-preview-overlay" contentClassName="renamer-preview-dialog" showClose={false}><div className="renamer-preview-heading"><div><strong>{preview.filename}</strong><small>{preview.path}</small></div><button onClick={()=>{previewSequence.current++;setPreview(null)}}>Close Preview</button></div>{preview.loading&&<div className="empty">Opening and validating PDF…</div>}{preview.error&&<p className="restore-warning"><b>Preview Unavailable:</b> {preview.error}</p>}{preview.url&&<><iframe className="evidence-frame" title={`${preview.filename} preview`} src={`${preview.url}#zoom=page-width`}/><div className="evidence-preview-actions"><a className="download-link" href={preview.url} target="_blank" rel="noopener noreferrer">Open Full-Size PDF</a><a className="download-link" href={preview.url} download={preview.filename}>Download Validated PDF Copy</a></div></>}</AccessibleModal>}
  <button className="primary full" disabled={loading||applying||!ready.length} onClick={()=>void applyReviewed()}>{applying?'Renaming and Verifying…':`Rename ${ready.length} Selected PDF${ready.length===1?'':'s'}`}</button>
 </>
}
