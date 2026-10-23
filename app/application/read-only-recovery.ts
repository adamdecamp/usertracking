export type ReadOnlyRecoveryCategory='availability'|'exclusive-access'|'database-integrity'|'audit-integrity'|'compatibility'|'local-workspace'|'unknown';

export type ReadOnlyRecovery={
 systemId:string;
 context:string;
 detail:string;
 category:ReadOnlyRecoveryCategory;
 title:string;
 guidance:string;
 retryLabel:string;
 backupRestoreAvailable:boolean;
};

function recoveryDetail(error:unknown){return error instanceof Error?error.message:typeof error==='string'?error:'The original failure did not provide additional detail.'}

export function readOnlyRecoveryFor(systemId:string,context:string,error:unknown):ReadOnlyRecovery{
 const detail=recoveryDetail(error),combined=`${context} ${detail}`;
 if(/audit|hash chain|chain head|signature receipt/i.test(combined))return{systemId,context,detail,category:'audit-integrity',title:'Audit Integrity Requires Attention',guidance:'The audit chain must be repaired or independently reviewed before Full Access can reopen. A database backup cannot replace audit history.',retryLabel:'Verify Audit And Retry',backupRestoreAvailable:false};
 if(/schema|database version|client version|requires (?:a )?newer|unsupported version|incompatible/i.test(combined))return{systemId,context,detail,category:'compatibility',title:'Application Update Required',guidance:'Use the current approved R.A.P.T.O.R. release, then retry. This version will not overwrite records created by a newer client.',retryLabel:'Retry After Updating',backupRestoreAvailable:false};
 if(/another operator|exclusive|editor lease|lease.*(?:owned|held|acquire)|in use/i.test(combined))return{systemId,context,detail,category:'exclusive-access',title:'Another Editor Has Full Access',guidance:'Read-Only lookup can continue. Retry after the other operator commits or ends the Full Access session.',retryLabel:'Retry Full Access',backupRestoreAvailable:false};
 if(/protected local|local workspace|decrypt|windows account|dpapi|local working database/i.test(combined))return{systemId,context,detail,category:'local-workspace',title:'Protected Local Workspace Requires Attention',guidance:'Keep the workspace preserved. Retry after confirming the same Windows account is in use, or use the dedicated legacy-workspace recovery when it is offered.',retryLabel:'Retry Protected Workspace',backupRestoreAvailable:false};
 if(/network|vpn|shared folder|unavailable|offline|failed to fetch|timed? out|stopped responding|connection|path.*(?:missing|not found)|file system/i.test(combined))return{systemId,context,detail,category:'availability',title:'Shared Storage Is Unavailable',guidance:'Protected cached status remains available. Confirm the mapped drive or VPN is connected, then retry the verified Full Access check.',retryLabel:'Retry Shared Connection',backupRestoreAvailable:false};
 if(/database|manifest|checksum|sha-?256|snapshot|backup|content hash|integrity|malformed|invalid data/i.test(combined))return{systemId,context,detail,category:'database-integrity',title:'Database Integrity Requires Recovery',guidance:'Retry verification first. If it still fails, select and drill a verified snapshot before restoring it under an exclusive editor lease.',retryLabel:'Verify And Retry Full Access',backupRestoreAvailable:true};
 return{systemId,context,detail,category:'unknown',title:'Full Access Could Not Be Verified',guidance:'Read-Only lookup remains available. Retry the controlled verification; the failure will remain in the daily error report.',retryLabel:'Retry Full Access',backupRestoreAvailable:false};
}
