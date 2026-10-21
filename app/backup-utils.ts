import {Gunzip,gzipSync} from 'fflate';
import {currentManifestVersion} from './data-migrations.ts';

export const backupSnapshotLimit=30;
const maximumBackupBytes=50*1024*1024;

export type BackupDatabase={version:number;updated:string;systems:unknown[];users:unknown[]};
export type BackupEnvelope={backupVersion:1;created:string;contentHash:string;database:BackupDatabase};

const encoder=new TextEncoder();

export async function sha256Hex(value:string){
 const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(value));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function sha256Bytes(value:Uint8Array){
 const copy=new Uint8Array(value.byteLength);copy.set(value);
 const digest=await globalThis.crypto.subtle.digest('SHA-256',copy.buffer);
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function backupFilename(created:string){return `user-tracker-${created.replace(/[:.]/g,'-')}.json`}
export function compressedBackupFilename(created:string){return `${backupFilename(created)}.gz`}
export function checksumFilename(filename:string){return `${filename}.sha256`}
export function staleSnapshotNames(names:string[],limit=backupSnapshotLimit){return [...names].sort().reverse().slice(limit)}

export async function buildBackupSnapshot(database:BackupDatabase,created=new Date().toISOString()){
 const contentHash=await sha256Hex(JSON.stringify({systems:database.systems,users:database.users}));
 const envelope:BackupEnvelope={backupVersion:1,created,contentHash,database:{...database,updated:created}};
 const text=JSON.stringify(envelope,null,2),integrityHash=await sha256Hex(text),filename=backupFilename(created);
 return{envelope,text,integrityHash,filename,checksumText:`${integrityHash}  ${filename}\n`};
}

export async function buildCompressedBackupSnapshot(database:BackupDatabase,created=new Date().toISOString()){
 const snapshot=await buildBackupSnapshot(database,created),bytes=gzipSync(encoder.encode(snapshot.text),{level:6}),filename=compressedBackupFilename(created),integrityHash=await sha256Bytes(bytes);
 return{...snapshot,bytes,integrityHash,filename,checksumText:`${integrityHash}  ${filename}\n`};
}

export function checksumFromText(text:string,filename:string){
 const match=text.trim().match(/^([a-f0-9]{64})\s+(.+)$/i);
 return match&&match[2]===filename?match[1].toLowerCase():undefined;
}

export async function verifyBackupSnapshot(text:string,expectedIntegrityHash:string){
 if(!/^[a-f0-9]{64}$/i.test(expectedIntegrityHash))throw new Error('The backup checksum file is invalid.');
 if((await sha256Hex(text))!==expectedIntegrityHash.toLowerCase())throw new Error('The backup SHA-256 integrity check failed.');
 return validateBackupEnvelope(text);
}

async function validateBackupEnvelope(text:string){
 const value=JSON.parse(text) as Partial<BackupEnvelope>;
 if(value.backupVersion!==1||typeof value.created!=='string'||typeof value.contentHash!=='string'||!value.database||![2,currentManifestVersion].includes(value.database.version)||!Array.isArray(value.database.systems)||!Array.isArray(value.database.users))throw new Error('The backup format is invalid.');
 const contentHash=await sha256Hex(JSON.stringify({systems:value.database.systems,users:value.database.users}));
 if(contentHash!==value.contentHash)throw new Error('The backup content hash does not match its records.');
 return value as BackupEnvelope;
}

function boundedGunzip(bytes:Uint8Array){
 let total=0;const chunks:Uint8Array[]=[],gunzip=new Gunzip((chunk)=>{total+=chunk.byteLength;if(total>maximumBackupBytes)throw new Error('The decompressed backup exceeds the 50 MB safety limit.');chunks.push(chunk)});
 gunzip.push(bytes,true);
 const clear=new Uint8Array(total);let offset=0;for(const chunk of chunks){clear.set(chunk,offset);offset+=chunk.byteLength}return clear;
}

export async function verifyStoredBackupSnapshot(bytes:Uint8Array,filename:string,expectedIntegrityHash:string){
 if(!/^[a-f0-9]{64}$/i.test(expectedIntegrityHash))throw new Error('The backup checksum file is invalid.');
 if((await sha256Bytes(bytes))!==expectedIntegrityHash.toLowerCase())throw new Error('The backup SHA-256 integrity check failed.');
 let clear=bytes;
 if(filename.toLowerCase().endsWith('.json.gz')){
  try{clear=boundedGunzip(bytes)}catch(error){if(error instanceof Error&&error.message.includes('50 MB safety limit'))throw error;throw new Error('The compressed backup could not be decompressed.')}
 }
 if(clear.byteLength<=0||clear.byteLength>maximumBackupBytes)throw new Error('The backup is empty or exceeds the 50 MB safety limit.');
 let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(clear)}catch{throw new Error('The backup is not valid UTF-8 JSON.')}
 return validateBackupEnvelope(text);
}
