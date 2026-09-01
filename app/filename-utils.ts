export const agreementArtifactKind='User Agreement';
export const artifactKinds=['SAAR','DoD Cyber Cert',agreementArtifactKind,'8140 Cert Memo','Privileged User Training Cert','DTA Training Cert'];
const legacyAgreementKinds=new Set(['GEN User Agreement','GEN and PRIV Agreement','DTA Agreement']);
export const canonicalArtifactKind=(kind:string)=>legacyAgreementKinds.has(kind)?agreementArtifactKind:kind;
const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const clean=(value:string,max=500)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
type DateMatch={date:Date;start:number;end:number;normalized:string;defaultFormat:boolean};

export const fileTokenList=(value:string)=>value.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
export const fileTokens=(value:string)=>new Set(fileTokenList(value));

const calendarDate=(year:number,month:number,day:number)=>{const date=new Date(Date.UTC(year,month-1,day));return year>=1900&&year<=2099&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date:undefined};
const monthNumber=(value:string)=>/^\d+$/.test(value)?+value:months.indexOf(value.toUpperCase())+1;
const fourDigitYear=(value:string)=>value.length===2?(+value>=70?1900+ +value:2000+ +value):+value;
function dateMatch(filename:string):DateMatch|undefined{
 const value=filename.toUpperCase(),candidates:DateMatch[]=[];
 const add=(pattern:RegExp,parts:(match:RegExpExecArray)=>[string,string,string],defaultFormat=false)=>{
  for(const match of value.matchAll(pattern)){
   const start=match.index??0,end=start+match[0].length,before=value[start-1]??'',after=value[end]??'';
   if(/[A-Z0-9]/.test(before)||/[A-Z0-9]/.test(after))continue;
   const[yearValue,monthValue,dayValue]=parts(match),year=fourDigitYear(yearValue),month=monthNumber(monthValue),day=+dayValue,date=calendarDate(year,month,day);
   if(date)candidates.push({date,start,end,normalized:`${String(day).padStart(2,'0')}${months[month-1]}${year}`,defaultFormat})
  }
 };
 add(/(0[1-9]|[12]\d|3[01])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)((?:19|20)\d{2})/g,m=>[m[3],m[2],m[1]],true);
 add(/(3[01]|[12]\d|0?[1-9])[-_., ]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_., ]+((?:19|20)\d{2})/g,m=>[m[3],m[2],m[1]]);
 add(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_., ]*(3[01]|[12]\d|0?[1-9])[-_., ]*((?:19|20)\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/((?:19|20)\d{2})[-_., ]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_., ]*(3[01]|[12]\d|0?[1-9])/g,m=>[m[1],m[2],m[3]]);
 add(/(3[01]|[12]\d|0?[1-9])[-_., ]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_., ]+(\d{2})/g,m=>[m[3],m[2],m[1]]);
 add(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_., ]*(3[01]|[12]\d|0?[1-9])[-_., ]*(\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/((?:19|20)\d{2})[-_., ]*(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])/g,m=>[m[1],m[2],m[3]]);
 add(/((?:19|20)\d{2})[-_., ]+(1[0-2]|0?[1-9])[-_., ]+(3[01]|[12]\d|0?[1-9])/g,m=>[m[1],m[2],m[3]]);
 add(/(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])[-_., ]*((?:19|20)\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/(1[0-2]|0?[1-9])[-_., ]+(3[01]|[12]\d|0?[1-9])[-_., ]+((?:19|20)\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/(1[3-9]|2\d|3[01])[-_., ]*(0[1-9]|1[0-2])[-_., ]*((?:19|20)\d{2})/g,m=>[m[3],m[2],m[1]]);
 add(/(1[3-9]|2\d|3[01])[-_., ]+(1[0-2]|0?[1-9])[-_., ]+((?:19|20)\d{2})/g,m=>[m[3],m[2],m[1]]);
 add(/(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])[-_., ]*(\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/(1[0-2]|0?[1-9])[-_., ]+(3[01]|[12]\d|0?[1-9])[-_., ]+(\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/(1[3-9]|2\d|3[01])[-_., ]+(1[0-2]|0?[1-9])[-_., ]+(\d{2})/g,m=>[m[3],m[2],m[1]]);
 add(/(1[3-9]|[2-6]\d)[-_., ]*(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])/g,m=>[m[1],m[2],m[3]]);
 add(/((?:19|20)\d{2})[-_., ]+(1[3-9]|2\d|3[01])[-_., ]+(1[0-2]|0?[1-9])/g,m=>[m[1],m[3],m[2]]);
 const maximal=candidates.filter(candidate=>!candidates.some(other=>other!==candidate&&other.start<=candidate.start&&other.end>=candidate.end&&other.end-other.start>candidate.end-candidate.start));
 return maximal.sort((left,right)=>right.start-left.start||Number(right.defaultFormat)-Number(left.defaultFormat))[0]
}
export function parseDate(filename:string){return dateMatch(filename)?.date}
export function normalizeFilenameDate(filename:string){const match=dateMatch(filename);if(!match)return;const normalized=`${filename.slice(0,match.start)}${match.normalized}${filename.slice(match.end)}`;return{date:match.date,normalized,changed:normalized.toUpperCase()!==filename.toUpperCase()}}

