export const backupSnapshotLimit=30;

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
export function checksumFilename(filename:string){return `${filename}.sha256`}
export function staleSnapshotNames(names:string[],limit=backupSnapshotLimit){return [...names].sort().reverse().slice(limit)}

export async function buildBackupSnapshot(database:BackupDatabase,created=new Date().toISOString()){
 const contentHash=await sha256Hex(JSON.stringify({systems:database.systems,users:database.users}));
 const envelope:BackupEnvelope={backupVersion:1,created,contentHash,database:{...database,updated:created}};
 const text=JSON.stringify(envelope,null,2),integrityHash=await sha256Hex(text),filename=backupFilename(created);
 return{envelope,text,integrityHash,filename,checksumText:`${integrityHash}  ${filename}\n`};
}

export function checksumFromText(text:string,filename:string){
 const match=text.trim().match(/^([a-f0-9]{64})\s+(.+)$/i);
 return match&&match[2]===filename?match[1].toLowerCase():undefined;
}

export async function verifyBackupSnapshot(text:string,expectedIntegrityHash:string){
 if(!/^[a-f0-9]{64}$/i.test(expectedIntegrityHash))throw new Error('The backup checksum file is invalid.');
 if((await sha256Hex(text))!==expectedIntegrityHash.toLowerCase())throw new Error('The backup SHA-256 integrity check failed.');
 const value=JSON.parse(text) as Partial<BackupEnvelope>;
 if(value.backupVersion!==1||typeof value.created!=='string'||typeof value.contentHash!=='string'||!value.database||value.database.version!==2||!Array.isArray(value.database.systems)||!Array.isArray(value.database.users))throw new Error('The backup format is invalid.');
 const contentHash=await sha256Hex(JSON.stringify({systems:value.database.systems,users:value.database.users}));
 if(contentHash!==value.contentHash)throw new Error('The backup content hash does not match its records.');
 return value as BackupEnvelope;
}
