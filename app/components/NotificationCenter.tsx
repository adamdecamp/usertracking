'use client';

import {useEffect,useState} from 'react';
import {notificationSummary} from '../notification-summary';

export type NotificationKind='info'|'success'|'warning'|'error';
export type AppNotification={id:string;kind:NotificationKind;title:string;message:string;createdAt:string};
type Listener=(notification:AppNotification)=>void;
const listeners=new Set<Listener>();

export function notify(message:string,kind:NotificationKind='info',title?:string){const clean=String(message).replaceAll('\u0000','').trim();if(!clean)return;const defaults:Record<NotificationKind,string>={info:'Information',success:'Completed',warning:'Review Needed',error:'Action Failed'},notification:AppNotification={id:crypto.randomUUID(),kind,title:title??defaults[kind],message:clean,createdAt:new Date().toISOString()};listeners.forEach(listener=>listener(notification))}

/** How long a notification stays before closing itself; errors stay until dismissed. */
export const notificationLifetimeMs:Record<NotificationKind,number|undefined>={info:6000,success:6000,warning:10000,error:undefined};

export function NotificationCenter(){
 const[items,setItems]=useState<AppNotification[]>([]),[held,setHeld]=useState<string[]>([]);
 useEffect(()=>{const listener:Listener=notification=>setItems(current=>[notification,...current].slice(0,8));listeners.add(listener);return()=>{listeners.delete(listener)}},[]);
 // Close non-error notices on a timer, but never while the operator is hovering, focused, or reading details.
 useEffect(()=>{const timers=items.filter(item=>!held.includes(item.id)).flatMap(item=>{const lifetime=notificationLifetimeMs[item.kind];return lifetime===undefined?[]:[setTimeout(()=>dismiss(item.id),Math.max(0,lifetime-(Date.now()-Date.parse(item.createdAt))))]});return()=>timers.forEach(clearTimeout)},[items,held]);
 function dismiss(id:string){setItems(current=>current.filter(item=>item.id!==id));setHeld(current=>current.filter(value=>value!==id))}
 const hold=(id:string,on:boolean)=>setHeld(current=>on?(current.includes(id)?current:[...current,id]):current.filter(value=>value!==id));
 return <aside className="notification-center" aria-label="Notifications">{items.map(item=>{const lines=item.message.split(/\r?\n/).filter(Boolean),summary=notificationSummary(item.title,lines)??item.message,hasDetails=lines.length>1||summary.length>220;return <article key={item.id} className={`notification ${item.kind}`} role={item.kind==='error'?'alert':'status'} onMouseEnter={()=>hold(item.id,true)} onMouseLeave={event=>{if(!event.currentTarget.querySelector('details[open]'))hold(item.id,false)}} onFocus={()=>hold(item.id,true)} onToggle={event=>{if((event.target as HTMLDetailsElement).open)hold(item.id,true)}}><div><strong>{item.title}</strong><button type="button" aria-label={`Dismiss ${item.title}`} onClick={()=>dismiss(item.id)}>×</button></div><p>{summary.length>220?`${summary.slice(0,217)}…`:summary}</p>{hasDetails&&<details><summary>View Details</summary><pre>{item.message}</pre><button type="button" onClick={()=>void navigator.clipboard.writeText(item.message)}>Copy Details</button></details>}</article>})}</aside>
}