export function organizationFrom(filename:string){const match=filename.match(/\(([^()]{1,100})\)/),organization=match?clean(match[1],100):'';return organization||undefined}

function saarMarkers(filename:string){
 const upper=(filename.split(/[\\/]/).pop()??filename).toUpperCase(),general=/(?:^|[^A-Z0-9])GEN[^A-Z0-9]*SAAR(?:[^A-Z0-9]|$)/.test(upper),privileged=upper.match(/(?:^|[^A-Z0-9])PRIV[^A-Z0-9]*([A-Z0-9]+?)[^A-Z0-9]*SAAR(?:[^A-Z0-9]|$)/);
 return{general,privilegedType:privileged?.[1]};
}
function hasSaarMarker(filename:string){const tokens=fileTokens(filename),markers=saarMarkers(filename);return tokens.has('SAAR')||markers.general||!!markers.privilegedType}
export function filenameMatchesKind(filename:string,kind:string){
 const canonical=canonicalArtifactKind(kind),tokens=fileTokens(filename),compact=filename.toUpperCase().replace(/[^A-Z0-9]+/g,''),saar=hasSaarMarker(filename);
 if(canonical==='SAAR')return saar;
 if(saar)return false;
 if(canonical==='DoD Cyber Cert')return tokens.has('DOD')||(compact.includes('DOD')&&compact.includes('CYBER'))||(compact.includes('CYBER')&&compact.includes('AWARENESS'))||compact.includes('AWARENESSCHALLENGE');
 if(canonical===agreementArtifactKind)return tokens.has('AGREEMENT')||tokens.has('AGREEMENTS')||compact.includes('AGREEMENT');
 if(canonical==='8140 Cert Memo')return tokens.has('8140')||compact.includes('8140');
 if(canonical==='Privileged User Training Cert')return (tokens.has('PRIV')&&tokens.has('TRAINING'))||(compact.includes('PRIV')&&compact.includes('TRAINING'));
 return (tokens.has('DTA')&&tokens.has('TRAINING'))||(compact.includes('DTA')&&compact.includes('TRAINING'));
}

