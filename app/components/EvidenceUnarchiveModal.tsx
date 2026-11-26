'use client';

import {useState} from 'react';
import type {ProcessingStatus} from './ProcessingPanel';
import {runEvidenceMoveBatches} from '../application/evidence-move-batch';
import {errorAuditAction,errorDetail} from '../error-utils';
import {paginateItems} from '../pagination-utils';
import type {SystemRecord} from '../domain/tracker-models';
import type {StorageRoot,UnarchiveCandidate} from '../tracker-workflow-types';
import {appendAudits,isPortableRoot,portableRequest,reportOperationalError,requireActiveLease,writeErrorReport} from '../storage-session';
import {warnAuditFailure} from '../system-storage';
import {unarchiveEvidenceBatch} from '../evidence-storage';
import {CleanupPagination} from './CleanupPagination';

export function EvidenceUnarchiveModal({system,root,onProcessing}:{system:SystemRecord;root:StorageRoot;onProcessing:(status:ProcessingStatus)=>void}){
 const[items,setItems]=useState<UnarchiveCandidate[]>([]),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const paged=paginateItems(items,Math.min(page,Math.max(0,Math.ceil(items.length/20)-1))),selected=items.filter(item=>item.selected);
 async function choose(action:'unarchive-select-folder'|'unarchive-select-files'){
  if(!isPortableRoot(root)){setMessage('Native folder and multi-file selection requires the portable Windows launcher.');return}
  setBusy(true);setMessage('');
  try{await requireActiveLease(root);const response=await portableRequest(root,action,{method:'POST'}),result=await response.json() as{cancelled?:boolean;items?:Omit<UnarchiveCandidate,'selected'|'error'>[]};if(result.cancelled){setMessage('Selection cancelled.');return}const candidates=(result.items??[]).map(item=>({...item,selected:true}));setItems(candidates);setPage(0);setMessage(candidates.length?`${candidates.length} ZIP file${candidates.length===1?'':'s'} selected for review.`:'No ZIP evidence was found in the selected location.')}
  catch(error){const reported=await reportOperationalError('Unarchive selection failed.',error,system.id,{fallback:'The selected ZIP evidence could not be listed.'});setMessage(reported.message)}finally{setBusy(false)}
 }
 function selectPage(value:boolean){const paths=new Set(paged.items.map(item=>item.path));setItems(current=>current.map(item=>paths.has(item.path)?{...item,selected:value}:item))}
 async function apply(){
  if(!isPortableRoot(root)||!selected.length)return;setBusy(true);setMessage('');const completed=new Set<string>(),audits:string[]=[],failures:{item:UnarchiveCandidate;detail:string}[]=[];
  onProcessing({title:'Unarchive Evidence',phase:'Extracting Selected ZIP Evidence',processed:0,total:selected.length,unit:'files',state:'running'});
  await runEvidenceMoveBatches(selected,batch=>unarchiveEvidenceBatch(root,batch.map(item=>item.path)),async(item,outcome,index)=>{
   try{if(!outcome.ok)throw outcome.error;const result=outcome.value;completed.add(item.path);audits.push(`UNARCHIVE EVIDENCE: ${item.path} extracted to ${result.unarchived}; source ZIP preserved after one-PDF validation and SHA-256 verification`)}
   catch(error){const detail=errorDetail(error,'The ZIP could not be safely extracted.');failures.push({item,detail});audits.push(errorAuditAction(`Unarchive failed for ${item.path}.`,detail));await writeErrorReport(`Unarchive failed for ${item.filename}.`,detail,system.id).catch(()=>undefined)}
   onProcessing({title:'Unarchive Evidence',phase:'Extracting Selected ZIP Evidence',processed:index+1,total:selected.length,unit:'files',state:'running',detail:item.filename});
  });
  if(audits.length)warnAuditFailure(await appendAudits(audits,system.id));setItems(current=>current.filter(item=>!completed.has(item.path)).map(item=>{const failure=failures.find(value=>value.item.path===item.path);return failure?{...item,selected:false,error:failure.detail}:item}));const detail=`${completed.size} ZIP file${completed.size===1?'':'s'} extracted in place; ${failures.length} remained unchanged for review. Edit the loose PDFs, then run Sync.`;setMessage(detail);onProcessing({title:'Unarchive Evidence',phase:failures.length?'Completed With Review Items':'Unarchive Complete',processed:selected.length,total:selected.length,unit:'files',state:failures.length?'error':'complete',detail});setBusy(false)
 }
 return <><p className="eyebrow">Operator-Initiated Correction</p><h2>Unarchive Evidence</h2><p className="hint">Choose any folder within <b>{system.name}</b> to find ZIP evidence recursively, or select individual ZIP files in Windows File Explorer. Each ZIP must contain exactly one readable PDF. The ZIP remains in place after the extracted PDF and SHA-256 integrity are verified. Run Sync after making corrections.</p>{!isPortableRoot(root)&&<p className="renamer-message">Open this tracker with the portable Windows executable to use native file selection.</p>}<div className="message-actions"><button disabled={busy||!isPortableRoot(root)} onClick={()=>void choose('unarchive-select-folder')}>Choose Folder</button><button disabled={busy||!isPortableRoot(root)} onClick={()=>void choose('unarchive-select-files')}>Choose ZIP Files</button></div>{items.length>0&&<><div className="message-actions"><button disabled={busy} onClick={()=>selectPage(!paged.items.every(item=>item.selected))}>{paged.items.every(item=>item.selected)?'Clear Page':'Select All on Page'}</button><button disabled={busy} onClick={()=>setItems(current=>current.map(item=>({...item,selected:!current.every(value=>value.selected)})))}>{items.every(item=>item.selected)?'Clear All Files':'Select All Files'}</button></div><div className="sync-review-list">{paged.items.map(item=><label key={item.path}><input type="checkbox" disabled={busy} checked={item.selected} onChange={event=>setItems(current=>current.map(value=>value.path===item.path?{...value,selected:event.target.checked}:value))}/><span><strong>{item.filename}</strong><small>{item.folder||'Mapped System Root'} · {Math.max(1,Math.ceil(item.size/1024)).toLocaleString()} KB{item.error?<><br/>{item.error}</>:null}</small></span></label>)}</div><CleanupPagination {...paged} onPage={setPage}/><button className="primary full" disabled={busy||!selected.length} onClick={()=>void apply()}>{busy?'Working…':`Unarchive ${selected.length} Selected File${selected.length===1?'':'s'}`}</button></>}{message&&<p className="renamer-message" aria-live="polite">{message}</p>}</>
}
