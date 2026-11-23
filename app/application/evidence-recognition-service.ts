import {artifactKindFromFilename,evidenceFilenamePassesStorageGate,organizationFrom,parseDate} from '../filename-utils.ts';
import {artifactRecognitionRules,nameSuffixes,recognitionThresholds,surnamePrefixes} from '../data/evidence-recognition-rules.ts';
import {possibleExistingUserMatches,type MatchableUser} from './user-match-service.ts';
import type {RecognitionAlias} from '../domain/tracker-models.ts';

export type RecognitionIdentity={last:string;first:string;middle?:string;suffix?:string};
export type RecognitionCandidate={userId:string;last:string;first:string;organization:string;label:string;score:number;reasons:string[]};
export type RecognitionProposal={identity?:RecognitionIdentity;organization?:string;artifactKind?:string;date?:string;role?:'GEN'|'PRIV'|'';privilegedType?:string;canonicalFilename?:string};
export type RecognitionDecision={proposal?:RecognitionProposal;score:number;margin:number;reasons:string[];vetoes:string[];candidates:RecognitionCandidate[];normalizedPattern:string;automatic:boolean;decisionSource:'automatic'|'alias'|'review'};

export type EvidenceRecognitionInput={
 filename:string;
 authoritativeOrganization?:string;
 users:MatchableUser[];
 pdfIdentity?:RecognitionIdentity;
 pdfDate?:string;
 pdfArtifactKinds?:string[];
 contentCandidateUserIds?:string[];
 role?:'GEN'|'PRIV'|'';
 privilegedType?:string;
 aliases?:RecognitionAlias[];
 encryptedPdf?:boolean;
 duplicateSha256Identity?:string;
 canonicalFilename?:(proposal:RecognitionProposal)=>string|undefined;
};

