export const currentManifestVersion=2;
export const currentBackupVersion=1;
export const currentAuditVersion=1;
export const currentSyncIndexVersion=1;

type JsonRecord=Record<string,unknown>;
const record=(value:unknown):value is JsonRecord=>!!value&&typeof value==='object'&&!Array.isArray(value);
const clone=<T>(value:T):T=>structuredClone(value);

export function migrateManifestPayload(value:unknown):JsonRecord|undefined{
 if(!record(value))return;
 const input=clone(value),version=typeof input.version==='number'?input.version:1;
 if(version<1||version>currentManifestVersion)return;
 if(version===1){
  if(!Array.isArray(input.systems)||!Array.isArray(input.users))return;
  input.users=input.users.map(item=>record(item)?{
   ...item,
   privilegedUsernames:Array.isArray(item.privilegedUsernames)?item.privilegedUsernames:[],
   privilegedTypes:Array.isArray(item.privilegedTypes)?item.privilegedTypes:[],
   changes:Array.isArray(item.changes)?item.changes:[],
   exceptions:Array.isArray(item.exceptions)?item.exceptions:[],
  }:item);
  input.version=2;
 }
 return input;
}

export function migrateBackupPayload(value:unknown):JsonRecord|undefined{
 if(!record(value))return;
 const input=clone(value),version=typeof input.backupVersion==='number'?input.backupVersion:1;
 if(version!==currentBackupVersion||!('database'in input))return;
 const database=migrateManifestPayload(input.database);if(!database)return;
 input.database=database;input.backupVersion=currentBackupVersion;return input;
}

export function migrateAuditEntryPayload(value:unknown):JsonRecord|undefined{
 if(!record(value))return;
 const input=clone(value),version=typeof input.version==='number'?input.version:1;
 return version===currentAuditVersion?input:undefined;
}

export function migrateSyncIndexPayload(value:unknown):JsonRecord|undefined{
 if(!record(value))return;
 const input=clone(value),version=typeof input.version==='number'?input.version:1;
 return version===currentSyncIndexVersion?input:undefined;
}
