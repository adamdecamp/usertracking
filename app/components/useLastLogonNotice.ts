'use client';
import {useCallback,useRef,useState} from 'react';
import {emptyLastLogonRecord} from '../last-logon-utils.ts';
import type {LastLogonRecord} from '../infrastructure/portable-contracts.ts';

type NamedSystem={id:string;name:string};
type Notice={record:LastLogonRecord;systemName:string};

export function useLastLogonNotice(systems:NamedSystem[]){
 const[notice,setNotice]=useState<Notice|null>(null),shown=useRef(false);
 const present=useCallback((record:LastLogonRecord|undefined,systemId:string,availableSystems:NamedSystem[]=systems)=>{if(shown.current)return;shown.current=true;setNotice({record:record??emptyLastLogonRecord(),systemName:availableSystems.find(item=>item.id===systemId)?.name??'Selected Information System'})},[systems]);
 return{lastLogonNotice:notice,presentLastLogon:present,closeLastLogon:()=>setNotice(null)};
}