const canonicalFilePart=(value:string,maxLength=80)=>clean(value,maxLength).replace(/[<>:"/\\|?*()]/g,' ').replace(/[^A-Za-z0-9'+.-]+/g,'_').replace(/^_+|_+$/g,'');
export function canonicalEvidenceFilename(filename:string,organizationOverride?:string){
 const identity=identityFromFilename(filename),organization=organizationOverride||organizationFrom(filename),date=parseDate(filename),kind=artifactKinds.find(candidate=>filenameMatchesKind(filename,candidate));
 if(!identity||!organization||!date||!kind)return;
 const last=canonicalFilePart(identity.last),first=canonicalFilePart(identity.first),org=canonicalFilePart(organization),dateToken=`${String(date.getUTCDate()).padStart(2,'0')}${months[date.getUTCMonth()]}${date.getUTCFullYear()}`;if(!last||!first||!org)return;
 let artifact=kind.replaceAll(' ','_');
 if(kind==='SAAR'){const markers=saarMarkers(filename);if(markers.general===!!markers.privilegedType)return;artifact=markers.general?'GEN_SAAR':`PRIV_${canonicalFilePart(markers.privilegedType??'')}_SAAR`;if(artifact.includes('__'))return}
 const extension=/\.zip$/i.test(filename)?'.pdf.zip':'.pdf',target=`${last}_${first}_(${org})_${artifact}_${dateToken}${extension}`;
 return target.length<=180?target:undefined;
}

export function trainingCertificateRecoveryKind(filename:string){
 const compact=filename.toUpperCase().replace(/[^A-Z0-9]+/g,''),kind=compact.includes('CYBERAWARENESS')||compact.includes('AWARENESSCHALLENGE')?'DoD Cyber Cert':compact.includes('PRIVUSERTRAINING')||compact.includes('PRIVILEGEDUSERTRAINING')||compact.includes('PRIVILEGEDACCESSTRAINING')||compact.includes('PRIVILEGEDUSERCYBERSECURITYRESPONSIBILITIES')?'Privileged User Training Cert':'';
 if(!kind)return;
 const identity=identityFromFilename(filename),organization=organizationFrom(filename),identityComplete=!!identity&&!['LAST','FIRST'].includes(identity.last.toUpperCase())&&!['LAST','FIRST'].includes(identity.first.toUpperCase()),organizationComplete=!!organization&&!['ORG','ORGANIZATION'].includes(organization.toUpperCase());
 return identityComplete&&organizationComplete&&filenameMatchesKind(filename,kind)&&!!parseDate(filename)?undefined:kind;
}
export function looksLikeEvidenceFilename(filename:string){return !!parseDate(filename)&&artifactKinds.some(kind=>filenameMatchesKind(filename,kind))}

export function identityFromFilename(filename:string){
 const base=filename.split(/[\\/]/).pop()??filename;
 const match=base.match(/^\s*([^_,()\s]+)\s*(?:_\s*|,\s*|\s+)([^_,()\s]+)(?=\s*(?:_|,|\(|\s))/);
 if(!match)return;
 const last=clean(match[1]),first=clean(match[2]);
 return last&&first?{last,first}:undefined;
}
export type NewUserSaarFilenameValidation=
 |{valid:true;identity:{last:string;first:string};organization:string;role:'General'|'Privileged';privilegedTypes:string[]}
 |{valid:false;reason:string};
export function validateNewUserSaarFilename(filename:string,fallback?:{identity?:{last:string;first:string};organization?:string}):NewUserSaarFilenameValidation{
 if(!filenameMatchesKind(filename,'SAAR'))return{valid:false,reason:'The filename is not recognized as a SAAR.'};
 const filenameIdentity=identityFromFilename(filename),reservedIdentityTokens=new Set(['LAST','FIRST','ORG','ORGANIZATION','GEN','PRIV','SAAR','DOD','CYBER','CERT','USER','AGREEMENT','TRAINING','MEMO','TYPE']),filenameIdentityUsable=filenameIdentity&&!reservedIdentityTokens.has(filenameIdentity.last.toUpperCase())&&!reservedIdentityTokens.has(filenameIdentity.first.toUpperCase()),identity=filenameIdentityUsable?filenameIdentity:fallback?.identity;
 if(!identity)return{valid:false,reason:'The SAAR filename must begin with Last Name followed by First Name.'};
 if(identity.last.toUpperCase()==='LAST'&&identity.first.toUpperCase()==='FIRST')return{valid:false,reason:'The SAAR filename still contains the Last_First template placeholders and the form identity could not be read.'};
 const filenameOrganization=organizationFrom(filename),organization=filenameOrganization&&!['ORG','ORGANIZATION'].includes(filenameOrganization.toUpperCase())?filenameOrganization:fallback?.organization;
 if(!organization)return{valid:false,reason:'The SAAR filename is missing its parenthesized organization.'};
 if(['ORG','ORGANIZATION'].includes(organization.toUpperCase()))return{valid:false,reason:'The SAAR filename still contains the organization template placeholder and the form organization could not be read.'};
 if(!parseDate(filename))return{valid:false,reason:'The SAAR filename is missing a valid recognized date.'};
 const markers=saarMarkers(filename),hasGeneral=markers.general,hasPrivileged=!!markers.privilegedType;
 if(hasGeneral===hasPrivileged)return{valid:false,reason:'The SAAR filename must identify exactly one role: GEN or PRIV.'};
 if(hasGeneral)return{valid:true,identity,organization,role:'General',privilegedTypes:[]};
 const privilegedType=clean(markers.privilegedType??'',200);
 if(!privilegedType||privilegedType==='TYPE')return{valid:false,reason:'A PRIV SAAR filename must contain the actual privileged account type between PRIV and SAAR.'};
 return{valid:true,identity,organization,role:'Privileged',privilegedTypes:[privilegedType]};
}
export const identityKey=(last:string,first:string)=>`${clean(last).toUpperCase()}\u0000${clean(first).toUpperCase()}`;
export function filenameIdentityMatches(filename:string,user:{last:string;first:string}){const identity=identityFromFilename(filename);return !!identity&&identityKey(identity.last,identity.first)===identityKey(user.last,user.first)}
