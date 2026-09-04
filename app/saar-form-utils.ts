import {decodePDFRawStream,PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFNumber,PDFRawStream,PDFSignature,PDFString,PDFTextField,type PDFField} from 'pdf-lib';

const clean=(value:string,max=500)=>value.replace(/<[^>]*>/g,' ').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalizedName=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const emailPattern=/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;

export type SaarIdentity={last:string;first:string;middle?:string};
export type SaarFormFields={fillable:boolean;format?:'AcroForm'|'XFA';identity?:SaarIdentity;organization?:string;email?:string;requestDate?:string;createdDate?:string;disabledDate?:string;createdBySigned?:boolean;disabledBySigned?:boolean;signedFieldNames?:string[]};
export type PdfDigitalSignatureSummary={signedFieldNames:string[];createdBySigned:boolean;disabledBySigned:boolean;createdDate?:string;disabledDate?:string};

const calendarDate=(year:number,month:number,day:number)=>{const date=new Date(Date.UTC(year,month-1,day));return year>=1900&&year<=2099&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date:undefined};
const shortYear=(value:string)=>value.length===2?(+value>=70?1900+ +value:2000+ +value):+value;
const monthNames=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
export function parseSaarRequestDate(value?:string){
 const source=clean(value??'',200).toUpperCase();if(!source)return;
 const pdf=source.match(/^D:(\d{4})(\d{2})(\d{2})/),iso=source.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/),us=source.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/),dayMonth=source.match(/^(\d{1,2})[-_. ]*([A-Z]{3})[-_. ]*(\d{2}|\d{4})$/),monthDay=source.match(/^([A-Z]{3})[-_. ]*(\d{1,2})[-_. ]*(\d{2}|\d{4})$/);let parts:[number,number,number]|undefined;
 if(pdf)parts=[+pdf[1],+pdf[2],+pdf[3]];else if(iso)parts=[+iso[1],+iso[2],+iso[3]];else if(us)parts=[shortYear(us[3]),+us[1],+us[2]];else if(dayMonth&&monthNames.includes(dayMonth[2]))parts=[shortYear(dayMonth[3]),monthNames.indexOf(dayMonth[2])+1,+dayMonth[1]];else if(monthDay&&monthNames.includes(monthDay[1]))parts=[shortYear(monthDay[3]),monthNames.indexOf(monthDay[1])+1,+monthDay[2]];
 if(!parts)return;const date=calendarDate(...parts);return date?.toISOString().slice(0,10)
}

export function officialEmailFromText(text:string){
 const source=text.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\u00ad/g,'-').replace(/\s+/g,' ').slice(0,500000),labels=Array.from(source.matchAll(/\bOFFICIAL(?:\s*\/\s*ORGANIZATION)?\s+E[\s-]*MAIL(?:\s+ADDRESS)?\b/gi));
 for(const label of labels){const start=(label.index??0)+label[0].length,window=source.slice(start,start+400),match=Array.from(window.matchAll(emailPattern))[0];if(!match)continue;const before=window.slice(0,match.index??0);if(/\b(?:SUPERVISOR|SPONSOR|SECURITY\s+MANAGER|APPROVING\s+OFFICIAL)\b.{0,60}\bE[\s-]*MAIL\b/i.test(before))continue;return match[0].toLowerCase()}
}

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

function fieldKind(name:string):'name'|'organization'|'email'|'requestDate'|undefined{
 const normalized=normalizedName(name);
 if(normalized==='1 NAME LAST FIRST MIDDLE INITIAL'||normalized==='1 NAME'||normalized==='NAME1')return'name';
 if(normalized==='2 ORGANIZATION'||normalized==='ORGANIZATION2')return'organization';
 if(normalized==='4 OFFICIAL EMAIL ADDRESS'||normalized==='5 OFFICIAL E MAIL ADDRESS'||normalized==='EMAIL ADDRESS5'||/^(?:\d+ )?OFFICIAL(?: ORGANIZATION)? E ?MAIL(?: ADDRESS)?$/.test(normalized))return'email';
 if(/^(?:12A? )?(?:USER|REQUESTER)(?: SIGNATURE)? (?:SIGNED )?DATE$/.test(normalized)||normalized==='SIGNEDDATE12'||normalized==='TYPE REQUEST DATE')return'requestDate';
}

function signatureRequestDate(field:PDFSignature){
 const name=normalizedName(field.getName());if(!/^(?:12 )?USER SIGNATURE$|^REQUESTER SIGNATURE$/.test(name))return;
 const value=field.acroField.V();if(!(value instanceof PDFDict))return;const signed=value.lookup(PDFName.of('M'));return signed instanceof PDFString||signed instanceof PDFHexString?parseSaarRequestDate(signed.decodeText()):undefined
}

