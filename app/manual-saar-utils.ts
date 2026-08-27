import {identityFromFilename,organizationFrom} from './filename-utils.ts';
import type {SaarFormFields} from './saar-form-utils.ts';

const placeholderNames=new Set(['LAST','FIRST']);
const placeholderOrganizations=new Set(['ORG','ORGANIZATION']);
const clean=(value?:string,max=200)=>(value??'').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);

function usableFilenameIdentity(filename:string){
 const identity=identityFromFilename(filename);
 return identity&&!placeholderNames.has(identity.last.toUpperCase())&&!placeholderNames.has(identity.first.toUpperCase())?identity:undefined;
}

function usableFilenameOrganization(filename:string){
 const organization=organizationFrom(filename);
 return organization&&!placeholderOrganizations.has(organization.toUpperCase())?organization:undefined;
}

export function manualSaarPrefill(filename:string,fields:Partial<SaarFormFields>,embeddedFilename?:string){
 const filenames=[filename,embeddedFilename].filter((value,index,items):value is string=>!!value&&items.indexOf(value)===index);
 const filenameIdentity=filenames.map(usableFilenameIdentity).find(Boolean),filenameOrganization=filenames.map(usableFilenameOrganization).find(Boolean);
 const identity=filenameIdentity??fields.identity,organization=filenameOrganization??fields.organization;
 return{
  last:clean(identity?.last,100),
  first:clean(identity?.first,100),
  middle:clean(fields.identity?.middle,1),
  organization:clean(organization,200),
  email:clean(fields.email,254),
  identitySource:filenameIdentity?'filename':fields.identity?'form':undefined,
  organizationSource:filenameOrganization?'filename':fields.organization?'form':undefined,
  emailSource:fields.email?'form':undefined
 } as const;
}
