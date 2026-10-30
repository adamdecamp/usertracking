'use client';

import {useEffect,useId,useRef,type ReactNode} from 'react';

const modalStack:string[]=[];
const focusableSelector='button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AccessibleModal({label,onClose,children,closeDisabled=false,backdropClassName='',contentClassName='',showClose=true}:{label:string;onClose:()=>void;children:ReactNode;closeDisabled?:boolean;backdropClassName?:string;contentClassName?:string;showClose?:boolean}){
 const id=useId(),dialogRef=useRef<HTMLDivElement>(null),returnFocus=useRef<HTMLElement|null>(null),closeRef=useRef(onClose);
 useEffect(()=>{closeRef.current=onClose},[onClose]);
 useEffect(()=>{
  returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;modalStack.push(id);const dialog=dialogRef.current,focusable=dialog?.querySelectorAll<HTMLElement>(focusableSelector);(focusable?.[0]??dialog)?.focus();
  const keydown=(event:KeyboardEvent)=>{if(modalStack.at(-1)!==id)return;if(event.key==='Escape'&&!closeDisabled){event.preventDefault();closeRef.current();return}if(event.key!=='Tab'||!dialog)return;const items=Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(item=>item.offsetParent!==null);if(!items.length){event.preventDefault();dialog.focus();return}const first=items[0],last=items.at(-1)!;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};
  document.addEventListener('keydown',keydown);const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  return()=>{document.removeEventListener('keydown',keydown);const index=modalStack.lastIndexOf(id);if(index>=0)modalStack.splice(index,1);if(!modalStack.length)document.body.style.overflow=previousOverflow;queueMicrotask(()=>returnFocus.current?.focus())};
 },[closeDisabled,id]);
 return <div className={`backdrop ${backdropClassName}`.trim()} onMouseDown={event=>{if(event.target===event.currentTarget&&!closeDisabled)onClose()}}><div ref={dialogRef} className={`modal ${contentClassName}`.trim()} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{showClose&&<button className="close" aria-label={`Close ${label}`} disabled={closeDisabled} onClick={onClose}>×</button>}{children}</div></div>
}
