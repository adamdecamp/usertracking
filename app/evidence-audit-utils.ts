export type EvidenceAuditInput={
 kind:string;
 text?:string;
 signedFieldNames?:string[];
 createdBySigned?:boolean;
 disabledBySigned?:boolean;
 createdDate?:string;
 disabledDate?:string;
};

export type EvidenceAuditResult={
 passed:boolean;
 reason:string;
 accountStatus?:'Active'|'Disabled';
 accountActionDate?:string;
};

const normalized=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9+]+/g,' ').replace(/\s+/g,' ').trim();
const contains=(source:string,expression:RegExp)=>expression.test(source);

/**
 * Applies only the content rules selected by the operator in Evidence Audit.
 * Filename validation remains a separate, earlier gate during Sync.
 */
export function auditEvidenceContent(input:EvidenceAuditInput):EvidenceAuditResult{
 const text=normalized(input.text??''),signed=(input.signedFieldNames??[]).length>0;
 if(input.kind==='SAAR'){
  if(input.disabledBySigned){
   if(!input.disabledDate)return{passed:false,reason:'Part IV Disabled By is signed, but its signing date could not be read.'};
   return{passed:true,reason:'Part IV Disabled By digital signature and signing date verified.',accountStatus:'Disabled',accountActionDate:input.disabledDate};
  }
  if(input.createdBySigned){
   if(!input.createdDate)return{passed:false,reason:'Part IV Created By is signed, but its signing date could not be read.'};
   return{passed:true,reason:'Part IV Created By digital signature and signing date verified.',accountStatus:'Active',accountActionDate:input.createdDate};
  }
  return{passed:false,reason:'Part IV is incomplete: no populated Created By or Disabled By digital signature was found.'};
 }
 if(input.kind==='DoD Cyber Cert'){
  const awareness=contains(text,/\bCYBER\s+AWARENESS(?:\s+CHALLENGE)?\b/)||contains(text,/\bAWARENESS\s+CHALLENGE\b/);
  if(!awareness)return{passed:false,reason:'The PDF is not identifiable as DoD Cyber Awareness evidence. Third-party certification records such as CompTIA or 8570 credentials do not satisfy this document type.'};
  return{passed:true,reason:'DoD Cyber Awareness content verified.'};
 }
 if(input.kind==='User Agreement'){
  if(!contains(text,/\b(?:USER\s+)?AGREEMENT\b|\bACCEPTABLE\s+USE\b/))return{passed:false,reason:'The PDF is not identifiable as a User Agreement.'};
  if(!signed)return{passed:false,reason:'The User Agreement does not contain a populated PDF digital-signature field.'};
  return{passed:true,reason:'User Agreement content and digital signature verified.'};
 }
 if(input.kind==='8140 Cert Memo'){
  if(!contains(text,/\b8140(?:\.0+)?\b/)||!contains(text,/\bMEMO(?:RANDUM)?\b|\bCERTIFICATION\b|\bQUALIFICATION\b/))return{passed:false,reason:'The PDF is not identifiable as an 8140 certification memorandum.'};
  if(!signed)return{passed:false,reason:'The 8140 certification memorandum does not contain a populated PDF digital-signature field.'};
  return{passed:true,reason:'8140 certification memorandum content and digital signature verified.'};
 }
 if(input.kind==='Privileged User Training Cert'){
  const privileged=contains(text,/\bPRIV(?:ILEGED)?(?:\s+USER)?\b/)||contains(text,/\bPRIVILEGED\s+ACCESS\b/),training=contains(text,/\bTRAINING\b|\bRESPONSIBILIT(?:Y|IES)\b|\bCOURSE\b/);
  return privileged&&training?{passed:true,reason:'Privileged User Training content verified.'}:{passed:false,reason:'The PDF is not identifiable as Privileged User Training evidence.'};
 }
 if(input.kind==='DTA Training Cert'){
  const dta=contains(text,/\bDTA\b|\bDELEGATED\s+TRUSTED\s+AGENT\b/),training=contains(text,/\bTRAINING\b|\bCOURSE\b|\bCERTIFICAT(?:E|ION)\b/);
  return dta&&training?{passed:true,reason:'DTA Training content verified.'}:{passed:false,reason:'The PDF is not identifiable as DTA Training evidence.'};
 }
 return{passed:false,reason:'No content-audit rule exists for this document type.'};
}
