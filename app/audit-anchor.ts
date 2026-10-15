import {sha256Bytes} from './backup-utils.ts';

export const auditAnchorFormat='RAPTOR Audit Anchor';
export const auditAnchorVersion=1;

export type AuditAnchorRecord={
 format:typeof auditAnchorFormat;
 version:typeof auditAnchorVersion;
 generatedAtUtc:string;
 operator:string;
 applicationVersion:string;
 ruleSetVersion:string;
 system:{id:string;name:string};
 audit:{entries:number;files:number;firstTimestamp?:string;lastTimestamp?:string;headHash:string};
 storageInstruction:string;
};

export type AuditAnchorReceipt={record:AuditAnchorRecord;recordSha256:string};

const clean=(value:string,max:number)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const hashPattern=/^[a-f0-9]{64}$/i;

export async function createAuditAnchorReceipt(input:{
 generatedAtUtc?:string;
 operator:string;
 applicationVersion:string;
 ruleSetVersion:string;
 system:{id:string;name:string};
 audit:{entries:number;files:number;firstTimestamp?:string;lastTimestamp?:string;headHash:string};
}):Promise<AuditAnchorReceipt>{
 const generatedAtUtc=input.generatedAtUtc??new Date().toISOString();
 if(!generatedAtUtc.endsWith('Z')||!Number.isFinite(Date.parse(generatedAtUtc)))throw new Error('The audit-anchor generation timestamp is invalid.');
 if(!Number.isSafeInteger(input.audit.entries)||input.audit.entries<0||!Number.isSafeInteger(input.audit.files)||input.audit.files<0||!hashPattern.test(input.audit.headHash))throw new Error('The verified audit-chain state is invalid.');
 const record:AuditAnchorRecord={
  format:auditAnchorFormat,
  version:auditAnchorVersion,
  generatedAtUtc,
  operator:clean(input.operator,500),
  applicationVersion:clean(input.applicationVersion,50),
  ruleSetVersion:clean(input.ruleSetVersion,100),
  system:{id:clean(input.system.id,100),name:clean(input.system.name,200)},
  audit:{entries:input.audit.entries,files:input.audit.files,firstTimestamp:input.audit.firstTimestamp,lastTimestamp:input.audit.lastTimestamp,headHash:input.audit.headHash.toLowerCase()},
  storageInstruction:'Preserve this receipt outside the mapped information-system folder so an auditor can compare its head hash with the live audit chain.',
 };
 if(!record.operator||!record.applicationVersion||!record.ruleSetVersion||!record.system.id||!record.system.name)throw new Error('The audit-anchor identity fields are incomplete.');
 return{record,recordSha256:await sha256Bytes(new TextEncoder().encode(JSON.stringify(record)))};
}

export async function verifyAuditAnchorReceipt(value:AuditAnchorReceipt){
 if(!value||value.record?.format!==auditAnchorFormat||value.record.version!==auditAnchorVersion||!hashPattern.test(value.recordSha256))return false;
 return await sha256Bytes(new TextEncoder().encode(JSON.stringify(value.record)))===value.recordSha256.toLowerCase();
}
