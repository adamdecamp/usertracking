'use client';

import {useEffect,useState} from 'react';

export type NotificationKind='info'|'success'|'warning'|'error';
export type AppNotification={id:string;kind:NotificationKind;title:string;message:string;createdAt:string};
type Listener=(notification:AppNotification)=>void;
const listeners=new Set<Listener>();

export function notify(message:string,kind:NotificationKind='info',title?:string){const clean=String(message).replaceAll('\u0000','').trim();if(!clean)return;const defaults:Record<NotificationKind,string>={info:'Information',success:'Completed',warning:'Review Needed',error:'Action Failed'},notification:AppNotification={id:crypto.randomUUID(),kind,title:title??defaults[kind],message:clean,createdAt:new Date().toISOString()};listeners.forEach(listener=>listener(notification))}

export function NotificationCenter(){
 const[items,setItems]=useState<AppNotification[]>([]);
 useEffect(()=>{const listener:Listener=notification=>setItems(current=>[notification,...current].slice(0,8));listeners.add(listener);return()=>{listeners.delete(listener)}},[]);
 function dismiss(id:string){setItems(current=>current.filter(item=>item.id!==id))}
 return <aside className="notification-center" aria-label="Notifications">{items.map(item=>{const lines=item.message.split(/\r?\n/).filter(Boolean),summary=lines[0]??item.message,hasDetails=lines.length>1||summary.length>220;return <article key={item.id} className={`notification ${item.kind}`} role={item.kind==='error'?'alert':'status'}><div><strong>{item.title}</strong><button type="button" aria-label={`Dismiss ${item.title}`} onClick={()=>dismiss(item.id)}>×</button></div><p>{summary.length>220?`${summary.slice(0,217)}…`:summary}</p>{hasDetails&&<details><summary>View Details</summary><pre>{item.message}</pre><button type="button" onClick={()=>void navigator.clipboard.writeText(item.message)}>Copy Details</button></details>}</article>})}</aside>
}
