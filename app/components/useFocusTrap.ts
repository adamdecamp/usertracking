'use client';

import {useEffect,type RefObject} from 'react';
import {focusableSelector} from './AccessibleModal';

/**
 * Keeps keyboard focus inside a blocking screen that is not built on AccessibleModal: the identity and access
 * gates, the session lock, the previous-logon notice, the recovery panels, and the Sync PDF preview. Without
 * it, Tab reaches the page behind a screen that is meant to block it.
 *
 * Screens are kept in the order they appeared; only the newest one that is on screen acts. Focus that lands
 * anywhere else is pulled back at once, so a window that opens or closes behind a lock never takes the
 * keyboard. Notifications float above every screen, so they are part of the Tab order of whichever is on top.
 */
const traps:RefObject<HTMLElement|null>[]=[];
/** What Escape does on a screen; a screen without an entry ignores Escape (a lock or gate must be answered). */
const escapeActions=new WeakMap<RefObject<HTMLElement|null>,()=>void>();

/** A notification's "View Details" line is a control too. */
const controlSelector=`${focusableSelector}, summary`;
const visibleItems=(container:HTMLElement)=>Array.from(container.querySelectorAll<HTMLElement>(controlSelector)).filter(item=>item.offsetParent!==null);
const topTrap=()=>[...traps].reverse().find(item=>!!item.current&&item.current.isConnected);
const notificationArea=(container:HTMLElement)=>{const area=document.querySelector<HTMLElement>('.notification-center');return area&&!container.contains(area)?area:null};

function onKeyDown(event:KeyboardEvent){
 if(event.key!=='Tab'&&event.key!=='Escape')return;
 const trap=topTrap(),container=trap?.current;
 if(!trap||!container)return;
 // Escape belongs to the screen on top. It must never reach a window hidden behind it, which would close unseen.
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();escapeActions.get(trap)?.();return;}
 const area=notificationArea(container),own=visibleItems(container),notes=area?visibleItems(area):[],items=[...own,...notes];
 const active=document.activeElement instanceof HTMLElement?document.activeElement:null,inScreen=!!active&&container.contains(active),inNotes=!!active&&!!area&&area.contains(active);
 const stay=(target:HTMLElement|undefined)=>{event.preventDefault();event.stopPropagation();target?.focus()};
 if(!items.length){stay(inScreen?undefined:container);return}
 if(!inScreen&&!inNotes){stay(event.shiftKey?items[items.length-1]:items[0]);return}
 // Inside the screen or the notifications the browser moves the focus; this only carries it across their ends.
 const group=inScreen?own:notes,next=(inScreen?notes:own).length?(inScreen?notes:own):group;
 if(event.shiftKey&&(!group.length||active===group[0]||active===container))stay(next[next.length-1]);
 else if(!event.shiftKey&&(!group.length||active===group[group.length-1]))stay(next[0]);
}

function onFocusIn(event:FocusEvent){
 const container=topTrap()?.current,target=event.target;
 if(!container||!(target instanceof Node)||container.contains(target)||notificationArea(container)?.contains(target))return;
 (visibleItems(container)[0]??container).focus();
}

/**
 * Traps focus in `ref` while `active`. On appearing, focus moves inside unless the screen already placed it there;
 * on closing, focus goes back to the control that had it before, when that control is still on the page.
 * `onEscape` is what Escape does on this screen; leave it out for a screen that must be answered.
 */
export function useFocusTrap(ref:RefObject<HTMLElement|null>,active=true,onEscape?:()=>void){
 useEffect(()=>{if(onEscape)escapeActions.set(ref,onEscape);else escapeActions.delete(ref)});
 useEffect(()=>{
  if(!active)return;
  const focused=document.activeElement,opener=focused instanceof HTMLElement&&focused!==document.body&&!ref.current?.contains(focused)?focused:null;
  if(!traps.length){document.addEventListener('keydown',onKeyDown,true);document.addEventListener('focusin',onFocusIn)}
  traps.push(ref);
  // After the screen's own effects, so a screen that focuses its main control keeps that choice.
  queueMicrotask(()=>{const container=ref.current;if(container&&!container.contains(document.activeElement))(visibleItems(container)[0]??container).focus()});
  return()=>{
   const index=traps.lastIndexOf(ref);if(index>=0)traps.splice(index,1);
   if(!traps.length){document.removeEventListener('keydown',onKeyDown,true);document.removeEventListener('focusin',onFocusIn)}
   // Only when nothing else took the focus: a window that opened as this screen closed keeps it.
   queueMicrotask(()=>{if(opener?.isConnected&&(!document.activeElement||document.activeElement===document.body))opener.focus()});
  };
 },[ref,active]);
}
