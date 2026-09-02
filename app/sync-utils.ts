export const syncIndexVersion=1;
export const syncIndexFilename='tracker-sync-index.json';
export const syncIndexChecksumFilename=`${syncIndexFilename}.sha256`;
export const trainingCertificateSyncPolicy={maxPages:1,timeoutMs:10000,concurrency:6,batchSize:48,deepRecovery:false} as const;

export type SyncIndexEntry={
 path:string;
 name:string;
 size:number;
 lastModifiedUnixMs:number;
 accepted:boolean;
 error:string;
};

export type SyncIndexEnvelope={
 version:typeof syncIndexVersion;
 ruleSetVersion:string;
 generatedAtUtc:string;
 files:SyncIndexEntry[];
};

export function syncIndexKey(path:string){return path.replaceAll('\\','/').toLowerCase()}

export function syncIndexEntryMatches(previous:SyncIndexEntry,current:Pick<SyncIndexEntry,'path'|'name'|'size'|'lastModifiedUnixMs'>){
 return syncIndexKey(previous.path)===syncIndexKey(current.path)&&previous.name.toLowerCase()===current.name.toLowerCase()&&previous.size===current.size&&previous.lastModifiedUnixMs===current.lastModifiedUnixMs;
}

export function readSyncIndex(value:unknown,expectedRuleSetVersion:string){
 if(!value||typeof value!=='object')return;
 const envelope=value as Partial<SyncIndexEnvelope>;
 if(envelope.version!==syncIndexVersion||envelope.ruleSetVersion!==expectedRuleSetVersion||typeof envelope.generatedAtUtc!=='string'||!Number.isFinite(Date.parse(envelope.generatedAtUtc))||!Array.isArray(envelope.files)||envelope.files.length>100000)return;
 const files:SyncIndexEntry[]=[];
 for(const item of envelope.files){
  if(!item||typeof item!=='object')return;
  const entry=item as Partial<SyncIndexEntry>;
  if(typeof entry.path!=='string'||!entry.path||entry.path.length>32767||entry.path.includes('\0')||typeof entry.name!=='string'||!entry.name||entry.name.length>500||typeof entry.size!=='number'||!Number.isSafeInteger(entry.size)||entry.size<0||typeof entry.lastModifiedUnixMs!=='number'||!Number.isSafeInteger(entry.lastModifiedUnixMs)||entry.lastModifiedUnixMs<0||typeof entry.accepted!=='boolean'||typeof entry.error!=='string'||entry.error.length>300)return;
  files.push(entry as SyncIndexEntry);
 }
 return{...envelope,files} as SyncIndexEnvelope;
}

export function createSyncIndex(ruleSetVersion:string,files:SyncIndexEntry[],generatedAtUtc=new Date().toISOString()):SyncIndexEnvelope{
 return{version:syncIndexVersion,ruleSetVersion,generatedAtUtc,files};
}

export function throwIfSyncCancelled(signal?:AbortSignal){
 if(signal?.aborted)throw new DOMException('Sync stopped by the operator.','AbortError');
}

export function isSyncCancellation(error:unknown){
 return error instanceof DOMException&&error.name==='AbortError';
}
