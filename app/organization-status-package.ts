import {sha256Bytes} from './backup-utils.ts';

export const organizationStatusPackageFormat='RAPTOR Organization Status';
export const organizationStatusPackageVersion=1;
export const encryptedOrganizationStatusPackageFormat='RAPTOR Encrypted Organization Status';
export const encryptedOrganizationStatusPackageVersion=1;
export const organizationStatusKdfIterations=600_000;

export type OrganizationStatusArtifact={kind:string;filename:string};
export type OrganizationStatusException={artifact:string;reason:string;expiresOn:string};
export type OrganizationStatusUser={id:string;last:string;first:string;middle:string;email:string;disabled:boolean;roles:string[];privilegedTypes:string[];artifacts:OrganizationStatusArtifact[];exceptions:OrganizationStatusException[]};
export type OrganizationStatusPayload={format:typeof organizationStatusPackageFormat;version:typeof organizationStatusPackageVersion;generatedAtUtc:string;applicationVersion:string;ruleSetVersion:string;system:{id:string;name:string;type:string};organization:string;users:OrganizationStatusUser[]};
export type OrganizationStatusPackage={payload:OrganizationStatusPayload;contentSha256:string};
export type EncryptedOrganizationStatusPackage={format:typeof encryptedOrganizationStatusPackageFormat;version:typeof encryptedOrganizationStatusPackageVersion;kdf:{name:'PBKDF2';hash:'SHA-256';iterations:number;salt:string};cipher:{name:'AES-GCM';iv:string};ciphertext:string};

const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const textArray=(value:unknown,maxItems:number,maxLength:number)=>Array.isArray(value)?Array.from(new Set(value.slice(0,maxItems).map(item=>clean(item,maxLength)).filter(Boolean))):[];

export async function createOrganizationStatusPackage(payload:OrganizationStatusPayload):Promise<OrganizationStatusPackage>{
 return{payload,contentSha256:await sha256Bytes(new TextEncoder().encode(JSON.stringify(payload)))};
}

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const bytesToBase64=(bytes:Uint8Array)=>{let binary='';for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(binary)};
const base64ToBytes=(value:string,maxBytes:number)=>{if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length>Math.ceil(maxBytes/3)*4+4)throw new Error('The encrypted organization status package contains invalid binary data.');const binary=atob(value),bytes=new Uint8Array(binary.length);if(bytes.length>maxBytes)throw new Error('The encrypted organization status package exceeds its safety limit.');for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return bytes};
const validatePassphrase=(value:string)=>{if(value.length<12||value.length>1024)throw new Error('Use a passphrase between 12 and 1,024 characters. Share it separately from the exported status package.');return value};
async function statusEncryptionKey(passphrase:string,salt:Uint8Array,usages:KeyUsage[]){const material=await crypto.subtle.importKey('raw',encoder.encode(validatePassphrase(passphrase)),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(salt),iterations:organizationStatusKdfIterations},material,{name:'AES-GCM',length:256},false,usages)}

export async function createEncryptedOrganizationStatusPackage(payload:OrganizationStatusPayload,passphrase:string):Promise<EncryptedOrganizationStatusPackage>{
 const clear=encoder.encode(JSON.stringify(await createOrganizationStatusPackage(payload)));if(clear.byteLength>25*1024*1024)throw new Error('The organization status package exceeds the 25 MB safety limit.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await statusEncryptionKey(passphrase,salt,['encrypt']),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:encoder.encode(encryptedOrganizationStatusPackageFormat)},key,clear);
 return{format:encryptedOrganizationStatusPackageFormat,version:encryptedOrganizationStatusPackageVersion,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:organizationStatusKdfIterations,salt:bytesToBase64(salt)},cipher:{name:'AES-GCM',iv:bytesToBase64(iv)},ciphertext:bytesToBase64(new Uint8Array(ciphertext))};
}

export function organizationStatusPackageRequiresPassphrase(text:string){
 if(new TextEncoder().encode(text).byteLength>35*1024*1024)return false;
 try{return(JSON.parse(text) as{format?:unknown}).format===encryptedOrganizationStatusPackageFormat}catch{return false}
}

