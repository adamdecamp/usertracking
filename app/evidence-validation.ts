import {unzipSync} from 'fflate';

export const evidenceFileLimit=100*1024*1024;
const zipEntryLimit=8,zipExpansionRatioLimit=200;
const textDecoder=new TextDecoder('utf-8',{fatal:true});

export type InspectedEvidence={kind:'pdf'|'zip';pdfName:string;pdfBytes:Uint8Array};

function hasSequence(bytes:Uint8Array,sequence:Uint8Array,start:number,end:number){
 for(let offset=start;offset<=end-sequence.length;offset++){
  let matches=true;
  for(let index=0;index<sequence.length;index++)if(bytes[offset+index]!==sequence[index]){matches=false;break}
  if(matches)return true;
 }
 return false
}

function validatePdf(name:string,bytes:Uint8Array){
 if(bytes.length<16||bytes.length>evidenceFileLimit)throw new Error(`${name} is empty or exceeds the 100 MB evidence limit.`);
 const header=new Uint8Array([0x25,0x50,0x44,0x46,0x2d]),eof=new Uint8Array([0x25,0x25,0x45,0x4f,0x46]);
 if(!hasSequence(bytes,header,0,Math.min(bytes.length,1024)))throw new Error(`${name} does not contain a valid PDF header.`);
 if(!hasSequence(bytes,eof,Math.max(0,bytes.length-4096),bytes.length))throw new Error(`${name} does not contain a valid PDF end marker.`)
}

function safeZipPath(name:string){
 if(!name||name.includes('\0')||name.includes('\\')||name.startsWith('/')||/^[A-Za-z]:/.test(name))return false;
 return name.split('/').every(part=>part!=='.'&&part!=='..')
}

function centralEntries(bytes:Uint8Array){
 if(bytes.length<22||bytes.length>evidenceFileLimit)throw new Error('The ZIP is empty or exceeds the 100 MB evidence limit.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),minimum=Math.max(0,bytes.length-65557);let end=-1;
 for(let offset=bytes.length-22;offset>=minimum;offset--)if(view.getUint32(offset,true)===0x06054b50){end=offset;break}
 if(end<0)throw new Error('The ZIP end record is missing.');
 const disk=view.getUint16(end+4,true),centralDisk=view.getUint16(end+6,true),diskEntries=view.getUint16(end+8,true),entryCount=view.getUint16(end+10,true),centralSize=view.getUint32(end+12,true),centralOffset=view.getUint32(end+16,true);
 if(disk!==0||centralDisk!==0||diskEntries!==entryCount)throw new Error('Multi-volume ZIP files are not accepted.');
 if(entryCount===0||entryCount===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff)throw new Error('Empty and ZIP64 archives are not accepted.');
 if(entryCount>zipEntryLimit)throw new Error(`ZIP files may contain at most ${zipEntryLimit} entries.`);
 if(centralOffset+centralSize>end||centralOffset<0)throw new Error('The ZIP directory is invalid.');
 const entries:{name:string;compressed:number;uncompressed:number;directory:boolean}[]=[];let offset=centralOffset;
 for(let index=0;index<entryCount;index++){
  if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw new Error('The ZIP directory is malformed.');
  const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),compressed=view.getUint32(offset+20,true),uncompressed=view.getUint32(offset+24,true),nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),next=offset+46+nameLength+extraLength+commentLength;
  if(next>bytes.length)throw new Error('The ZIP entry metadata is truncated.');
  if((flags&1)!==0)throw new Error('Password-protected or encrypted ZIP files are not accepted.');
  if(method!==0&&method!==8)throw new Error('The ZIP uses an unsupported compression method.');
  let name:string;try{name=textDecoder.decode(bytes.subarray(offset+46,offset+46+nameLength))}catch{throw new Error('The ZIP contains an invalid entry name.')}
  if(!safeZipPath(name))throw new Error('The ZIP contains an unsafe entry path.');
  if(compressed>evidenceFileLimit||uncompressed>evidenceFileLimit)throw new Error('A ZIP entry exceeds the 100 MB evidence limit.');
  if(uncompressed>1024*1024&&uncompressed/Math.max(1,compressed)>zipExpansionRatioLimit)throw new Error('The ZIP expansion ratio exceeds the safety limit.');
  entries.push({name,compressed,uncompressed,directory:name.endsWith('/')});offset=next
 }
 if(offset!==centralOffset+centralSize)throw new Error('The ZIP directory length is inconsistent.');
 return entries
}

export function inspectEvidenceBytes(filename:string,bytes:Uint8Array):InspectedEvidence{
 const lower=filename.toLowerCase();
 if(lower.endsWith('.pdf')){validatePdf(filename,bytes);return{kind:'pdf',pdfName:filename,pdfBytes:bytes}}
 if(!lower.endsWith('.zip'))throw new Error(`${filename} is not accepted. Select a PDF or a ZIP containing one PDF.`);
 const entries=centralEntries(bytes),files=entries.filter(entry=>!entry.directory);
 if(files.length!==1||entries.some(entry=>!entry.directory&&!entry.name.toLowerCase().endsWith('.pdf')))throw new Error(`${filename} must contain exactly one PDF and no other files.`);
 const entry=files[0],unzipped=unzipSync(bytes),pdfBytes=unzipped[entry.name];
 if(!pdfBytes||pdfBytes.length!==entry.uncompressed)throw new Error(`${filename} could not be safely extracted.`);
 validatePdf(entry.name,pdfBytes);
 return{kind:'zip',pdfName:entry.name,pdfBytes}
}

export function acceptsEvidenceExtension(filename:string){const lower=filename.toLowerCase();return lower.endsWith('.pdf')||lower.endsWith('.zip')}
