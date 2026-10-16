import {sha256Bytes} from './backup-utils.ts';

export const diagnosticBundleFormat='RAPTOR Sanitized Diagnostic Bundle';
export const diagnosticBundleVersion=1;

export type DiagnosticSummary={
 generatedAtUtc:string;
 networkRoot:boolean;
 errorReportFiles:number;
 errorEntries:number;
 contexts:{context:string;count:number}[];
};

export type DiagnosticPerformance={
 generatedAtUtc:string;
 networkRoot:boolean;
 operations:{operation:string;runs:number;averageMs:number;p50Ms:number;p95Ms:number;maximumMs:number;averagePreparationMs?:number;averageTransferMs?:number;averageFinalizationMs?:number;averageBytesTransferred?:number;averageBytesPerSecond?:number}[];
 backupPending:boolean;
 watcherBaselined:boolean;
 watcherOverflowed:boolean;
 dirtyOrganizationCount:number;
 syncIndexShards:number;
 databaseShards:number;
 publicationIndexShards?:number;
 manifestStorageFormat:string;
 localReadCacheAvailable:boolean;
 backupCompression:string;
 auditCheckpointAvailable:boolean;
};

export type DiagnosticBundleRecord={
 format:typeof diagnosticBundleFormat;
 version:typeof diagnosticBundleVersion;
 generatedAtUtc:string;
 applicationVersion:string;
 ruleSetVersion:string;
 session:{accessMode:string;state:string};
 counts:{users:number;disabledUsers:number;artifacts:number;pendingSyncItems:number};
 storage:{health:string;diagnostics:DiagnosticSummary};
 audit:{verified:boolean;entries:number;files:number;headHash:string};
 performance:DiagnosticPerformance;
 privacyNotice:string;
};

const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const bounded=(value:unknown,max=1_000_000)=>Number.isFinite(Number(value))?Math.max(0,Math.min(max,Math.trunc(Number(value)))):0;

export async function createDiagnosticBundle(input:Omit<DiagnosticBundleRecord,'format'|'version'|'generatedAtUtc'|'privacyNotice'>):Promise<{record:DiagnosticBundleRecord;recordSha256:string}>{
 const diagnostics=input.storage.diagnostics,performance=input.performance;
 const record:DiagnosticBundleRecord={
  format:diagnosticBundleFormat,
  version:diagnosticBundleVersion,
  generatedAtUtc:new Date().toISOString(),
  applicationVersion:clean(input.applicationVersion,50),
  ruleSetVersion:clean(input.ruleSetVersion,100),
  session:{accessMode:clean(input.session.accessMode,30),state:clean(input.session.state,30)},
  counts:{users:bounded(input.counts.users),disabledUsers:bounded(input.counts.disabledUsers),artifacts:bounded(input.counts.artifacts),pendingSyncItems:bounded(input.counts.pendingSyncItems)},
  storage:{health:clean(input.storage.health,40),diagnostics:{generatedAtUtc:clean(diagnostics.generatedAtUtc,50),networkRoot:diagnostics.networkRoot===true,errorReportFiles:bounded(diagnostics.errorReportFiles,10_000),errorEntries:bounded(diagnostics.errorEntries,1_000_000),contexts:(diagnostics.contexts??[]).slice(0,100).map(item=>({context:clean(item.context,200),count:bounded(item.count,1_000_000)})).filter(item=>item.context)}},
  audit:{verified:input.audit.verified===true,entries:bounded(input.audit.entries),files:bounded(input.audit.files,10_000),headHash:/^[a-f0-9]{64}$/i.test(input.audit.headHash)?input.audit.headHash.toLowerCase():''},
  performance:{generatedAtUtc:clean(performance.generatedAtUtc,50),networkRoot:performance.networkRoot===true,operations:(performance.operations??[]).slice(0,100).map(item=>({operation:clean(item.operation,100),runs:bounded(item.runs),averageMs:bounded(item.averageMs,86_400_000),p50Ms:bounded(item.p50Ms,86_400_000),p95Ms:bounded(item.p95Ms,86_400_000),maximumMs:bounded(item.maximumMs,86_400_000),...(item.averagePreparationMs===undefined?{}:{averagePreparationMs:bounded(item.averagePreparationMs,86_400_000)}),...(item.averageTransferMs===undefined?{}:{averageTransferMs:bounded(item.averageTransferMs,86_400_000)}),...(item.averageFinalizationMs===undefined?{}:{averageFinalizationMs:bounded(item.averageFinalizationMs,86_400_000)}),...(item.averageBytesTransferred===undefined?{}:{averageBytesTransferred:bounded(item.averageBytesTransferred,10_000_000_000)}),...(item.averageBytesPerSecond===undefined?{}:{averageBytesPerSecond:bounded(item.averageBytesPerSecond,10_000_000_000)})})).filter(item=>item.operation),backupPending:performance.backupPending===true,watcherBaselined:performance.watcherBaselined===true,watcherOverflowed:performance.watcherOverflowed===true,dirtyOrganizationCount:bounded(performance.dirtyOrganizationCount,100_000),syncIndexShards:bounded(performance.syncIndexShards,100_000),databaseShards:bounded(performance.databaseShards,100_000),publicationIndexShards:bounded(performance.publicationIndexShards,100_000),manifestStorageFormat:clean(performance.manifestStorageFormat,100),localReadCacheAvailable:performance.localReadCacheAvailable===true,backupCompression:clean(performance.backupCompression,100),auditCheckpointAvailable:performance.auditCheckpointAvailable===true},
  privacyNotice:'Sanitized diagnostic data only. User names, email addresses, evidence filenames, file paths, document contents, and audit-entry text are excluded.',
 };
 if(!record.applicationVersion||!record.ruleSetVersion)throw new Error('The diagnostic bundle version identity is incomplete.');
 return{record,recordSha256:await sha256Bytes(new TextEncoder().encode(JSON.stringify(record)))};
}
