export const artifactKinds=['SAAR','DoD Cyber Cert','GEN User Agreement','GEN and PRIV Agreement','8140 Cert Memo','Privileged User Training Cert','DTA Training Cert','DTA Agreement'];
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

function words(kind:string){if(kind==='SAAR')return['SAAR'];if(kind==='DoD Cyber Cert')return['DOD'];if(kind==='GEN User Agreement')return['GEN','USER'];if(kind==='GEN and PRIV Agreement')return['PRIV','AGREEMENT'];if(kind==='8140 Cert Memo')return['8140'];if(kind==='Privileged User Training Cert')return['PRIV','TRAINING'];if(kind==='DTA Training Cert')return['DTA','TRAINING'];return['DTA','AGREEMENT']}
export function filenameMatchesKind(filename:string,kind:string){const tokens=fileTokens(filename);return (kind==='SAAR'||!tokens.has('SAAR'))&&words(kind).every(word=>tokens.has(word))}
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
 const tokens=fileTokens(filename),hasGeneral=tokens.has('GEN'),hasPrivileged=tokens.has('PRIV');
 if(hasGeneral===hasPrivileged)return{valid:false,reason:'The SAAR filename must identify exactly one role: GEN or PRIV.'};
 if(hasGeneral)return{valid:true,identity,organization,role:'General',privilegedTypes:[]};
 const list=fileTokenList(filename),privIndex=list.indexOf('PRIV'),saarIndex=list.indexOf('SAAR'),privilegedType=privIndex>=0&&saarIndex>privIndex+1?clean(list[privIndex+1],200):'';
 if(!privilegedType||privilegedType==='TYPE')return{valid:false,reason:'A PRIV SAAR filename must contain the actual privileged account type between PRIV and SAAR.'};
 return{valid:true,identity,organization,role:'Privileged',privilegedTypes:[privilegedType]};
}
export const identityKey=(last:string,first:string)=>`${clean(last).toUpperCase()}\u0000${clean(first).toUpperCase()}`;
export function filenameIdentityMatches(filename:string,user:{last:string;first:string}){const identity=identityFromFilename(filename);return !!identity&&identityKey(identity.last,identity.first)===identityKey(user.last,user.first)}
