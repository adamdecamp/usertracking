import {numberValue,objectValue,optionalString,stringValue,booleanValue,RuntimeDecodeError,type RuntimeDecoder} from './runtime-decoders.ts';

export type OutlookIntakeFile={filename:string;sender:string;receivedUtc:string;organization?:string;reason?:string};
export type OutlookIntakeResult={cancelled:false;folder:string;scanned:number;previouslyProcessed:number;withoutPdf:number;saved:OutlookIntakeFile[];skipped:OutlookIntakeFile[]};
export type OutlookFolderResult={cancelled:true}|{cancelled:false;folder:string};

const context='Outlook intake';

function decodeFile(value:unknown,path:string,skipped:boolean):OutlookIntakeFile{
 const record=objectValue(value,context,path),reason=optionalString(record,'reason',context,400);
 if(skipped!==!!reason)throw new RuntimeDecodeError(context,`${path}.reason`,skipped?'a skip reason':'no skip reason on a copied file');
 const organization=optionalString(record,'organization',context,100);
 if(!skipped&&!organization)throw new RuntimeDecodeError(context,`${path}.organization`,'the destination organization');
 return{filename:stringValue(record.filename,context,`${path}.filename`,180),sender:stringValue(record.sender,context,`${path}.sender`,254),receivedUtc:stringValue(record.receivedUtc,context,`${path}.receivedUtc`,40),...(organization?{organization}:{}),...(reason?{reason}:{})};
}

function decodeFiles(value:unknown,path:string,skipped:boolean){
 if(!Array.isArray(value)||value.length>100000)throw new RuntimeDecodeError(context,path,'an array of attachments');
 return value.map((item,index)=>decodeFile(item,`${path}[${index}]`,skipped));
}

export const decodeOutlookIntakeResult:RuntimeDecoder<OutlookIntakeResult>=value=>{
 const record=objectValue(value,context);
 if(record.cancelled!==false)throw new RuntimeDecodeError(context,'$.cancelled','a completed check');
 return{cancelled:false,folder:stringValue(record.folder,context,'$.folder',200),scanned:numberValue(record.scanned,context,'$.scanned'),previouslyProcessed:numberValue(record.previouslyProcessed,context,'$.previouslyProcessed'),withoutPdf:numberValue(record.withoutPdf,context,'$.withoutPdf'),saved:decodeFiles(record.saved,'$.saved',false),skipped:decodeFiles(record.skipped,'$.skipped',true)};
};

export const decodeOutlookFolderResult:RuntimeDecoder<OutlookFolderResult>=value=>{
 const record=objectValue(value,'Outlook folder selection');
 return booleanValue(record.cancelled,'Outlook folder selection','$.cancelled')?{cancelled:true}:{cancelled:false,folder:stringValue(record.folder,'Outlook folder selection','$.folder',200)};
};
