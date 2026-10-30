'use client';

import {useRef,useState,type SetStateAction} from 'react';
import type {ProcessingStatus} from './ProcessingPanel';
import type {OperationHistoryEntry} from './OperationHistory';

export function useProcessingStatus(){
 const[processing,setProcessing]=useState<ProcessingStatus|null>(null);
 const[operationHistory,setOperationHistory]=useState<OperationHistoryEntry[]>([]),currentRef=useRef<ProcessingStatus|null>(null);
 function setCurrent(next:ProcessingStatus|null){currentRef.current=next;setProcessing(next)}
 function setProcessingState(action:SetStateAction<ProcessingStatus|null>){const previous=currentRef.current,next=typeof action==='function'?action(previous):action;setCurrent(next);if(next&&next.state!=='running'&&(previous?.state==='running'||previous?.title!==next.title||previous.phase!==next.phase))remember(next)}
 function remember(next:ProcessingStatus){const entry:OperationHistoryEntry={id:crypto.randomUUID(),title:next.title,phase:next.phase,state:next.state==='error'?'error':'complete',detail:next.detail,completedAt:new Date().toISOString()};setOperationHistory(current=>[entry,...current].slice(0,5))}
 function startProcessing(title:string,phase:string,total?:number,unit:string|number='items',legacyUnit?:string){const resolvedTotal=legacyUnit?Number(unit):total,resolvedUnit=legacyUnit??String(unit),next:ProcessingStatus={title,phase,processed:0,total:resolvedTotal,unit:resolvedUnit,state:'running'};setCurrent(next)}
 function updateProcessing(phase:string,processed:number,total?:number,detail?:string,unit?:string){const current=currentRef.current,next:ProcessingStatus={title:current?.title??'Processing',phase,processed,total,unit:unit??current?.unit??'items',state:'running',detail};setCurrent(next)}
 function finishProcessing(phase:string,processed:number,total?:number,detail?:string,unit?:string){const current=currentRef.current,next:ProcessingStatus={title:current?.title??'Processing',phase,processed,total,unit:unit??current?.unit??'items',state:'complete',detail};setCurrent(next);remember(next)}
 function failProcessing(phase:string,detail:string){const current=currentRef.current,next:ProcessingStatus={title:current?.title??'Processing',phase,processed:current?.processed??0,total:current?.total,unit:current?.unit??'items',state:'error',detail};setCurrent(next);remember(next)}
 function clearOperationHistory(){setOperationHistory([])}
 return{processing,setProcessing:setProcessingState,startProcessing,updateProcessing,finishProcessing,failProcessing,operationHistory,clearOperationHistory};
}
