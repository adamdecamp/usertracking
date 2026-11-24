import {numberValue,objectValue,optionalString,stringValue,booleanValue,RuntimeDecodeError,type RuntimeDecoder} from './runtime-decoders.ts';

export type OutlookIntakeFile={filename:string;sender:string;receivedUtc:string;organization?:string;reason?:string;held?:string;recorded?:true};
export const outlookHeldReasons=['sender','filename','organization','conflict','invalid'] as const;
export type OutlookHeldReason=typeof outlookHeldReasons[number];
export type OutlookHeldItem={id:string;reason:OutlookHeldReason;detail:string;filename:string;code:string;organization:string;sender:string;receivedUtc:string};
export type OutlookHeldList={held:OutlookHeldItem[];organizations:string[];assigned?:OutlookIntakeFile};
export type OutlookIntakeResult={cancelled:false;folder:string;scanned:number;previouslyProcessed:number;withoutPdf:number;alreadyRecorded:number;saved:OutlookIntakeFile[];skipped:OutlookIntakeFile[]};
export type OutlookFolderResult={cancelled:true}|{cancelled:false;folder:string};

const context='Outlook intake';

function decodeFile(value:unknown,path:string,skipped:boolean):OutlookIntakeFile{
 const record=objectValue(value,context,path),reason=optionalString(record,'reason',context,400);
 if(skipped!==!!reason)throw new RuntimeDecodeError(context,`${path}.reason`,skipped?'a skip reason':'no skip reason on a copied file');
 const organization=optionalString(record,'organization',context,100),held=optionalString(record,'held',context,32);
 if(!skipped&&!organization)throw new RuntimeDecodeError(context,`${path}.organization`,'the destination organization');
 if(held&&!/^[0-9a-f]{32}$/.test(held))throw new RuntimeDecodeError(context,`${path}.held`,'a Needs Attention id');
 if(record.recorded!==undefined&&(record.recorded!==true||!skipped))throw new RuntimeDecodeError(context,`${path}.recorded`,'an already-recorded flag on a skipped file');
 return{filename:stringValue(record.filename,context,`${path}.filename`,180),sender:stringValue(record.sender,context,`${path}.sender`,254),receivedUtc:stringValue(record.receivedUtc,context,`${path}.receivedUtc`,40),...(organization?{organization}:{}),...(reason?{reason}:{}),...(held?{held}:{}),...(record.recorded===true?{recorded:true as const}:{})};
}

const heldContext='Outlook Needs Attention';

function decodeHeldItem(value:unknown,path:string):OutlookHeldItem{
 const record=objectValue(value,heldContext,path),field=(key:string,max:number)=>stringValue(record[key],heldContext,`${path}.${key}`,max),id=field('id',32),reason=field('reason',20);
 if(!/^[0-9a-f]{32}$/.test(id))throw new RuntimeDecodeError(heldContext,`${path}.id`,'a Needs Attention id');
 if(!(outlookHeldReasons as readonly string[]).includes(reason))throw new RuntimeDecodeError(heldContext,`${path}.reason`,'a known Needs Attention reason');
 return{id,reason:reason as OutlookHeldReason,detail:field('detail',400),filename:field('filename',180),code:field('code',100),organization:field('organization',100),sender:field('sender',254),receivedUtc:field('receivedUtc',40)};
}

export const decodeOutlookHeldList:RuntimeDecoder<OutlookHeldList>=value=>{
 const record=objectValue(value,heldContext);
 if(!Array.isArray(record.held)||record.held.length>1000)throw new RuntimeDecodeError(heldContext,'$.held','an array of held attachments');
 if(!Array.isArray(record.organizations)||record.organizations.length>10000)throw new RuntimeDecodeError(heldContext,'$.organizations','an array of organizations');
 return{held:record.held.map((item,index)=>decodeHeldItem(item,`$.held[${index}]`)),organizations:record.organizations.map((item,index)=>stringValue(item,heldContext,`$.organizations[${index}]`,100)),...(record.assigned===undefined?{}:{assigned:decodeFile(record.assigned,'$.assigned',false)})};
};

function decodeFiles(value:unknown,path:string,skipped:boolean){
 if(!Array.isArray(value)||value.length>100000)throw new RuntimeDecodeError(context,path,'an array of attachments');
 return value.map((item,index)=>decodeFile(item,`${path}[${index}]`,skipped));
}

export const decodeOutlookIntakeResult:RuntimeDecoder<OutlookIntakeResult>=value=>{
 const record=objectValue(value,context);
 if(record.cancelled!==false)throw new RuntimeDecodeError(context,'$.cancelled','a completed check');
 return{cancelled:false,folder:stringValue(record.folder,context,'$.folder',200),scanned:numberValue(record.scanned,context,'$.scanned'),previouslyProcessed:numberValue(record.previouslyProcessed,context,'$.previouslyProcessed'),withoutPdf:numberValue(record.withoutPdf,context,'$.withoutPdf'),alreadyRecorded:record.alreadyRecorded===undefined?0:numberValue(record.alreadyRecorded,context,'$.alreadyRecorded'),saved:decodeFiles(record.saved,'$.saved',false),skipped:decodeFiles(record.skipped,'$.skipped',true)};
};

export const decodeOutlookSendFrom:RuntimeDecoder<{address:string}>=value=>({address:stringValue(objectValue(value,'Outlook Send From').address,'Outlook Send From','$.address',254)});

export const decodeOutlookFolderResult:RuntimeDecoder<OutlookFolderResult>=value=>{
 const record=objectValue(value,'Outlook folder selection');
 return booleanValue(record.cancelled,'Outlook folder selection','$.cancelled')?{cancelled:true}:{cancelled:false,folder:stringValue(record.folder,'Outlook folder selection','$.folder',200)};
};