export async function parseOrganizationStatusPackage(text:string,passphrase=''):Promise<OrganizationStatusPackage>{
 if(new TextEncoder().encode(text).byteLength>35*1024*1024)throw new Error('The organization status file exceeds the 35 MB safety limit.');
 let input:unknown;try{input=JSON.parse(text)}catch{throw new Error('The selected file is not valid JSON.');}
 if(!input||typeof input!=='object')throw new Error('The selected file is not a R.A.P.T.O.R. organization status package.');
 const encrypted=input as Partial<EncryptedOrganizationStatusPackage>;
 if(encrypted.format===encryptedOrganizationStatusPackageFormat){
  if(encrypted.version!==encryptedOrganizationStatusPackageVersion||encrypted.kdf?.name!=='PBKDF2'||encrypted.kdf.hash!=='SHA-256'||encrypted.kdf.iterations!==organizationStatusKdfIterations||encrypted.cipher?.name!=='AES-GCM'||typeof encrypted.kdf.salt!=='string'||typeof encrypted.cipher.iv!=='string'||typeof encrypted.ciphertext!=='string')throw new Error('The encrypted organization status package format is invalid.');
  if(!passphrase)throw new Error('This organization status package is encrypted. Enter its passphrase to continue.');
  try{const salt=base64ToBytes(encrypted.kdf.salt,32),iv=base64ToBytes(encrypted.cipher.iv,32),ciphertext=base64ToBytes(encrypted.ciphertext,35*1024*1024),key=await statusEncryptionKey(passphrase,salt,['decrypt']),clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:encoder.encode(encryptedOrganizationStatusPackageFormat)},key,ciphertext);return parseOrganizationStatusPackage(decoder.decode(clear))}catch(error){if(error instanceof Error&&/passphrase between/.test(error.message))throw error;throw new Error('The encrypted organization status package could not be opened. Confirm the passphrase and file integrity.')}
 }
 const record=input as Record<string,unknown>,raw=record.payload;if(!raw||typeof raw!=='object')throw new Error('The organization status payload is missing.');
 const value=raw as Record<string,unknown>,system=value.system as Record<string,unknown>|undefined,rawUsers=value.users;
 if(value.format!==organizationStatusPackageFormat||value.version!==organizationStatusPackageVersion||!system||!Array.isArray(rawUsers)||rawUsers.length>100000)throw new Error('The organization status package format or record count is invalid.');
 const organization=clean(value.organization,200),generatedAtUtc=clean(value.generatedAtUtc,50),generated=Date.parse(generatedAtUtc);if(!organization||!Number.isFinite(generated))throw new Error('The organization or generation time is invalid.');
 const users:OrganizationStatusUser[]=rawUsers.map((item,index)=>{if(!item||typeof item!=='object')throw new Error(`User record ${index+1} is invalid.`);const user=item as Record<string,unknown>,last=clean(user.last,100),first=clean(user.first,100),email=clean(user.email,254),artifacts=Array.isArray(user.artifacts)?user.artifacts.slice(0,100).map((artifact,artifactIndex)=>{if(!artifact||typeof artifact!=='object')throw new Error(`Artifact ${artifactIndex+1} for user ${index+1} is invalid.`);const evidence=artifact as Record<string,unknown>,kind=clean(evidence.kind,100),filename=clean(evidence.filename,500);if(!kind||!filename)throw new Error(`Artifact ${artifactIndex+1} for user ${index+1} is incomplete.`);return{kind,filename}}):[],exceptions=Array.isArray(user.exceptions)?user.exceptions.slice(0,100).map(entry=>{const exception=entry as Record<string,unknown>;return{artifact:clean(exception.artifact,100),reason:clean(exception.reason,500),expiresOn:clean(exception.expiresOn,20)}}).filter(entry=>entry.artifact&&entry.reason&&entry.expiresOn):[];if(!last||!first)throw new Error(`User record ${index+1} is missing a name.`);return{id:clean(user.id,100)||`imported-${index+1}`,last,first,middle:clean(user.middle,20),email,disabled:user.disabled===true,roles:textArray(user.roles,10,100),privilegedTypes:textArray(user.privilegedTypes,50,100),artifacts,exceptions}});
 const payload:OrganizationStatusPayload={format:organizationStatusPackageFormat,version:organizationStatusPackageVersion,generatedAtUtc:new Date(generated).toISOString(),applicationVersion:clean(value.applicationVersion,50),ruleSetVersion:clean(value.ruleSetVersion,100),system:{id:clean(system.id,100),name:clean(system.name,200),type:clean(system.type,200)},organization,users};if(!payload.system.id||!payload.system.name)throw new Error('The information-system identity is invalid.');
 const expected=await sha256Bytes(new TextEncoder().encode(JSON.stringify(payload))),actual=clean(record.contentSha256,64).toLowerCase();if(actual!==expected)throw new Error('The organization status file failed its SHA-256 integrity check. Export it again from the authoritative R.A.P.T.O.R. database.');
 return{payload,contentSha256:actual};
}
