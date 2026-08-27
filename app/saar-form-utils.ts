import {decodePDFRawStream,PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFRawStream,PDFString,PDFTextField} from 'pdf-lib';

const clean=(value:string,max=500)=>value.replace(/<[^>]*>/g,' ').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalizedName=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();

export type SaarIdentity={last:string;first:string;middle?:string};
export type SaarFormFields={fillable:boolean;format?:'AcroForm'|'XFA';identity?:SaarIdentity;organization?:string;email?:string};

export function parseSaarName(value:string):SaarIdentity|undefined{
 const source=clean(value,300);if(!source)return;
 let last='',first='',middle='';
 if(source.includes(',')){
  const[rawLast,...rest]=source.split(','),remaining=rest.join(' ').trim().split(/\s+/).filter(Boolean);
  last=clean(rawLast,100);first=clean(remaining.shift()??'',100);middle=clean(remaining.shift()??'',10).slice(0,1)
 }else{
  const parts=source.split(/\s+/).filter(Boolean);last=clean(parts.shift()??'',100);first=clean(parts.shift()??'',100);middle=clean(parts.shift()??'',10).slice(0,1)
 }
 if(!last||!first||last.toUpperCase()==='LAST'||first.toUpperCase()==='FIRST')return;
 return{last,first,...(middle?{middle}:{})}
}

function fieldKind(name:string):'name'|'organization'|'email'|undefined{
 const normalized=normalizedName(name);
 if(normalized==='1 NAME LAST FIRST MIDDLE INITIAL'||normalized==='1 NAME'||normalized==='NAME1')return'name';
 if(normalized==='2 ORGANIZATION'||normalized==='ORGANIZATION2')return'organization';
 if(normalized==='4 OFFICIAL EMAIL ADDRESS'||normalized==='5 OFFICIAL E MAIL ADDRESS'||normalized==='EMAIL ADDRESS5')return'email';
}

function decodeXml(value:string){
 return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/&#(\d+);/g,(_,decimal)=>String.fromCodePoint(Number.parseInt(decimal,10))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')
}

function xmlValue(xml:string,names:string[]){
 for(const name of names){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\s*>`,'i'),match=xml.match(pattern);
  if(match){const value=clean(decodeXml(match[1]),500);if(value)return value}
 }
}

function xfaDatasets(pdf:PDFDocument){
 const acro=pdf.catalog.lookup(PDFName.of('AcroForm')),xfa=acro instanceof PDFDict?acro.lookup(PDFName.of('XFA')):undefined;
 if(!(xfa instanceof PDFArray)&&!(xfa instanceof PDFRawStream))return{present:false as const};
 try{
  if(xfa instanceof PDFArray){
   for(let index=0;index+1<xfa.size();index+=2){
    const label=xfa.lookup(index),stream=xfa.lookup(index+1);
    if(!((label instanceof PDFString||label instanceof PDFHexString)&&label.decodeText().toLowerCase()==='datasets')||!(stream instanceof PDFRawStream))continue;
    const bytes=decodePDFRawStream(stream).decode();
    if(bytes.length>5*1024*1024)throw new Error('The XFA datasets packet exceeds the safety limit.');
    return{present:true as const,xml:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
   }
  }else if(xfa instanceof PDFRawStream){
   const bytes=decodePDFRawStream(xfa).decode();
   if(bytes.length>5*1024*1024)throw new Error('The XFA packet exceeds the safety limit.');
   return{present:true as const,xml:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
  }
 }catch{return{present:true as const}}
 return{present:true as const}
}

export async function readSaarFormFields(pdfBytes:Uint8Array):Promise<SaarFormFields>{
 const pdf=await PDFDocument.load(pdfBytes,{ignoreEncryption:false,updateMetadata:false});
 const xfa=xfaDatasets(pdf);
 if(xfa.present){
  if(!xfa.xml)return{fillable:false};
  const name=xmlValue(xfa.xml,['name1']),organization=xmlValue(xfa.xml,['Organization2']),email=xmlValue(xfa.xml,['Email_Address5']);
  return{fillable:true,format:'XFA',identity:name?parseSaarName(name):undefined,organization:organization?clean(organization,200):undefined,email:email?clean(email,254):undefined}
 }
 const values:Partial<Record<'name'|'organization'|'email',string>>={};
 try{
  const fields=pdf.getForm().getFields();
  for(const field of fields){
   if(!(field instanceof PDFTextField))continue;
   const kind=fieldKind(field.getName());if(!kind||values[kind])continue;
   const value=clean(field.getText()??'',500);if(value)values[kind]=value
  }
  if(fields.length>0)return{fillable:true,format:'AcroForm',identity:values.name?parseSaarName(values.name):undefined,organization:values.organization?clean(values.organization,200):undefined,email:values.email?clean(values.email,254):undefined}
 }catch{}
 return{fillable:false}
}
