import {migrateManifestPayload} from '../data-migrations';
import {artifactKinds,canonicalArtifactKind} from '../filename-utils';
import {validManifestArtifactPath} from '../manifest-validation';
import {normalizePrivilegedTypes} from '../privileged-type-utils';
import {normalizeAffiliatedOrganizations} from '../affiliated-organization-utils';
import type {Artifact,ChangeRecord,ComplianceException,SystemRecord,TrackerDatabase,UserRecord} from '../domain/tracker-models';

function stringArray(value:unknown):value is string[]{return Array.isArray(value)&&value.every(item=>typeof item==='string')}
const boundedString=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max;

/** Decode and canonicalize an untrusted persisted tracker manifest. */
export function decodeTrackerManifest(value:unknown):TrackerDatabase|undefined{
 const migrated=migrateManifestPayload(value);if(!migrated)return;
 const raw=migrated as{systems?:unknown;users?:unknown};
 if(!Array.isArray(raw.systems)||!Array.isArray(raw.users)||raw.systems.length>1000||raw.users.length>100000)return;
 const systems:SystemRecord[]=[];
 for(const item of raw.systems){
  if(!item||typeof item!=='object')return;
  const s=item as Partial<SystemRecord>;
  if(!boundedString(s.id,100)||!boundedString(s.name,200)||!boundedString(s.type,200)||!boundedString(s.organization,200)||typeof s.archived!=='boolean')return;
  systems.push({id:s.id,name:s.name,type:s.type,organization:s.organization,archived:s.archived});
 }
 const ids=new Set(systems.map(system=>system.id)),users:UserRecord[]=[];
 for(const item of raw.users){
  if(!item||typeof item!=='object')return;
  const u=item as Partial<UserRecord>;
  const validUsernames=u.privilegedUsernames===undefined||(stringArray(u.privilegedUsernames)&&u.privilegedUsernames.length<=50&&u.privilegedUsernames.every(username=>username.length<=200));
  if(!boundedString(u.id,100)||!boundedString(u.systemId,100)||!ids.has(u.systemId)||!boundedString(u.organization,200)||!stringArray(u.affiliatedOrganizations)||u.affiliatedOrganizations.length>50||u.affiliatedOrganizations.some(value=>value.length>200)||!boundedString(u.last,100)||!boundedString(u.first,100)||!boundedString(u.middle,10)||!boundedString(u.email,254)||typeof u.disabled!=='boolean'||!stringArray(u.roles)||u.roles.length>20||u.roles.some(role=>!['General','Privileged','DTA'].includes(role))||!validUsernames||!stringArray(u.privilegedTypes)||u.privilegedTypes.length>50||u.privilegedTypes.some(type=>type.length>200)||!Array.isArray(u.artifacts)||u.artifacts.length>100)return;
  const artifacts:Artifact[]=[];
  for(const artifact of u.artifacts){
   if(!artifact||typeof artifact!=='object')return;
   const a=artifact as Partial<Artifact>;
   if(!boundedString(a.kind,100)||!boundedString(a.filename,500))return;
   if((a.sha256!==undefined&&(typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(a.sha256)))||(a.path!==undefined&&!validManifestArtifactPath(a.path))||(a.storedAt!==undefined&&!boundedString(a.storedAt,50))||(a.storedBy!==undefined&&!boundedString(a.storedBy,500))||(a.source!==undefined&&!['Manual Add','Manual Update','Sync'].includes(a.source)))return;
   artifacts.push({kind:canonicalArtifactKind(a.kind),filename:a.filename,sha256:a.sha256,path:a.path,storedAt:a.storedAt,storedBy:a.storedBy,source:a.source});
  }
  const legacyDta=u.roles.includes('DTA'),roles=Array.from(new Set(u.roles.map(role=>role==='DTA'?'Privileged':role))),privilegedUsernames=roles.includes('Privileged')?(u.privilegedUsernames??[]):[],derivedTypes=normalizePrivilegedTypes(privilegedUsernames.map(value=>{const separator=value.lastIndexOf('_');return separator>0&&separator<value.length-1?value.slice(separator+1):''})),privilegedTypes=roles.includes('Privileged')?normalizePrivilegedTypes([...u.privilegedTypes,...derivedTypes,...(legacyDta?['DTA']:[])]):[];
  const changes=Array.isArray(u.changes)&&u.changes.length<=10000?u.changes.filter((change):change is ChangeRecord=>!!change&&typeof change==='object'&&boundedString((change as ChangeRecord).timestamp,50)&&boundedString((change as ChangeRecord).actor,500)&&boundedString((change as ChangeRecord).action,500)&&boundedString((change as ChangeRecord).description,500)&&stringArray((change as ChangeRecord).rolesBefore)&&(change as ChangeRecord).rolesBefore.length<=20&&stringArray((change as ChangeRecord).rolesAfter)&&(change as ChangeRecord).rolesAfter.length<=20&&stringArray((change as ChangeRecord).files)&&(change as ChangeRecord).files.length<=100):[];
  const exceptions=Array.isArray(u.exceptions)&&u.exceptions.length<=1000?u.exceptions.filter((exception):exception is ComplianceException=>!!exception&&typeof exception==='object'&&boundedString((exception as ComplianceException).id,100)&&boundedString((exception as ComplianceException).artifact,100)&&artifactKinds.includes(canonicalArtifactKind((exception as ComplianceException).artifact))&&boundedString((exception as ComplianceException).reason,500)&&boundedString((exception as ComplianceException).approvedBy,200)&&boundedString((exception as ComplianceException).createdAt,50)&&boundedString((exception as ComplianceException).createdBy,500)&&/^\d{4}-\d{2}-\d{2}$/.test((exception as ComplianceException).expiresOn)&&((exception as ComplianceException).revokedAt===undefined||boundedString((exception as ComplianceException).revokedAt,50))&&((exception as ComplianceException).revokedBy===undefined||boundedString((exception as ComplianceException).revokedBy,500))).map(exception=>({...exception,artifact:canonicalArtifactKind(exception.artifact)})):[];
  users.push({id:u.id,systemId:u.systemId,organization:u.organization,affiliatedOrganizations:normalizeAffiliatedOrganizations(u.affiliatedOrganizations),last:u.last,first:u.first,middle:u.middle,email:u.email,disabled:u.disabled,roles,privilegedUsernames,privilegedTypes,artifacts,changes,exceptions});
 }
 return{systems,users};
}

export function stripDemoData(data:TrackerDatabase):TrackerDatabase{
 const demoSystemIds=new Set(data.systems.filter(system=>['atlas','sentinel','legacy'].includes(system.id)||['Atlas Operations Network','Sentinel Records Environment','Legacy Personnel Portal'].includes(system.name)).map(system=>system.id)),systems=data.systems.filter(system=>!demoSystemIds.has(system.id)),validSystems=new Set(systems.map(system=>system.id)),users=data.users.filter(user=>validSystems.has(user.systemId)&&!['u1','u2','u3','u4'].includes(user.id));
 return{systems,users};
}
