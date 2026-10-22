import type {ExtractionSource,FieldProvenance,UserExtractionProvenance} from '../domain/tracker-models';
import {fileTokens,identityFromFilename} from '../filename-utils.ts';
import type {SaarReadResult} from './saar-reader';

export function extractionField(source:ExtractionSource,detail:string,filename?:string,verifiedAtUtc=new Date().toISOString()):FieldProvenance{
 return{source,detail:detail.slice(0,500),verifiedAtUtc,filename:filename?.slice(0,500)};
}

export function mergeExtractionProvenance(current:UserExtractionProvenance|undefined,next:UserExtractionProvenance):UserExtractionProvenance{
 return{...(current??{}),...next};
}

export function operatorProvenance(current:UserExtractionProvenance|undefined,details:Partial<Record<keyof UserExtractionProvenance,string>>):UserExtractionProvenance{
 const updates:UserExtractionProvenance={};for(const[field,detail]of Object.entries(details) as [keyof UserExtractionProvenance,string][])if(detail)updates[field]=extractionField('Operator',detail);return mergeExtractionProvenance(current,updates);
}

export function saarExtractionProvenance(read:SaarReadResult,filename:string,folderOrganization:string):UserExtractionProvenance{
 const verifiedAtUtc=new Date().toISOString(),tokens=fileTokens(filename),result:UserExtractionProvenance={organization:extractionField('Organization Folder',`Storage organization derived from the mapped organization folder ${folderOrganization}.`,filename,verifiedAtUtc)};
 if(identityFromFilename(filename))result.identity=extractionField('Filename','Last and First Name parsed from the evidence filename.',filename,verifiedAtUtc);
 else if(read.identity)result.identity=extractionField(read.format==='XFA'?'DD2875 XFA':'SAAR AcroForm','Name recovered from the designated SAAR identity fields.',filename,verifiedAtUtc);
 if(tokens.has('GEN')||tokens.has('PRIV'))result.accountType=extractionField('Filename','General or Privileged account metadata parsed from the SAAR filename.',filename,verifiedAtUtc);
 if(read.email&&read.emailSource)result.officialEmail=extractionField(read.emailSource,'Official Email recovered from the designated SAAR field or bounded selectable-text fallback.',filename,verifiedAtUtc);
 if(read.designation)result.designation=extractionField(read.format==='XFA'?'DD2875 XFA':'SAAR AcroForm',`Designation of Person checkbox identified ${read.designation}.`,filename,verifiedAtUtc);
 return result;
}

export function filenameExtractionProvenance(filename:string,identityDetail='Identity parsed from correctly formatted evidence.',accountDetail='Account role inferred from the evidence filename.'):UserExtractionProvenance{return{identity:extractionField('Filename',identityDetail,filename),organization:extractionField('Organization Folder','Storage organization derived from the mapped organization folder.',filename),accountType:extractionField('Filename',accountDetail,filename)}}
