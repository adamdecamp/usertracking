'use client';

import {useRef,useState,type DragEvent} from 'react';
import {acceptsEvidenceExtension} from '../evidence-validation';
import {notify} from './NotificationCenter';

const evidenceAccept='.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed';

export function EvidenceFilePicker({kind,file,onFile,disabled=false,required=true,canonicalName}:{kind:string;file?:File|null;onFile:(file:File)=>void|Promise<void>;disabled?:boolean;required?:boolean;canonicalName?:string}){
 const input=useRef<HTMLInputElement>(null),[dragging,setDragging]=useState(false);
 function select(fileToSelect?:File){if(!fileToSelect||disabled)return;if(!acceptsEvidenceExtension(fileToSelect.name)){notify(`${kind}: select a PDF or a ZIP containing exactly one PDF.`,'warning','Unsupported Evidence File');return}void onFile(fileToSelect)}
 function drop(event:DragEvent<HTMLDivElement>){event.preventDefault();setDragging(false);select(event.dataTransfer.files?.[0])}
 return <div className={`evidence-picker${dragging?' dragging':''}${disabled?' disabled':''}`} role="group" aria-label={`${kind} Upload`} onDragEnter={event=>{event.preventDefault();if(!disabled)setDragging(true)}} onDragOver={event=>{event.preventDefault();if(!disabled){event.dataTransfer.dropEffect='copy';setDragging(true)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}} onDrop={drop}>
  <div className="evidence-picker-head"><strong>{kind}</strong><b>{file?'Ready':required?'Required':'Optional'}</b></div>
  <p>{file?.name||'Drag and drop a PDF or one-PDF ZIP here, or browse with File Explorer.'}{canonicalName&&<small>Document Renamer validated this upload. It will be stored as {canonicalName}.</small>}</p>
  <button type="button" disabled={disabled} onClick={()=>input.current?.click()}>{file?'Replace File':'Browse Files'}</button>
  <input ref={input} hidden type="file" accept={evidenceAccept} disabled={disabled} onChange={event=>{select(event.target.files?.[0]);event.currentTarget.value=''}}/>
 </div>
}
