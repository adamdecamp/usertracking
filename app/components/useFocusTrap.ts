'use client';

import {useEffect,type RefObject} from 'react';
import {focusableSelector} from './AccessibleModal';

/**
 * Keeps keyboard focus inside a blocking screen that is not built on AccessibleModal: the identity and access
 * gates, the session lock, the previous-logon notice, the recovery panels, and the Sync PDF preview. Without
 * it, Tab reaches the page behind a screen that is meant to block it.
 *
 * Screens are kept in the order they appeared; only the newest one that is on screen acts. A trap yields to an
 * AccessibleModal that holds the focus (for example a window opened from a recovery panel), because that
 * window keeps the focus itself.
 */
const traps:RefObject<HTMLElement|null>[]=[];
/** What Escape does on a screen; a screen without an entry ignores Escape (a lock or gate must be answered). */
const escapeActions=new WeakMap<RefObject<HTMLElement|null>,()=>void>();

const visibleItems=(container:HTMLElement)=>Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(item=>item.offsetParent!==null);

function onKeyDown(event:KeyboardEvent){
 if(event.key!=='Tab'&&event.key!=='Escape')return;
 const trap=[...traps].reverse().find(item=>!!item.current&&item.current.isConnected),container=trap?.current;
 if(!trap||!container)return;
 if(event.key==='Escape'){
  // Escape belongs to the screen on top. It must never reach a window hidden behind it, which would close unseen.
  const focused=document.activeElement instanceof HTMLElement?document.activeElement:null,otherDialog=focused&&!container.contains(focused)?focused.closest('[role="dialog"][aria-modal="true"]'):null;
  if(otherDialog&&!otherDialog.contains(container)&&!traps.some(item=>item.current===otherDialog))return;
  event.preventDefault();event.stopPropagation();escapeActions.get(trap)?.();return;
 }
 const active=document.activeElement instanceof HTMLElement?document.activeElement:null,inside=!!active&&container.contains(active);
 if(!inside){
  const otherDialog=active?.closest('[role="dialog"][aria-modal="true"]');
  if(otherDialog&&!otherDialog.contains(container)&&!traps.some(item=>item.current===otherDialog))return;
 }
 const items=visibleItems(container);
 const stay=(target:HTMLElement|undefined)=>{event.preventDefault();event.stopPropagation();target?.focus()};
 if(!items.length){stay(inside?undefined:container);return}
 const first=items[0],last=items[items.length-1];
 if(!inside)stay(event.shiftKey?last:first);
 else if(event.shiftKey&&active===first)stay(last);
 else if(!event.shiftKey&&active===last)stay(first);
}

/**
 * Traps focus in `ref` while `active`. On appearing, focus moves inside unless the screen already placed it there.
 * `onEscape` is what Escape does on this screen; leave it out for a screen that must be answered.
 */
export function useFocusTrap(ref:RefObject<HTMLElement|null>,active=true,onEscape?:()=>void){
 useEffect(()=>{if(onEscape)escapeActions.set(ref,onEscape);else escapeActions.delete(ref)});
 useEffect(()=>{
  if(!active)return;
  if(!traps.length)document.addEventListener('keydown',onKeyDown,true);
  traps.push(ref);
  // After the screen's own effects, so a screen that focuses its main control keeps that choice.
  queueMicrotask(()=>{const container=ref.current;if(container&&!container.contains(document.activeElement))(visibleItems(container)[0]??container).focus()});
  return()=>{const index=traps.lastIndexOf(ref);if(index>=0)traps.splice(index,1);if(!traps.length)document.removeEventListener('keydown',onKeyDown,true)};
 },[ref,active]);
}
