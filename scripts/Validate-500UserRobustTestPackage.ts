import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {inspectEvidenceBytes} from '../app/evidence-validation.ts';
import {filenameIdentityMatches,filenameMatchesKind,looksLikeEvidenceFilename,normalizeFilenameDate,organizationFrom,validateNewUserSaarFilename} from '../app/filename-utils.ts';
import {readSaarFormFields} from '../app/saar-form-utils.ts';

type Row={
 RelativePath:string;SourceFilename:string;ExpectedNormalizedFilename:string;ExpectedScanDisposition:string;ExpectedArtifact:string;
 ExpectedLastName:string;ExpectedFirstName:string;ExpectedOrganization:string;ExpectedRole:string;ExpectedPrivilegedType:string;
 ExpectedEmail:string;Container:string;ExpectedCleanUp:string;FallbackMode:string;Reason:string;
};

const root=resolve(process.argv[2]??'tmp/pdfs/t5/P');
const rows=JSON.parse(await readFile(resolve(root,'Expected_Results/Expected_File_Results.json'),'utf8')) as Row[];
const roster=(await readFile(resolve(root,'Expected_Results/Expected_User_Roster.csv'),'utf8')).split(/\r?\n/).filter(Boolean);
const failures:string[]=[];
let accepted=0,ignored=0,rejected=0,rework=0,saarValidated=0,normalized=0;

function fail(row:Row,message:string){failures.push(`${row.RelativePath}: ${message}`)}
for(const row of rows){
 const path=resolve(root,row.RelativePath),bytes=new Uint8Array(await readFile(path)),evidenceLike=looksLikeEvidenceFilename(row.SourceFilename);
 if(row.ExpectedScanDisposition==='IgnoredFilename'){
  ignored++;if(evidenceLike)fail(row,'expected an ignored filename but the application recognizes it as evidence');continue
 }
 if(row.ExpectedScanDisposition==='ExpectedSyncStop'||row.ExpectedScanDisposition==='IdentityCollisionReview'||row.ExpectedScanDisposition.startsWith('Manual')||row.ExpectedScanDisposition.startsWith('SecondSync'))continue;
 if(!evidenceLike){fail(row,'expected an evidence-like filename but the application ignores it');continue}
 let inspected:ReturnType<typeof inspectEvidenceBytes>|undefined;
 try{inspected=inspectEvidenceBytes(row.SourceFilename,bytes);await PDFDocument.load(inspected.pdfBytes)}catch(error){
  if(row.ExpectedScanDisposition==='RejectedContent'){rejected++;continue}
  fail(row,`unexpected content rejection: ${error instanceof Error?error.message:String(error)}`);continue
 }
 if(row.ExpectedScanDisposition==='RejectedContent'){fail(row,'expected content rejection but validation accepted the file');continue}
 try{
  const normalization=normalizeFilenameDate(row.SourceFilename);
  if(!normalization)throw new Error('no date was parsed');
  if(normalization.normalized!==row.ExpectedNormalizedFilename)throw new Error(`normalized to ${normalization.normalized}, expected ${row.ExpectedNormalizedFilename}`);
  if(normalization.changed)normalized++;
  if(row.ExpectedArtifact&&!filenameMatchesKind(row.SourceFilename,row.ExpectedArtifact))throw new Error(`did not match artifact ${row.ExpectedArtifact}`);
  if(row.ExpectedLastName&&!row.FallbackMode&&!filenameIdentityMatches(row.SourceFilename,{last:row.ExpectedLastName,first:row.ExpectedFirstName}))throw new Error('Last_First identity did not match');
  if(row.ExpectedOrganization&&!row.FallbackMode&&organizationFrom(row.SourceFilename)?.toUpperCase()!==row.ExpectedOrganization.toUpperCase())throw new Error('organization did not match');
  if(row.ExpectedArtifact==='SAAR'){
   const fields=await readSaarFormFields(inspected.pdfBytes),validation=validateNewUserSaarFilename(row.SourceFilename,{identity:fields.identity,organization:fields.organization});
   if(row.ExpectedScanDisposition==='Rework'){
    if(validation.valid&&fields.fillable&&fields.email)throw new Error('expected a Rework condition but the SAAR is fully valid');
    rework++;continue
   }
   if(!validation.valid)throw new Error(validation.reason);
   if(!fields.fillable)throw new Error('SAAR is not fillable');
   if(fields.email!==row.ExpectedEmail)throw new Error(`Official Email ${fields.email??'(missing)'} did not match ${row.ExpectedEmail}`);
   if(validation.identity.last.toUpperCase()!==row.ExpectedLastName.toUpperCase()||validation.identity.first.toUpperCase()!==row.ExpectedFirstName.toUpperCase())throw new Error('validated form/filename identity did not match expected Last_First');
   if(validation.organization.toUpperCase()!==row.ExpectedOrganization.toUpperCase())throw new Error('validated form/filename organization did not match expected organization');
   if(validation.role!==row.ExpectedRole)throw new Error(`role ${validation.role} did not match ${row.ExpectedRole}`);
   if(row.ExpectedPrivilegedType&&!validation.privilegedTypes.some(value=>value.toUpperCase()===row.ExpectedPrivilegedType.toUpperCase()))throw new Error(`privileged type did not include ${row.ExpectedPrivilegedType}`);
   saarValidated++;
  }else if(row.ExpectedScanDisposition==='Rework')throw new Error('non-SAAR Rework fixture unexpectedly reached semantic validation');
  accepted++;
 }catch(error){fail(row,error instanceof Error?error.message:String(error))}
}

if(roster.length!==501)failures.push(`Expected_User_Roster.csv has ${roster.length-1} data rows instead of 500.`);
const acceptedSaarRows=rows.filter(row=>row.ExpectedArtifact==='SAAR'&&['AcceptedEvidence','AcceptedSuperseded'].includes(row.ExpectedScanDisposition));
if(acceptedSaarRows.length!==500)failures.push(`Expected exactly 500 accepted primary SAAR files, found ${acceptedSaarRows.length}.`);
if(failures.length){
 console.error(JSON.stringify({valid:false,failures:failures.slice(0,100),failureCount:failures.length},null,2));process.exit(1)
}
console.log(JSON.stringify({valid:true,files:rows.length,accepted,ignored,rejected,rework,saarValidated,normalized,users:500},null,2));
