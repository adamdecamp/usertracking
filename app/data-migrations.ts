import {normalizePrivilegedTypes} from './privileged-type-utils.ts';
import {normalizeAffiliatedOrganizations} from './affiliated-organization-utils.ts';
import {applicationVersion} from './version.ts';

export const currentManifestVersion=5;
export const currentBackupVersion=1;
export const currentAuditVersion=1;
export const currentSyncIndexVersion=1;

type JsonRecord=Record<string,unknown>;
const record=(value:unknown):value is JsonRecord=>!!value&&typeof value==='object'&&!Array.isArray(value);
const clone=<T>(value:T):T=>structuredClone(value);
const versionParts=(value:string)=>/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)?value.split('.').map(Number):undefined;

export function compareApplicationVersions(left:string,right:string):number|undefined{
 const first=versionParts(left),second=versionParts(right);if(!first||!second)return;
 const length=Math.max(first.length,second.length);
 for(let index=0;index<length;index++){const difference=(first[index]??0)-(second[index]??0);if(difference)return Math.sign(difference)}
 return 0;
}

export function migrateManifestPayload(value:unknown):JsonRecord|undefined{
 if(!record(value))return;
 const input=clone(value),version=typeof input.version==='number'?input.version:1,legacyVersion=version===1;
 if(version<1||version>currentManifestVersion)return;
 if(version===1){
  if(!Array.isArray(input.systems)||!Array.isArray(input.users))return;
  input.version=2;
 }
 if(version<=4){input.minimumApplicationVersion=applicationVersion;input.lastWriterVersion=applicationVersion}
 if(typeof input.minimumApplicationVersion!=='string'||typeof input.lastWriterVersion!=='string')return;
 const minimumComparison=compareApplicationVersions(input.minimumApplicationVersion,applicationVersion);
 if(minimumComparison===undefined||minimumComparison>0||compareApplicationVersions(input.lastWriterVersion,'0.0.0')===undefined)return;
 if(Array.isArray(input.users))input.users=input.users.map(item=>{
  if(!record(item))return item;
  const changes=Array.isArray(item.changes)?item.changes.map(change=>record(change)?{
   ...change,
   rolesBefore:'rolesBefore'in change?change.rolesBefore:[],
   rolesAfter:'rolesAfter'in change?change.rolesAfter:[],
   files:'files'in change?change.files:[],
  }:change):(legacyVersion||item.changes===undefined?[]:item.changes);
  return{
   ...item,
   affiliatedOrganizations:Array.isArray(item.affiliatedOrganizations)?normalizeAffiliatedOrganizations(item.affiliatedOrganizations.filter((value):value is string=>typeof value==='string')):[],
   privilegedUsernames:Array.isArray(item.privilegedUsernames)?item.privilegedUsernames:(legacyVersion?[]:item.privilegedUsernames),
   privilegedTypes:Array.isArray(item.privilegedTypes)?normalizePrivilegedTypes(item.privilegedTypes.filter((value):value is string=>typeof value==='string')):(legacyVersion?[]:item.privilegedTypes),
   changes,
   exceptions:Array.isArray(item.exceptions)?item.exceptions:(legacyVersion?[]:item.exceptions),
   extractionProvenance:record(item.extractionProvenance)?item.extractionProvenance:{},
  };
 });
 input.version=currentManifestVersion;
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