const clean=(value:string)=>value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const comparable=(value:string)=>clean(value).toLocaleUpperCase('en-US').replace(/[\u2018\u2019]/g,"'").replace(/[^A-Z0-9']/g,'');
const tokens=(value:string)=>clean(value).toLocaleUpperCase('en-US').split(/[_\-.\s(),]+/).filter(Boolean);
const sameIdentity=(left:RecognitionIdentity,right:RecognitionIdentity)=>comparable(left.last)===comparable(right.last)&&comparable(left.first)===comparable(right.first);
const isoDate=(date:Date|undefined)=>date&&!Number.isNaN(date.getTime())?date.toISOString().slice(0,10):undefined;
const documentIdentityTokens=new Set(['8140','8570','AGREEMENT','AWARENESS','CERT','CERTIFICATE','CERTIFICATION','CHALLENGE','COURSE','CYBER','DOCUMENT','DOD','DOW','FORM','GENERAL','MEMO','PRIV','PRIVILEGED','RESPONSIBILITIES','SAAR','SCAN','TRAINING','UPLOADED','USER']);
const plausibleFilenameIdentity=(identity:RecognitionIdentity|undefined)=>!!identity&&!!comparable(identity.last)&&!!comparable(identity.first)&&!documentIdentityTokens.has(comparable(identity.last))&&!documentIdentityTokens.has(comparable(identity.first))&&!/^\d+$/.test(comparable(identity.last))&&!/^\d+$/.test(comparable(identity.first));

export function normalizedRecognitionPattern(filename:string){
 const withoutExtension=clean(filename).replace(/(?:\.pdf)?\.zip$|\.pdf$/i,'').replace(/\s*(?:-\s*)?(?:COPY|FINAL|SCAN(?:NED)?|SIGNED)\s*$/i,'').replace(/\s*\(\d+\)\s*$/,'').trim();
 const date=parseDate(withoutExtension),dateToken=date?`${String(date.getUTCDate()).padStart(2,'0')}${date.toLocaleString('en-US',{month:'short',timeZone:'UTC'}).toUpperCase()}${date.getUTCFullYear()}`:'';
 return withoutExtension.normalize('NFKC').toLocaleUpperCase('en-US').replace(/[\u2018\u2019]/g,"'").replace(dateToken,'{DATE}').split(/[_\-.\s(),]+/).filter(Boolean).join('|');
}

export function artifactKindCandidates(filename:string){
 const source=tokens(filename),set=new Set(source),compact=source.join(''),matches:string[]=[];
 for(const rule of artifactRecognitionRules){
  const any=rule.any?.some(value=>set.has(value))??false;
  const all=rule.all?.some(group=>group.every(value=>set.has(value)))??false;
  const compactMatch=rule.compact?.some(value=>compact.includes(value))??false;
  if(any||all||compactMatch)matches.push(rule.kind);
 }
 const current=artifactKindFromFilename(filename);if(current&&!matches.includes(current))matches.unshift(current);
 return matches;
}

export function ambiguousNumericDateToken(filename:string){
 const source=clean(filename).toLocaleUpperCase('en-US');
 for(const match of source.matchAll(/(?:^|[^A-Z0-9])(0?[1-9]|1[0-2])[-_. ](0?[1-9]|1[0-2])[-_. ]((?:19|20)\d{2})(?=$|[^A-Z0-9])/g)){
  if(match[1]!==match[2])return match[0].trim();
 }
 return'';
}

function identityPrefix(filename:string){
 const base=clean(filename).replace(/(?:\.pdf)?\.zip$|\.pdf$/i,''),organization=base.indexOf('(');
 if(organization>=0)return base.slice(0,organization).replace(/[_\s,.-]+$/,'');
 const date=parseDate(base),dateIndex=date?base.search(/(?:\d{1,4}[-_. ]*)?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|\d{2})/i):-1;
 return dateIndex>0?base.slice(0,dateIndex).replace(/[_\s,.-]+$/,''):base;
}

export function parseRecognitionIdentity(filename:string):{identity?:RecognitionIdentity;ambiguous:boolean;tokens:string[];reason?:string}{
 const prefix=identityPrefix(filename).replace(/\b(?:EDIPI|DOD\s*ID|EMPLOYEE\s*ID)\b\s*[:#-]?\s*\d{6,10}\b/ig,'').trim();
 if(!prefix)return{ambiguous:true,tokens:[],reason:'No filename identity was available.'};
 const comma=prefix.match(/^(.+?),\s*([^,]+)$/);
 if(comma){const last=clean(comma[1]),right=tokens(comma[2]);if(last&&right[0])return{identity:{last,first:clean(right[0]),middle:right[1]?.length===1?right[1]:undefined,suffix:right.find(value=>nameSuffixes.has(value))},ambiguous:false,tokens:tokens(prefix)}}
 const parts=prefix.split(/[_\.\s-]+/).map(clean).filter(Boolean);if(parts.length<2)return{ambiguous:true,tokens:parts,reason:'The filename does not contain both Last and First Name values.'};
 let suffix:string|undefined,middle:string|undefined;if(nameSuffixes.has(parts.at(-1)!.toUpperCase()))suffix=parts.pop();if(parts.length>=3&&parts.at(-1)!.length===1)middle=parts.pop();
 const upper=parts.map(value=>value.toUpperCase()),prefixMatch=surnamePrefixes.find(group=>group.every((value,index)=>upper[index]===value));
 if(prefixMatch&&parts.length>prefixMatch.length){return{identity:{last:parts.slice(0,-1).join(' '),first:parts.at(-1)!,middle,suffix},ambiguous:false,tokens:parts}}
 if(parts.length===2){
  const separatorAmbiguous=!prefix.includes('_')&&!prefix.includes(',')&&!prefix.includes('.');
  return{identity:{last:parts[0],first:parts[1],middle,suffix},ambiguous:separatorAmbiguous,tokens:parts,reason:separatorAmbiguous?'The two-name space-separated order may be First Last or Last First.':undefined};
 }
 return{identity:{last:parts[0],first:parts[1],middle,suffix},ambiguous:true,tokens:parts,reason:'The filename contains extra name tokens that cannot be assigned safely.'};
}

function candidateRecords(identity:RecognitionIdentity|undefined,organization:string|undefined,users:MatchableUser[]){
 if(!identity)return[];
 const incoming={last:identity.last,first:identity.first,organization:organization??'',email:''},sameOrganization=organization?users.filter(user=>user.organization.trim().toUpperCase()===organization.trim().toUpperCase()):users;
 const ranked=possibleExistingUserMatches(incoming,sameOrganization.length?sameOrganization:users,8);
 return ranked.map(match=>{const user=users.find(item=>item.id===match.userId)!;return{user,match}}).filter(item=>!!item.user);
}

export function recognizeEvidence(input:EvidenceRecognitionInput):RecognitionDecision{
 const reasons:string[]=[],vetoes:string[]=[],pattern=normalizedRecognitionPattern(input.filename),activeAliases=(input.aliases??[]).filter(alias=>!alias.revokedAtUtc&&alias.normalizedPattern===pattern),alias=activeAliases.find(item=>!input.authoritativeOrganization||item.organization.toUpperCase()===input.authoritativeOrganization.toUpperCase());
 const parsed=parseRecognitionIdentity(input.filename),filenameIdentity=plausibleFilenameIdentity(parsed.identity)?parsed.identity:undefined,filenameDate=isoDate(parseDate(input.filename)),filenameKinds=artifactKindCandidates(input.filename);let organization=clean(input.authoritativeOrganization||organizationFrom(input.filename)||'');const contentUserId=input.contentCandidateUserIds?.length===1?input.contentCandidateUserIds[0]:undefined,contentUser=contentUserId?input.users.find(user=>user.id===contentUserId):undefined;if(!organization&&contentUser){organization=clean(contentUser.organization);reasons.push(`Organization resolved from the uniquely matched directory user: ${organization}.`)}const placeholderOrg=/^(?:ORG|ORGANIZATION)$/i.test(organization);
 if(parsed.identity&&!filenameIdentity)reasons.push('Filename identity-like tokens describe the document rather than a person; PDF identity fallback is permitted.');
 if(parsed.reason)reasons.push(parsed.reason);if(filenameIdentity)reasons.push(`Filename identity: ${filenameIdentity.last}, ${filenameIdentity.first}.`);
 if(organization)reasons.push(`Authoritative organization: ${organization}.`);if(filenameKinds.length)reasons.push(`Filename artifact markers: ${filenameKinds.join(', ')}.`);if(filenameDate)reasons.push(`Filename date: ${filenameDate}.`);
 const contentKinds=Array.from(new Set(input.pdfArtifactKinds??[])),allKinds=Array.from(new Set([...filenameKinds,...contentKinds]));
 let identity=filenameIdentity??input.pdfIdentity,artifactKind=alias?.artifactKind??(allKinds.length===1?allKinds[0]:undefined);const date=input.pdfDate??filenameDate;
 if(alias){reasons.push(`Operator-approved alias ${alias.id} matched this normalized filename pattern.`);const aliasUser=alias.userId?input.users.find(user=>user.id===alias.userId):undefined;if(aliasUser)identity={last:aliasUser.last,first:aliasUser.first};artifactKind=alias.artifactKind||artifactKind}
 if(!organization||placeholderOrg)vetoes.push('Organization is unresolved or is a placeholder.');
 const ambiguousDate=ambiguousNumericDateToken(input.filename);if(ambiguousDate)vetoes.push(`Ambiguous numeric date ${ambiguousDate} requires operator review.`);
 if(filenameKinds.length>1||contentKinds.length>1||allKinds.length>1)vetoes.push(`Multiple artifact types were detected: ${allKinds.join(', ')}.`);
 if(filenameIdentity&&input.pdfIdentity&&!sameIdentity(filenameIdentity,input.pdfIdentity)){
  vetoes.push(`Filename identity ${filenameIdentity.last}, ${filenameIdentity.first} conflicts with PDF identity ${input.pdfIdentity.last}, ${input.pdfIdentity.first}.`);
  reasons.push(`PDF identity: ${input.pdfIdentity.last}, ${input.pdfIdentity.first}.`);
 }
 if(filenameDate&&input.pdfDate&&filenameDate!==input.pdfDate)vetoes.push(`Filename date ${filenameDate} conflicts with PDF date ${input.pdfDate}.`);
 if(input.pdfDate)reasons.push(`PDF date: ${input.pdfDate}.`);
 const identityOccurrences=identity?input.users.filter(user=>comparable(user.last)===comparable(identity!.last)&&comparable(user.first)===comparable(identity!.first)):[];
 if(new Set(identityOccurrences.map(user=>user.organization.trim().toUpperCase())).size>1)vetoes.push('The same identity exists in more than one organization.');
 const ranked=candidateRecords(identity,organization,input.users),candidates:RecognitionCandidate[]=ranked.slice(0,3).map(({user,match})=>({userId:user.id,last:user.last,first:user.first,organization:user.organization,label:match.label,score:match.score/100,reasons:[match.reason]}));
 const margin=candidates.length<2?1:Math.max(0,candidates[0].score-candidates[1].score);
 if(candidates.length>1&&margin<recognitionThresholds.minimumMargin)vetoes.push(`Candidate margin ${margin.toFixed(2)} is below ${recognitionThresholds.minimumMargin.toFixed(2)}.`);
 if((input.contentCandidateUserIds?.length??0)>1)vetoes.push('PDF text contains more than one plausible user identity.');
 if(filenameIdentity&&parsed.ambiguous&&!(candidates[0]?.score>=0.99&&margin>=recognitionThresholds.minimumMargin))vetoes.push(parsed.reason??'Filename identity order is ambiguous.');
 if(input.duplicateSha256Identity)vetoes.push(`The same PDF SHA-256 is already associated with ${input.duplicateSha256Identity}.`);
 const strictGate=evidenceFilenamePassesStorageGate(input.filename,organization||undefined);if(input.encryptedPdf&&!strictGate)vetoes.push('The encrypted PDF cannot be content-validated and does not already pass the strict canonical gate.');
 if(!identity)vetoes.push('Identity is unresolved.');if(!artifactKind)vetoes.push('Artifact type is unresolved.');if(!date)vetoes.push('Evidence date is unresolved.');
 const proposal:RecognitionProposal={identity,organization:organization&&!placeholderOrg?organization:undefined,artifactKind,date,role:input.role,privilegedType:input.privilegedType};
 if(proposal&&input.canonicalFilename)proposal.canonicalFilename=input.canonicalFilename(proposal);
 if(proposal.canonicalFilename&&proposal.organization&&!evidenceFilenamePassesStorageGate(proposal.canonicalFilename,proposal.organization))vetoes.push('The proposed filename does not pass the strict evidence storage gate.');
 let score=0;if(identity)score+=0.25;if(organization&&!placeholderOrg)score+=0.20;if(artifactKind)score+=0.20;if(date)score+=0.20;if(filenameIdentity&&filenameKinds.length===1&&(filenameDate||input.pdfDate))score+=0.13;else if(input.pdfIdentity&&input.pdfDate&&contentKinds.length===1)score+=0.13;if(input.pdfIdentity&&input.pdfDate)score+=0.02;if(alias)score=Math.max(score,0.99);score=Math.min(1,Number(score.toFixed(2)));
 const automatic=!!proposal.identity&&!!proposal.organization&&!!proposal.artifactKind&&!!proposal.date&&!!proposal.canonicalFilename&&score>=recognitionThresholds.automatic&&margin>=recognitionThresholds.minimumMargin&&!vetoes.length;
 return{proposal,score,margin,reasons,vetoes,candidates,normalizedPattern:pattern,automatic,decisionSource:alias?'alias':automatic?'automatic':'review'};
}
