import type {SystemRecord} from '../domain/tracker-models.ts';

/** Audit description of an information-system edit, listing only the fields that changed. */
export function describeSystemEdit(previous:SystemRecord,next:SystemRecord):string{
 return [
  previous.name!==next.name?`name ${previous.name} to ${next.name}`:'',
  previous.type!==next.type?`type ${previous.type} to ${next.type}`:'',
  previous.organization!==next.organization?`organization ${previous.organization||'not specified'} to ${next.organization||'not specified'}`:'',
  previous.archived!==next.archived?`${next.archived?'archived':'unarchived'} system and linked user records`:'',
  previous.timeZone!==next.timeZone?`time zone ${previous.timeZone||'not set'} to ${next.timeZone||'not set'}`:'',
 ].filter(Boolean).join('; ');
}

/** True when nothing an operator can edit on the system has changed. */
export function systemEditIsUnchanged(previous:SystemRecord,next:SystemRecord):boolean{
 return describeSystemEdit(previous,next)==='';
}

/**
 * Whether to ask for this system's time zone now. `editorReady` means an active
 * Full Access session holds this mapped system with no other dialog open.
 */
export function needsTimeZonePrompt(input:{editorReady:boolean;system?:SystemRecord;deferred:readonly string[]}):boolean{
 const {system}=input;
 return !!system&&input.editorReady&&!system.archived&&!system.timeZone&&!input.deferred.includes(system.id);
}