function signedSignature(field:PDFSignature){
 const value=field.acroField.V();if(!(value instanceof PDFDict))return;
 const byteRange=value.lookup(PDFName.of('ByteRange')),contents=value.lookup(PDFName.of('Contents'));
 if(!(byteRange instanceof PDFArray)||(contents instanceof PDFString||contents instanceof PDFHexString)===false)return;
 const ranges=byteRange.asArray().map(item=>item instanceof PDFNumber?item.asNumber():0);
 if(ranges.length<4||ranges.slice(1).every(number=>number<=0))return;
 const modified=value.lookup(PDFName.of('M')),date=modified instanceof PDFString||modified instanceof PDFHexString?parseSaarRequestDate(modified.decodeText()):undefined;
 return{name:clean(field.getName(),300),date}
}

function latestDate(values:(string|undefined)[]){return values.filter((value):value is string=>!!value).sort().at(-1)}

function signatureSummary(fields:PDFField[]):PdfDigitalSignatureSummary{
 const signed=fields.filter((field):field is PDFSignature=>field instanceof PDFSignature).map(signedSignature).filter((item):item is NonNullable<ReturnType<typeof signedSignature>>=>!!item),created=signed.filter(item=>/\bCREATED\s+BY\b|\bPROCESSED\s+BY\b/i.test(item.name)),disabled=signed.filter(item=>/\bDISABLED\s+BY\b/i.test(item.name));
 return{signedFieldNames:signed.map(item=>item.name),createdBySigned:created.length>0,disabledBySigned:disabled.length>0,createdDate:latestDate(created.map(item=>item.date)),disabledDate:latestDate(disabled.map(item=>item.date))}
}

export async function readPdfDigitalSignatures(pdfBytes:Uint8Array):Promise<PdfDigitalSignatureSummary>{
 const pdf=await PDFDocument.load(pdfBytes,{ignoreEncryption:false,updateMetadata:false});
 try{return signatureSummary(pdf.getForm().getFields())}catch{return{signedFieldNames:[],createdBySigned:false,disabledBySigned:false}}
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
  const name=xmlValue(xfa.xml,['name1']),organization=xmlValue(xfa.xml,['Organization2']),email=xmlValue(xfa.xml,['Email_Address5','Official_Email','OfficialEmail','Official_Email_Address','OfficialEmailAddress']),requestDate=parseSaarRequestDate(xmlValue(xfa.xml,['signedDate12','SignedDate12','typeReqDate'])),processedBy=xmlValue(xfa.xml,['NameProcessed','ProcessedByName','CreatedBy']),createdDate=parseSaarRequestDate(xmlValue(xfa.xml,['ProcessedsignedDate','ProcessedSignedDate','CreatedBySignedDate'])),disabledBy=xmlValue(xfa.xml,['NameDisabled','DisabledByName','DisabledBy']),disabledDate=parseSaarRequestDate(xmlValue(xfa.xml,['DisabledsignedDate','DisabledSignedDate','DisabledBySignedDate'])),createdBySigned=!!processedBy&&!!createdDate,disabledBySigned=!!disabledBy&&!!disabledDate;
  return{fillable:true,format:'XFA',identity:name?parseSaarName(name):undefined,organization:organization?clean(organization,200):undefined,email:email?clean(email,254):undefined,...(requestDate?{requestDate}:{}),...(createdDate?{createdDate}:{}),...(disabledDate?{disabledDate}:{}),createdBySigned,disabledBySigned,signedFieldNames:[]}
 }
 const values:Partial<Record<'name'|'organization'|'email'|'requestDate',string>>={};let signedRequestDate:string|undefined;
 try{
  const fields=pdf.getForm().getFields(),signatures=signatureSummary(fields);
  for(const field of fields){
   if(field instanceof PDFSignature){signedRequestDate=signedRequestDate??signatureRequestDate(field);continue}if(!(field instanceof PDFTextField))continue;
   const kind=fieldKind(field.getName());if(!kind||values[kind])continue;
   const value=clean(field.getText()??'',500);if(value)values[kind]=value
  }
  const requestDate=parseSaarRequestDate(values.requestDate)??signedRequestDate;if(fields.length>0)return{fillable:true,format:'AcroForm',identity:values.name?parseSaarName(values.name):undefined,organization:values.organization?clean(values.organization,200):undefined,email:values.email?clean(values.email,254):undefined,...(requestDate?{requestDate}:{}),...signatures}
 }catch{}
 return{fillable:false}
}
