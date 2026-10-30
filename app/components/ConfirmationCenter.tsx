'use client';

import {useEffect,useState} from 'react';
import {AccessibleModal} from './AccessibleModal';

type ConfirmationRequest={title:string;summary:string;items?:string[];confirmLabel?:string;danger?:boolean};
type PendingConfirmation=ConfirmationRequest&{resolve:(value:boolean)=>void};
type Listener=(request:PendingConfirmation)=>void;
const listeners=new Set<Listener>();

export function requestConfirmation(request:ConfirmationRequest){return new Promise<boolean>(resolve=>{const listener=listeners.values().next().value as Listener|undefined;if(!listener){resolve(false);return}listener({...request,resolve})})}

export function ConfirmationCenter(){
 const[pending,setPending]=useState<PendingConfirmation|null>(null);
 useEffect(()=>{const listener:Listener=request=>setPending(request);listeners.add(listener);return()=>{listeners.delete(listener)}},[]);
 function finish(value:boolean){pending?.resolve(value);setPending(null)}
 if(!pending)return null;
 return <AccessibleModal label={pending.title} onClose={()=>finish(false)} contentClassName="confirmation-dialog"><p className="eyebrow">Confirm Action</p><h2>{pending.title}</h2><p>{pending.summary}</p>{pending.items?.length&&<ul className="confirmation-impact">{pending.items.map((item,index)=><li key={`${index}-${item}`}>{item}</li>)}</ul>}<div className="confirmation-actions"><button type="button" onClick={()=>finish(false)}>Cancel</button><button type="button" className={pending.danger?'danger-button':'primary'} onClick={()=>finish(true)}>{pending.confirmLabel??'Continue'}</button></div></AccessibleModal>
}
