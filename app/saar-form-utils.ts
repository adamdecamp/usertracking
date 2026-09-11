import {decodePDFRawStream,PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFNumber,PDFRawStream,PDFSignature,PDFString,PDFTextField,type PDFField} from 'pdf-lib';

const clean=(value:string,max=500)=>value.replace(/<[^>]*>/g,' ').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalizedName=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const emailPattern=/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;
const spacedEmailPattern=/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+\s*@\s*[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\s*\.\s*[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;

function emailOccurrences(value:string){
 const normalized=value.replace(/[\u0000-\u001f\u007f\u00ad\u200b-\u200d\u2060\ufeff]+/g,' ').replace(/\s+/g,' '),matches=[...normalized.matchAll(emailPattern),...normalized.matchAll(spacedEmailPattern)];
 const seen=new Set<string>();return matches.sort((left,right)=>(left.index??0)-(right.index??0)).map(match=>({value:match[0].replace(/\s+/g,'').replace(/^[<([{]+|[>\])},;:]+$/g,'').toLowerCase(),index:match.index??0})).filter(item=>{const key=`${item.index}\u0000${item.value}`;if(seen.has(key))return false;seen.add(key);return true})
}
const emailsIn=(value:string)=>Array.from(new Set(emailOccurrences(value).map(item=>item.value)));

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
 for(const label of labels){const start=(label.index??0)+label[0].length,window=source.slice(start,start+400),match=emailOccurrences(window)[0];if(!match)continue;const before=window.slice(0,match.index);if(/\b(?:SUPERVISOR|SPONSOR|SECURITY\s+MANAGER|APPROVING\s+OFFICIAL)\b.{0,60}\bE[\s-]*MAIL\b/i.test(before))continue;return match.value}
}

export function firstEmailFromText(text:string){
 const source=text.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\u00ad/g,'-').replace(/\s+/g,' ').slice(0,500000);
 return emailsIn(source)[0]
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

function emailFieldPriority(name:string){
 const normalized=normalizedName(name);
 if(/(?:^| )4 OFFICIAL ORGANIZATION E MAIL ADDRESS(?: |$)/.test(normalized))return 0;
 if(/(?:^| )OFFICIAL ORGANIZATION E MAIL ADDRESS(?: |$)/.test(normalized))return 1;
 if(/(?:^| )(?:4|5)? ?OFFICIAL E MAIL ADDRESS(?: |$)/.test(normalized)||fieldKind(name)==='email'||/(?:^| )EMAIL ADDRESS5(?: |$)/.test(normalized))return 2;
 return 3
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
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\s*>`,'gi');
  for(const match of xml.matchAll(pattern)){const value=clean(decodeXml(match[1]),500);if(value)return value}
 }
}
const nonUserEmailField=(name:string)=>/\b(?:SUPERVISOR|SPONSOR|SECURITY\s+MANAGER|APPROVING|SIGNER)\b/i.test(normalizedName(name));

function inheritedWidgetText(widget:PDFDict,key:string){
 let current:PDFDict|undefined=widget;
 for(let depth=0;current&&depth<8;depth++){
  const value=current.lookup(PDFName.of(key));
  if(value instanceof PDFString||value instanceof PDFHexString)return clean(value.decodeText(),500);
  if(value instanceof PDFName)return clean(value.decodeText(),500);
  const parent:unknown=current.lookup(PDFName.of('Parent'));current=parent instanceof PDFDict?parent:undefined;
 }
 return'';
}

function streamText(value:unknown){
 if(!(value instanceof PDFRawStream))return'';
 try{
  const source=new TextDecoder('latin1').decode(decodePDFRawStream(value).decode()),values=[source];
  for(const match of source.matchAll(/<([0-9a-f\s]{4,})>/gi)){const hex=match[1].replace(/\s+/g,'');if(hex.length%2)continue;const bytes=new Uint8Array(hex.length/2);for(let index=0;index<bytes.length;index++)bytes[index]=Number.parseInt(hex.slice(index*2,index*2+2),16);values.push(new TextDecoder('latin1').decode(bytes))}
  for(const match of source.matchAll(/\(((?:\\.|[^\\)])*)\)/g))values.push(match[1].replace(/\\([()\\])/g,'$1').replace(/\\([0-7]{1,3})/g,(_,octal)=>String.fromCharCode(Number.parseInt(octal,8))));
  return values.join(' ')
 }catch{return''}
}

function appearanceText(widget:PDFDict){
 const appearance=widget.lookup(PDFName.of('AP'));if(!(appearance instanceof PDFDict))return'';
 const normal=appearance.lookup(PDFName.of('N'));if(normal instanceof PDFRawStream)return streamText(normal);
 if(!(normal instanceof PDFDict))return'';
 const values:string[]=[];for(const[,value]of normal.entries())values.push(streamText(value));return values.join(' ')
}

function widgetValues(widget:PDFDict){
 return ['V','DV','RV'].map(key=>inheritedWidgetText(widget,key)).concat(appearanceText(widget)).filter(Boolean)
}

function widgetTop(widget:PDFDict){
 const rect=widget.lookup(PDFName.of('Rect'));if(!(rect instanceof PDFArray)||rect.size()<4)return-Infinity;
 const first=rect.lookup(1),second=rect.lookup(3);return Math.max(first instanceof PDFNumber?first.asNumber():-Infinity,second instanceof PDFNumber?second.asNumber():-Infinity);
}

function widgetEmailCandidates(pdf:PDFDocument){
 const candidates:{priority:number;page:number;top:number;order:number;value:string}[]=[];let order=0;
 for(const[pageIndex,page]of pdf.getPages().entries()){
  const annotations=page.node.lookup(PDFName.of('Annots'));if(!(annotations instanceof PDFArray))continue;
  for(let index=0;index<annotations.size();index++){
   const annotation=annotations.lookup(index);if(!(annotation instanceof PDFDict))continue;
   const name=inheritedWidgetText(annotation,'T');if(nonUserEmailField(name))continue;
   for(const value of widgetValues(annotation))for(const email of emailsIn(value))candidates.push({priority:emailFieldPriority(name),page:pageIndex,top:widgetTop(annotation),order:order++,value:email});
  }
 }
 return candidates;
}

function decodeXfaBytes(bytes:Uint8Array){
 if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes);
 if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff){const swapped=new Uint8Array(bytes.length-2);for(let index=2;index+1<bytes.length;index+=2){swapped[index-2]=bytes[index+1];swapped[index-1]=bytes[index]}return new TextDecoder('utf-16le',{fatal:true}).decode(swapped)}
 const sample=bytes.subarray(0,Math.min(bytes.length,200)),evenZeros=sample.filter((value,index)=>index%2===0&&value===0).length,oddZeros=sample.filter((value,index)=>index%2===1&&value===0).length;
 if(oddZeros>sample.length/8&&oddZeros>evenZeros*2)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes);
 if(evenZeros>sample.length/8&&evenZeros>oddZeros*2){const swapped=new Uint8Array(bytes.length);for(let index=0;index+1<bytes.length;index+=2){swapped[index]=bytes[index+1];swapped[index+1]=bytes[index]}return new TextDecoder('utf-16le',{fatal:true}).decode(swapped)}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes)
}

function xfaEmailFallback(xml:string){
 for(const match of emailOccurrences(xml)){
  const prefix=xml.slice(Math.max(0,match.index-300),match.index),tagMatch=prefix.match(/<([A-Za-z_][\w.:-]*)\b[^>]*>\s*[^<>]*$/),tag=(tagMatch?.[1]??'').split(':').pop()??'';
  if(/SUPERVISOR|SPONSOR|SECURITY|MANAGER|APPROV|SIGNER/i.test(tag)||/^EMAIL(?:14|17|19)$/i.test(tag))continue;
  return match.value
 }
}

function xfaDatasets(pdf:PDFDocument){
 const acro=pdf.catalog.lookup(PDFName.of('AcroForm')),xfa=acro instanceof PDFDict?acro.lookup(PDFName.of('XFA')):undefined;
 if(!(xfa instanceof PDFArray)&&!(xfa instanceof PDFRawStream))return{present:false as const};
 try{
  if(xfa instanceof PDFArray){
   const packets:string[]=[];let totalBytes=0;
   for(let index=0;index+1<xfa.size();index+=2){
    const label=xfa.lookup(index),stream=xfa.lookup(index+1);
    if(!((label instanceof PDFString||label instanceof PDFHexString)&&['datasets','form'].includes(label.decodeText().toLowerCase()))||!(stream instanceof PDFRawStream))continue;
    const bytes=decodePDFRawStream(stream).decode();totalBytes+=bytes.length;
    if(bytes.length>5*1024*1024||totalBytes>8*1024*1024)throw new Error('The XFA data packets exceed the safety limit.');
    packets.push(decodeXfaBytes(bytes))
   }
   return{present:true as const,xml:packets.join('\n')||undefined}
  }else if(xfa instanceof PDFRawStream){
   const bytes=decodePDFRawStream(xfa).decode();
   if(bytes.length>5*1024*1024)throw new Error('The XFA packet exceeds the safety limit.');
   return{present:true as const,xml:decodeXfaBytes(bytes)}
  }
 }catch{return{present:true as const}}
 return{present:true as const}
}

export async function readSaarFormFields(pdfBytes:Uint8Array):Promise<SaarFormFields>{
 const pdf=await PDFDocument.load(pdfBytes,{ignoreEncryption:false,updateMetadata:false});
 const xfa=xfaDatasets(pdf),xfaName=xfa.xml?xmlValue(xfa.xml,['name1']):undefined,xfaOrganization=xfa.xml?xmlValue(xfa.xml,['Organization2']):undefined,xfaEmailRaw=xfa.xml?(xmlValue(xfa.xml,['Email_Address4','Official_Organization_Email_Address','OfficialOrganizationEmailAddress','Email_Address5','Official_Email','OfficialEmail','Official_Email_Address','OfficialEmailAddress'])??xfaEmailFallback(xfa.xml)):undefined,xfaEmail=xfaEmailRaw?emailsIn(xfaEmailRaw)[0]:undefined,xfaRequestDate=xfa.xml?parseSaarRequestDate(xmlValue(xfa.xml,['signedDate12','SignedDate12','typeReqDate'])):undefined,processedBy=xfa.xml?xmlValue(xfa.xml,['NameProcessed','ProcessedByName','CreatedBy']):undefined,xfaCreatedDate=xfa.xml?parseSaarRequestDate(xmlValue(xfa.xml,['ProcessedsignedDate','ProcessedSignedDate','CreatedBySignedDate'])):undefined,disabledBy=xfa.xml?xmlValue(xfa.xml,['NameDisabled','DisabledByName','DisabledBy']):undefined,xfaDisabledDate=xfa.xml?parseSaarRequestDate(xmlValue(xfa.xml,['DisabledsignedDate','DisabledSignedDate','DisabledBySignedDate'])):undefined;
 const values:Partial<Record<'name'|'organization'|'email'|'requestDate',string>>={},emailCandidates:{priority:number;page:number;top:number;order:number;value:string}[]=widgetEmailCandidates(pdf);let signedRequestDate:string|undefined;
 if(xfaEmail)emailCandidates.push({priority:-1,page:0,top:Infinity,order:-1,value:xfaEmail});
 try{
  const fields=pdf.getForm().getFields(),signatures=signatureSummary(fields);
  for(const[order,field]of fields.entries()){
   if(field instanceof PDFSignature){signedRequestDate=signedRequestDate??signatureRequestDate(field);continue}if(!(field instanceof PDFTextField))continue;
   const value=clean(field.getText()??'',500);if(!nonUserEmailField(field.getName()))for(const email of emailsIn(value))emailCandidates.push({priority:emailFieldPriority(field.getName()),page:Number.MAX_SAFE_INTEGER,top:-Infinity,order,value:email});
   const kind=fieldKind(field.getName());if(!kind||kind==='email'||values[kind])continue;
   if(value)values[kind]=value
  }
  values.email=emailCandidates.sort((left,right)=>left.priority-right.priority||left.page-right.page||right.top-left.top||left.order-right.order)[0]?.value;
  const requestDate=xfaRequestDate??parseSaarRequestDate(values.requestDate)??signedRequestDate,identity=xfaName?parseSaarName(xfaName):values.name?parseSaarName(values.name):undefined,organization=xfaOrganization?clean(xfaOrganization,200):values.organization?clean(values.organization,200):undefined,email=values.email?clean(values.email,254):undefined,createdDate=xfaCreatedDate??signatures.createdDate,disabledDate=xfaDisabledDate??signatures.disabledDate,createdBySigned=(!!processedBy&&!!xfaCreatedDate)||signatures.createdBySigned,disabledBySigned=(!!disabledBy&&!!xfaDisabledDate)||signatures.disabledBySigned;
  if(xfa.present||fields.length>0)return{fillable:true,format:xfa.present?'XFA':'AcroForm',identity,organization,email,...(requestDate?{requestDate}:{}),...(createdDate?{createdDate}:{}),...(disabledDate?{disabledDate}:{}),createdBySigned,disabledBySigned,signedFieldNames:signatures.signedFieldNames}
  }catch{}
 return xfa.present?{fillable:!!xfa.xml,format:xfa.xml?'XFA':undefined,identity:xfaName?parseSaarName(xfaName):undefined,organization:xfaOrganization?clean(xfaOrganization,200):undefined,email:xfaEmail?clean(xfaEmail,254):undefined,...(xfaRequestDate?{requestDate:xfaRequestDate}:{}),...(xfaCreatedDate?{createdDate:xfaCreatedDate}:{}),...(xfaDisabledDate?{disabledDate:xfaDisabledDate}:{}),createdBySigned:!!processedBy&&!!xfaCreatedDate,disabledBySigned:!!disabledBy&&!!xfaDisabledDate,signedFieldNames:[]}:{fillable:false}
}
