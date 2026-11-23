'use client';

import {useMemo,useState} from 'react';
import {AccessibleModal} from './AccessibleModal';
import {fallbackTimeZone,isValidTimeZone,timeZoneLabel,timeZoneOptions} from '../compliance-time-zone';
import {needsTimeZonePrompt} from '../application/system-edit';
import {notify} from './NotificationCenter';
import type {SystemRecord} from '../domain/tracker-models';

/** Shows the time-zone prompt to a ready Full Access editor until the system has a zone or the operator defers it. */
export function SystemTimeZoneGate({system,editorReady,onSave}:{system:SystemRecord;editorReady:boolean;onSave:(timeZone:string)=>Promise<void>}){
 const [deferred,setDeferred]=useState<string[]>([]);
 if(!needsTimeZonePrompt({editorReady,system,deferred}))return null;
 return <TimeZonePrompt key={system.id} systemName={system.name} onSave={async timeZone=>{await onSave(timeZone);notify(`Due dates for ${system.name} now follow ${timeZoneLabel(timeZone)}.`,'success','Time Zone Saved')}} onLater={()=>setDeferred(current=>[...current,system.id])}/>;
}

/** A time-zone picker listing common zones first, then every other IANA zone. */
export function TimeZoneSelect({value,onChange,id,disabled=false}:{value:string;onChange:(value:string)=>void;id?:string;disabled?:boolean}){
 const options=useMemo(()=>{const all=timeZoneOptions();return value&&!all.includes(value)?[value,...all]:all},[value]);
 return <select id={id} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{options.map(zone=><option key={zone} value={zone}>{timeZoneLabel(zone)}</option>)}</select>;
}

/**
 * Asks a Full Access operator to choose the time zone for an information
 * system that does not have one yet. Due and Overdue dates use this zone for
 * every operator of the system.
 */
export function TimeZonePrompt({systemName,onSave,onLater}:{systemName:string;onSave:(timeZone:string)=>Promise<void>;onLater:()=>void}){
 const [timeZone,setTimeZone]=useState(fallbackTimeZone()),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){
  if(!isValidTimeZone(timeZone)){setError('Choose a time zone from the list.');return}
  setBusy(true);setError('');
  try{await onSave(timeZone)}catch(caught){setError(caught instanceof Error?caught.message:'The time zone could not be saved.');setBusy(false)}
 }
 return <AccessibleModal label="Choose Time Zone" onClose={onLater} closeDisabled={busy} contentClassName="confirmation-dialog time-zone-dialog">
  <p className="eyebrow">Information System Setup</p>
  <h2>Choose a Time Zone</h2>
  <p className="hint">Select the time zone where <b>{systemName}</b> is administered. Evidence becomes Due and Overdue at midnight in this zone, so every operator sees the same dates. This computer is set to {timeZoneLabel(fallbackTimeZone())}.</p>
  <label className="time-zone-field" htmlFor="system-time-zone">Time Zone</label>
  <TimeZoneSelect id="system-time-zone" value={timeZone} onChange={setTimeZone} disabled={busy}/>
  {error&&<p className="restore-warning" role="alert">{error}</p>}
  <div className="confirmation-actions">
   <button type="button" disabled={busy} onClick={onLater}>Remind Me Later</button>
   <button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save Time Zone'}</button>
  </div>
 </AccessibleModal>;
}
