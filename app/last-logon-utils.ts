import type {AuditEntry} from './audit-utils.ts';
import type {LastLogonRecord} from './infrastructure/portable-contracts.ts';

export const emptyLastLogonRecord=():LastLogonRecord=>({available:false,actor:'',timestampUtc:'',accessMode:'',actionCount:0,syncActions:0,userChanges:0,evidenceActions:0,reportActions:0,administrativeActions:0});
const startsSession=(action:string)=>/^(?:READ-ONLY SESSION START|FULL ACCESS SESSION START|MAP SYSTEM FOLDER)\b/i.test(action);

function classify(record:LastLogonRecord,action:string){
 record.actionCount++;
 if(/SYNC|CLEAN UP|RECONCILIATION/i.test(action))record.syncActions++;
 else if(/USER|PRIVILEGE|ACCOUNT|DISABLE|REENABLE/i.test(action))record.userChanges++;
 else if(/EVIDENCE|ARCHIVE|REWORK|COMPRESS|ORGANIZE|NORMALIZE/i.test(action))record.evidenceActions++;
 else if(/REPORT|SNAPSHOT|EXPORT|OUTLOOK|DRAFT|NOTIFICATION/i.test(action))record.reportActions++;
 else record.administrativeActions++;
}

export function lastLogonFromAudit(entries:AuditEntry[]):LastLogonRecord{
 const record=emptyLastLogonRecord();
 for(const entry of [...entries].sort((a,b)=>a.sequence-b.sequence)){
  if(startsSession(entry.action)){
   Object.assign(record,emptyLastLogonRecord(),{available:true,actor:entry.actor,timestampUtc:entry.timestampUtc,accessMode:/^READ-ONLY/i.test(entry.action)?'Read-Only':'Full Access'});
   continue;
  }
  if(!record.available||entry.actor.toLocaleLowerCase()!==record.actor.toLocaleLowerCase()||/SESSION END|APPLICATION SHUTDOWN/i.test(entry.action))continue;
  classify(record,entry.action);
 }
 return record;
}

export function lastLogonActionSummary(record:LastLogonRecord):string{
 if(!record.available)return 'No prior application logon is recorded for this information system.';
 const parts:[number,string][]=[[record.syncActions,'sync or cleanup'],[record.userChanges,'user-record'],[record.evidenceActions,'evidence'],[record.reportActions,'report or communication'],[record.administrativeActions,'administrative']];
 const described=parts.filter(([count])=>count>0).map(([count,label])=>`${count} ${label} action${count===1?'':'s'}`);
 if(!described.length)return 'No recorded changes or exports followed that logon.';
 return `${described.join(described.length===1?'':described.length===2?' and ':', ').replace(/, ([^,]+)$/,' and $1')}.`;
}
