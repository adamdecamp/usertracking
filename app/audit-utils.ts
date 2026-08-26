export const auditVersion=1;
export const auditGenesisHash='0'.repeat(64);

export type AuditEntry={
 version:1;
 sequence:number;
 timestampUtc:string;
 actor:string;
 action:string;
 previousHash:string;
 entryHash:string;
};

export type AuditChainState={
 entries:number;
 headHash:string;
 firstTimestamp?:string;
 lastTimestamp?:string;
};

const clean=(value:string,max=500)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const isHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
const encoder=new TextEncoder();
async function sha256Hex(value:string){const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(value));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}

export async function auditEntryHash(entry:Pick<AuditEntry,'version'|'sequence'|'timestampUtc'|'actor'|'action'|'previousHash'>){
 const payload=`${entry.version}\n${entry.sequence}\n${entry.timestampUtc}\n${clean(entry.actor)}\n${clean(entry.action)}\n${entry.previousHash.toLowerCase()}`;
 return sha256Hex(payload);
}

export async function buildAuditEntry(state:AuditChainState,actor:string,action:string,timestampUtc=new Date().toISOString()):Promise<AuditEntry>{
 const previousHash=state.headHash.toLowerCase(),sequence=state.entries+1,base={version:auditVersion as 1,sequence,timestampUtc,actor:clean(actor),action:clean(action),previousHash};
 if(!isHash(previousHash)||!timestampUtc.endsWith('Z')||!Number.isFinite(Date.parse(timestampUtc)))throw new Error('The audit entry timestamp or previous hash is invalid.');
 if(state.lastTimestamp&&Date.parse(timestampUtc)<=Date.parse(state.lastTimestamp))throw new Error('The system clock is not later than the most recent audit entry.');
 return{...base,entryHash:await auditEntryHash(base)};
}

export async function verifyAuditText(text:string,state:AuditChainState={entries:0,headHash:auditGenesisHash},expectedDay?:string){
 let next={...state};
 const lines=text.split(/\r?\n/).filter(Boolean);
 if(!lines.length)throw new Error('The audit log contains no entries.');
 for(const line of lines){
  if(line.length>8192)throw new Error('An audit entry exceeds the size limit.');
  let value:Partial<AuditEntry>;
  try{value=JSON.parse(line) as Partial<AuditEntry>}catch{throw new Error('The audit log contains invalid JSON.');}
  if(value.version!==auditVersion||!Number.isSafeInteger(value.sequence)||value.sequence!==next.entries+1||typeof value.timestampUtc!=='string'||!value.timestampUtc.endsWith('Z')||!Number.isFinite(Date.parse(value.timestampUtc))||typeof value.actor!=='string'||typeof value.action!=='string'||!isHash(value.previousHash)||!isHash(value.entryHash))throw new Error('The audit log contains an invalid entry.');
  const entry=value as AuditEntry;
  if(expectedDay&&entry.timestampUtc.slice(0,10)!==expectedDay)throw new Error('An audit timestamp does not match its daily file.');
  if(next.lastTimestamp&&Date.parse(entry.timestampUtc)<=Date.parse(next.lastTimestamp))throw new Error('The audit log timestamps are not increasing.');
  if(entry.previousHash.toLowerCase()!==next.headHash.toLowerCase())throw new Error('The audit hash chain is broken.');
  const expected=await auditEntryHash(entry);
  if(expected!==entry.entryHash.toLowerCase())throw new Error('An audit entry failed its integrity check.');
  next={entries:entry.sequence,headHash:entry.entryHash.toLowerCase(),firstTimestamp:next.firstTimestamp??entry.timestampUtc,lastTimestamp:entry.timestampUtc};
 }
 return next;
}
