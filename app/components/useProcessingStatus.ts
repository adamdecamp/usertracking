'use client';

import {useEffect,useRef,useState,type SetStateAction} from 'react';
import {createThrottledValue} from '../throttled-value.ts';
import {trackProcessingStep,type StepTimeline} from '../processing-steps.ts';
import type {ProcessingStatus} from './ProcessingPanel';
import type {OperationHistoryEntry} from './OperationHistory';

/** The progress panel updates up to 10 times a second; the rest of the page sees per-file progress at most once a second. */
export const liveProgressIntervalMs=100,pageProgressIntervalMs=1000;

/** A new stage, title or state (start, completion, failure, dismissal) is shown at once; only per-item counts are throttled. */
export function urgentProcessingChange(previous:ProcessingStatus|null,next:ProcessingStatus|null){return!previous||!next||previous.state!=='running'||next.state!=='running'||previous.title!==next.title||previous.phase!==next.phase}

export function useProcessingStatus(){
 const[processing,setProcessing]=useState<ProcessingStatus|null>(null);
 const[operationHistory,setOperationHistory]=useState<OperationHistoryEntry[]>([]),currentRef=useRef<ProcessingStatus|null>(null);
 const[processingLive]=useState(()=>createThrottledValue<ProcessingStatus|null>(null,liveProgressIntervalMs)),[processingForPage]=useState(()=>createThrottledValue<ProcessingStatus|null>(null,pageProgressIntervalMs));
 useEffect(()=>processingForPage.subscribe(()=>setProcessing(processingForPage.get())),[processingForPage]);
 const timelineRef=useRef<StepTimeline|null>(null);
 /** Publishes the status; when an operation finishes, the status also carries how long each stage took. */
 function setCurrent(requested:ProcessingStatus|null){const tracked=trackProcessingStep(timelineRef.current,requested,Date.now());timelineRef.current=tracked.timeline;const next=requested&&tracked.steps?{...requested,steps:tracked.steps}:requested,urgent=urgentProcessingChange(currentRef.current,next);currentRef.current=next;processingLive.set(next,urgent);processingForPage.set(next,urgent);return next}
 function operationStart(current:ProcessingStatus|null){return current?current.operationStartedAtMs??current.startedAtMs:undefined}
 function setProcessingState(action:SetStateAction<ProcessingStatus|null>){const previous=currentRef.current,requested=typeof action==='function'?action(previous):action,continuesPrior=Boolean(requested&&previous?.title===requested.title&&(requested.state!=='running'||previous?.state==='running'&&previous.phase===requested.phase)),sameOperation=Boolean(requested&&previous?.title===requested.title&&previous.state==='running'),stageStartedAtMs=requested?requested.startedAtMs??(continuesPrior?previous?.startedAtMs:undefined)??Date.now():0,next=requested?{...requested,startedAtMs:stageStartedAtMs,operationStartedAtMs:requested.operationStartedAtMs??(sameOperation?operationStart(previous):undefined)??stageStartedAtMs,completedAtMs:requested.state==='running'?undefined:requested.completedAtMs??Date.now()}:null,shown=setCurrent(next);if(shown&&shown.state!=='running'&&(previous?.state==='running'||previous?.title!==shown.title||previous.phase!==shown.phase))remember(shown)}
 function remember(next:ProcessingStatus){const entry:OperationHistoryEntry={id:crypto.randomUUID(),title:next.title,phase:next.phase,state:next.state==='error'?'error':'complete',detail:next.detail,completedAt:new Date().toISOString(),steps:next.steps};setOperationHistory(current=>[entry,...current].slice(0,5))}
 function startProcessing(title:string,phase:string,total?:number,unit:string|number='items',legacyUnit?:string){const resolvedTotal=legacyUnit?Number(unit):total,resolvedUnit=legacyUnit??String(unit),next:ProcessingStatus={title,phase,processed:0,total:resolvedTotal,unit:resolvedUnit,state:'running',startedAtMs:Date.now()};next.operationStartedAtMs=next.startedAtMs;setCurrent(next)}
 function updateProcessing(phase:string,processed:number,total?:number,detail?:string,unit?:string){const current=currentRef.current,continuesCurrentAction=current?.state==='running'&&current.phase===phase,next:ProcessingStatus={title:current?.title??'Processing',phase,processed,total,unit:unit??current?.unit??'items',state:'running',detail,startedAtMs:continuesCurrentAction?current.startedAtMs:Date.now()};next.operationStartedAtMs=(current?.state==='running'?operationStart(current):undefined)??next.startedAtMs;setCurrent(next)}
 function finishProcessing(phase:string,processed:number,total?:number,detail?:string,unit?:string){const current=currentRef.current,next:ProcessingStatus={title:current?.title??'Processing',phase,processed,total,unit:unit??current?.unit??'items',state:'complete',detail,startedAtMs:current?.startedAtMs??Date.now(),operationStartedAtMs:operationStart(current),completedAtMs:Date.now()};remember(setCurrent(next)??next)}
 function failProcessing(phase:string,detail:string){const current=currentRef.current,next:ProcessingStatus={title:current?.title??'Processing',phase,processed:current?.processed??0,total:current?.total,unit:current?.unit??'items',state:'error',detail,startedAtMs:current?.startedAtMs??Date.now(),operationStartedAtMs:operationStart(current),completedAtMs:Date.now()};remember(setCurrent(next)??next)}
 function clearOperationHistory(){setOperationHistory([])}
 return{processing,processingLive,setProcessing:setProcessingState,startProcessing,updateProcessing,finishProcessing,failProcessing,operationHistory,clearOperationHistory};
}
