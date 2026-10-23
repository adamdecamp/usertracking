'use client';

import {useState} from 'react';
import type {ProcessingStatus} from './ProcessingPanel';

export function useProcessingStatus(){
 const[processing,setProcessing]=useState<ProcessingStatus|null>(null);
 function startProcessing(title:string,phase:string,total?:number,unit:string|number='items',legacyUnit?:string){const resolvedTotal=legacyUnit?Number(unit):total,resolvedUnit=legacyUnit??String(unit);setProcessing({title,phase,processed:0,total:resolvedTotal,unit:resolvedUnit,state:'running'})}
 function updateProcessing(phase:string,processed:number,total?:number,detail?:string,unit?:string){setProcessing(current=>({title:current?.title??'Processing',phase,processed,total,unit:unit??current?.unit??'items',state:'running',detail}))}
 function finishProcessing(phase:string,processed:number,total?:number,detail?:string,unit?:string){setProcessing(current=>({title:current?.title??'Processing',phase,processed,total,unit:unit??current?.unit??'items',state:'complete',detail}))}
 function failProcessing(phase:string,detail:string){setProcessing(current=>({title:current?.title??'Processing',phase,processed:current?.processed??0,total:current?.total,unit:current?.unit??'items',state:'error',detail}))}
 return{processing,setProcessing,startProcessing,updateProcessing,finishProcessing,failProcessing};
}
