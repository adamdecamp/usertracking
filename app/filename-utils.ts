import {normalizePrivilegedType} from './privileged-type-utils.ts';

export const agreementArtifactKind='User Agreement';
export const artifactKinds=['SAAR','DoD Cyber Cert',agreementArtifactKind,'8140 Cert Memo','Privileged User Training Cert','DTA Training'];
const legacyAgreementKinds=new Set(['GEN USER AGREEMENT','GEN AND PRIV AGREEMENT']);
export const canonicalArtifactKind=(kind:string)=>{const normalized=kind.trim().toUpperCase();if(legacyAgreementKinds.has(normalized))return agreementArtifactKind;if(normalized==='DTA TRAINING CERT')return'DTA Training';if(normalized==='8140 CERTIFICATION MEMO')return'8140 Cert Memo';if(normalized==='PRIVILEGED USER TRAINING')return'Privileged User Training Cert';return artifactKinds.find(value=>value.toUpperCase()===normalized)??kind};
export function artifactStorageFolder(kind:string){
 const canonical=canonicalArtifactKind(kind);
 return canonical==='SAAR'?'SAAR':canonical==='DoD Cyber Cert'?'DoD Cyber Cert':canonical===agreementArtifactKind?'User Agreement':canonical==='8140 Cert Memo'?'8140 Certification Memo':canonical==='Privileged User Training Cert'?'Privileged User Training':canonical==='DTA Training'?'DTA Training':undefined
}
const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const monthSpellings=[
 ['JAN','JANUARY','JANURARY'],
 ['FEB','FEBRUARY','FEBUARY','FEBURARY','FEBRURARY'],
 ['MAR','MARCH','MARH'],
 ['APR','APRIL','APRL'],
 ['MAY'],
 ['JUN','JUNE'],
 ['JUL','JULY','JLY'],
 ['AUG','AUGUST','AGU','AGUST'],
 ['SEP','SEPT','SEPTEMBER','SEPEMBER','SEPTMBER','SEPTEMER','SEPTEBER','SEPTMEBER','SEPTEMEBER'],
 ['OCT','OCTOBER','OCTBER','OCTOBR'],
 ['NOV','NOVEMBER','NOVMBER','NOVEMER','NOVEMEBER'],
 ['DEC','DECEMBER','DECMBER','DECEMER','DECEMEBER'],
] as const;
const monthAliases=new Map<string,number>(monthSpellings.flatMap((spellings,index)=>spellings.map(spelling=>[spelling,index+1] as const))),monthNamePattern=[...monthAliases.keys()].sort((left,right)=>right.length-left.length).join('|');
const clean=(value:string,max=500)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const documentTitleIdentityWords=new Set(['ACCESS','AGREEMENT','AWARENESS','CERTIFICATE','CHALLENGE','COMPLETION','COURSE','CYBER','DOD','GENERAL','INFORMATION','NAME','PRIVILEGED','REQUEST','SECURITY','SYSTEM','TRAINING','USER']);
type DateMatch={date:Date;start:number;end:number;normalized:string;defaultFormat:boolean};
const filenameCacheLimit=20000,dateCache=new Map<string,DateMatch|null>(),tokenListCache=new Map<string,string[]>(),tokenSetCache=new Map<string,Set<string>>(),compactCache=new Map<string,string>(),organizationCache=new Map<string,string|null>(),identityCache=new Map<string,{last:string;first:string}|null>(),artifactKindCache=new Map<string,string|null>();
function remember<K,V>(cache:Map<K,V>,key:K,value:V){if(cache.size>=filenameCacheLimit)cache.clear();cache.set(key,value);return value}

export const fileTokenList=(value:string)=>tokenListCache.get(value)??remember(tokenListCache,value,value.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
export const fileTokens=(value:string)=>tokenSetCache.get(value)??remember(tokenSetCache,value,new Set(fileTokenList(value)));
const compactFilename=(value:string)=>compactCache.get(value)??remember(compactCache,value,value.toUpperCase().replace(/[^A-Z0-9]+/g,''));

const calendarDate=(year:number,month:number,day:number)=>{const date=new Date(Date.UTC(year,month-1,day));return year>=1900&&year<=2099&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date:undefined};
const ordinalDate=(year:number,dayOfYear:number)=>{if(year<1900||year>2099||dayOfYear<1||dayOfYear>366)return;const date=new Date(Date.UTC(year,0,dayOfYear));return date.getUTCFullYear()===year?date:undefined};
const monthNumber=(value:string)=>/^\d+$/.test(value)?+value:monthAliases.get(value.toUpperCase())??0;
const fourDigitYear=(value:string)=>value.length===2?(+value>=70?1900+ +value:2000+ +value):+value;
function computeDateMatch(filename:string):DateMatch|undefined{
 const value=filename.toUpperCase(),candidates:DateMatch[]=[];
 // Numeric month/day values are locale-dependent when both values are 1-12.
 // They must be resolved by an operator rather than silently interpreted as US order.
 if([...value.matchAll(/(?:^|[^A-Z0-9])(0?[1-9]|1[0-2])[-_. ](0?[1-9]|1[0-2])[-_. ]((?:19|20)\d{2})(?=$|[^A-Z0-9])/g)].some(match=>match[1]!==match[2]))return;
 // One separator class (not \s*[:#_-]*\s*) keeps this linear on long runs of spaces.
 const blockedIdentifierRanges=[...value.matchAll(/(?:^|[^A-Z0-9])(?:EMPLOYEE[-_. ]*)?(?:ID|EDIPI|DOD[-_. ]*ID)[\s:#_-]*(\d{5,10})(?=$|[^A-Z0-9])/g)].map(match=>{const token=match[1],start=(match.index??0)+match[0].lastIndexOf(token);return{start,end:start+token.length}});
 const blocked=(start:number,end:number)=>blockedIdentifierRanges.some(range=>start<range.end&&end>range.start);
 const bounded=(start:number,end:number)=>!/[A-Z0-9]/.test(value[start-1]??'')&&!/[A-Z0-9]/.test(value[end]??'');
 const push=(date:Date,start:number,end:number,defaultFormat=false)=>candidates.push({date,start,end,normalized:`${String(date.getUTCDate()).padStart(2,'0')}${months[date.getUTCMonth()]}${date.getUTCFullYear()}`,defaultFormat});
 const add=(pattern:RegExp,parts:(match:RegExpExecArray)=>[string,string,string],defaultFormat=false)=>{
  for(const match of value.matchAll(pattern)){
   const start=match.index??0,end=start+match[0].length,before=value[start-1]??'',after=value[end]??'';
   if(/[A-Z0-9]/.test(before)||/[A-Z0-9]/.test(after)||blocked(start,end))continue;
   const[yearValue,monthValue,dayValue]=parts(match),year=fourDigitYear(yearValue),month=monthNumber(monthValue),day=+dayValue,date=calendarDate(year,month,day);
   if(date)push(date,start,end,defaultFormat)
  }
 };
 const addOrdinal=(pattern:RegExp,parts:(match:RegExpExecArray)=>[string,string])=>{
  for(const match of value.matchAll(pattern)){
   const start=match.index??0,end=start+match[0].length;if(!bounded(start,end)||blocked(start,end))continue;
   const[yearValue,ordinalValue]=parts(match),date=ordinalDate(fourDigitYear(yearValue),+ordinalValue);if(date)push(date,start,end)
  }
 };
 add(/(0[1-9]|[12]\d|3[01])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)((?:19|20)\d{2})/g,m=>[m[3],m[2],m[1]],true);
 add(new RegExp(`(0[1-9]|[12]\\d|3[01])(${monthNamePattern})((?:19|20)\\d{2})`,'g'),m=>[m[3],m[2],m[1]]);
 add(new RegExp(`([1-9])(${monthNamePattern})((?:19|20)\\d{2})`,'g'),m=>[m[3],m[2],m[1]]);
 add(new RegExp(`(3[01]|[12]\\d|0?[1-9])[-_., ]+(${monthNamePattern})[-_., ]+((?:19|20)\\d{2})`,'g'),m=>[m[3],m[2],m[1]]);
 add(new RegExp(`(${monthNamePattern})[-_., ]*(3[01]|[12]\\d|0?[1-9])[-_., ]*((?:19|20)\\d{2})`,'g'),m=>[m[3],m[1],m[2]]);
 add(new RegExp(`((?:19|20)\\d{2})[-_., ]*(${monthNamePattern})[-_., ]*(3[01]|[12]\\d|0?[1-9])`,'g'),m=>[m[1],m[2],m[3]]);
 add(new RegExp(`(3[01]|[12]\\d|0?[1-9])[-_., ]+(${monthNamePattern})[-_., ]+(\\d{2})`,'g'),m=>[m[3],m[2],m[1]]);
 add(new RegExp(`(0[1-9]|[12]\\d|3[01])(${monthNamePattern})(\\d{2})`,'g'),m=>[m[3],m[2],m[1]]);
 add(new RegExp(`([1-9])(${monthNamePattern})(\\d{2})`,'g'),m=>[m[3],m[2],m[1]]);
 add(new RegExp(`(${monthNamePattern})[-_., ]*(3[01]|[12]\\d|0?[1-9])[-_., ]*(\\d{2})`,'g'),m=>[m[3],m[1],m[2]]);
 add(new RegExp(`(3[2-9]|[4-9]\\d)[-_., ]*(${monthNamePattern})[-_., ]*(0[1-9]|[12]\\d|3[01])`,'g'),m=>[m[1],m[2],m[3]]);
 add(/((?:19|20)\d{2})[-_., ]*(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])Z/g,m=>[m[1],m[2],m[3]]);
 add(/((?:19|20)\d{2})[-_., ]*(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])/g,m=>[m[1],m[2],m[3]]);
 add(/((?:19|20)\d{2})[-_., ]+(1[0-2]|0?[1-9])[-_., ]+(3[01]|[12]\d|0?[1-9])/g,m=>[m[1],m[2],m[3]]);
 add(/(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])[-_., ]*((?:19|20)\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/(1[0-2]|0?[1-9])[-_., ]+(3[01]|[12]\d|0?[1-9])[-_., ]+((?:19|20)\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/(1[3-9]|2\d|3[01])[-_., ]*(0[1-9]|1[0-2])[-_., ]*((?:19|20)\d{2})/g,m=>[m[3],m[2],m[1]]);
 add(/(1[3-9]|2\d|3[01])[-_., ]+(1[0-2]|0?[1-9])[-_., ]+((?:19|20)\d{2})/g,m=>[m[3],m[2],m[1]]);
 add(/(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])[-_., ]*(\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/(1[0-2]|0?[1-9])[-_., ]+(3[01]|[12]\d|0?[1-9])[-_., ]+(\d{2})/g,m=>[m[3],m[1],m[2]]);
 add(/(1[3-9]|2\d|3[01])[-_., ]*(0[1-9]|1[0-2])[-_., ]*(\d{2})/g,m=>[m[3],m[2],m[1]]);
 add(/(3[2-9]|[4-9]\d)[-_., ]*(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12]\d|3[01])/g,m=>[m[1],m[2],m[3]]);
 add(/((?:19|20)\d{2})[-_., ]+(1[3-9]|2\d|3[01])[-_., ]+(1[0-2]|0?[1-9])/g,m=>[m[1],m[3],m[2]]);
 addOrdinal(/(\d{2})[-_., ]+(\d{3})/g,m=>[m[1],m[2]]);
 addOrdinal(/(\d{3})[-_., ]+(\d{2})/g,m=>[m[2],m[1]]);
 addOrdinal(/((?:19|20)\d{2})[-_., ]+(\d{3})/g,m=>[m[1],m[2]]);
 addOrdinal(/(\d{3})[-_., ]+((?:19|20)\d{2})/g,m=>[m[2],m[1]]);
 for(const match of value.matchAll(/\d{7}|\d{5}/g)){
  const start=match.index??0,end=start+match[0].length;if(!bounded(start,end)||blocked(start,end))continue;
  const token=match[0],possibilities=token.length===5
   ?[ordinalDate(fourDigitYear(token.slice(0,2)),+token.slice(2)),ordinalDate(fourDigitYear(token.slice(3)),+token.slice(0,3))]
   :[ordinalDate(+token.slice(0,4),+token.slice(4)),ordinalDate(+token.slice(3),+token.slice(0,3))];
  const valid=possibilities.filter((date):date is Date=>!!date),unique=[...new Map(valid.map(date=>[date.getTime(),date])).values()];
  if(unique.length===1)push(unique[0],start,end)
 }
 const maximal=candidates.filter(candidate=>!candidates.some(other=>other!==candidate&&other.start<=candidate.start&&other.end>=candidate.end&&other.end-other.start>candidate.end-candidate.start));
 return maximal.sort((left,right)=>right.start-left.start||Number(right.defaultFormat)-Number(left.defaultFormat))[0]
}
function dateMatch(filename:string):DateMatch|undefined{const cached=dateCache.get(filename);if(cached!==undefined)return cached??undefined;return remember(dateCache,filename,computeDateMatch(filename)??null)??undefined}
export function parseDate(filename:string){return dateMatch(filename)?.date}
/**
 * True when an evidence date is later than any place on Earth could call today.
 * UTC+14 runs one day ahead of UTC, so dates through tomorrow (UTC) are allowed.
 * A typo such as 2099 must never count as current evidence.
 */
export function evidenceDateIsInFuture(date:Date,now=new Date()){return Math.floor(date.getTime()/86_400_000)>Math.floor(now.getTime()/86_400_000)+1}
export function normalizeFilenameDate(filename:string){const match=dateMatch(filename);if(!match)return;const normalized=`${filename.slice(0,match.start)}${match.normalized}${filename.slice(match.end)}`;return{date:match.date,normalized,changed:normalized.toUpperCase()!==filename.toUpperCase()}}

export function organizationFrom(filename:string){const cached=organizationCache.get(filename);if(cached!==undefined)return cached??undefined;const match=filename.match(/\(([^()]{1,100})\)/),organization=match?clean(match[1],100):'';return remember(organizationCache,filename,organization||null)??undefined}

function filenameDescriptor(filename:string){
 const base=(filename.split(/[\\/]/).pop()??filename).replace(/(?:\.pdf)?\.zip$|\.pdf$/i,''),organization=base.match(/\([^()]{1,100}\)/);
 const descriptor=organization?base.slice((organization.index??0)+organization[0].length):base,dated=dateMatch(descriptor);
 return dated?`${descriptor.slice(0,dated.start)}${descriptor.slice(dated.end)}`:descriptor;
}
const compactHasPair=(value:string,left:string,right:string)=>value.includes(`${left}${right}`)||value.includes(`${right}${left}`);
function saarDocumentMarker(filename:string){
 const descriptor=filenameDescriptor(filename),tokens=fileTokens(descriptor),compact=compactFilename(descriptor);
 return tokens.has('SAAR')||compact.includes('GENSAAR')||(tokens.has('2875')&&(tokens.has('DD')||tokens.has('FORM')))||compactHasPair(compact,'DD','2875')||compactHasPair(compact,'FORM','2875')||(tokens.has('ACCESS')&&tokens.has('REQUEST'))||compactHasPair(compact,'ACCESS','REQUEST');
}
function saarMarkers(filename:string){
 const upper=filenameDescriptor(filename).toUpperCase(),document='(?:SAAR|(?:DD[^A-Z0-9]*)?FORM[^A-Z0-9]*2875|DD[^A-Z0-9]*2875|(?:SYSTEM[^A-Z0-9]*(?:AUTHORIZATION[^A-Z0-9]*)?)?ACCESS[^A-Z0-9]*REQUEST)',general=new RegExp(`(?:^|[^A-Z0-9])GEN(?:ERAL)?[^A-Z0-9]*${document}(?:[^A-Z0-9]|$)`).test(upper),privileged=upper.match(new RegExp(`(?:^|[^A-Z0-9])PRIV(?:ILEGED)?[^A-Z0-9]*([A-Z0-9]+?)[^A-Z0-9]*${document}(?:[^A-Z0-9]|$)`));
 return{general,privilegedType:privileged?.[1]};
}
function hasSaarMarker(filename:string){const markers=saarMarkers(filename);return saarDocumentMarker(filename)||markers.general||!!markers.privilegedType}
export function legacy8570MemoFilename(filename:string){return !hasSaarMarker(filename)&&fileTokens(filenameDescriptor(filename)).has('8570')}

/**
 * Returns one unambiguous artifact type for a filename. Rules are deliberately
 * ordered from the most specific document markers to the broad legacy aliases.
 * Only the basename is inspected. When the required parenthesized organization
 * marker is present, its identity and organization prefix is excluded too.
 */
export function artifactKindFromFilename(filename:string){
 const cached=artifactKindCache.get(filename);if(cached!==undefined)return cached??undefined;
 const descriptor=filenameDescriptor(filename),tokens=fileTokens(descriptor),compact=compactFilename(descriptor),has=(value:string)=>tokens.has(value);
 const trainingWords=['TRAINING','COURSE','RESPONSIBILITIES'],certificateWords=['CERT','CERTIFICATE','CERTIFICATION'],evidenceWords=[...trainingWords,...certificateWords],hasTrainingAlias=trainingWords.some(has),hasCertificateAlias=certificateWords.some(has),trainingPattern='(?:TRAINING|COURSE|RESPONSIBILITIES|CERT|CERTIFICATE|CERTIFICATION)';
 const has8140DocumentAlias=certificateWords.some(certificate=>['MEMO','LETTER'].some(document=>has(certificate)&&has(document)||compactHasPair(compact,certificate,document)));
 const hasStrongCyberAlias=has('AWARENESS')||((has('DOD')||has('DOW'))&&has('CYBER'))||compactHasPair(compact,'DOD','CYBER')||compactHasPair(compact,'DOW','CYBER')||compactHasPair(compact,'CYBER','AWARENESS')||compactHasPair(compact,'AWARENESS','CHALLENGE');
 const hasCyberCertificateAlias=(has('CYBER')&&(has('CERT')||has('CERTIFICATE')))||compactHasPair(compact,'CYBER','CERT')||compactHasPair(compact,'CYBER','CERTIFICATE');
 const hasDtaTrainingAlias=(has('DTA')||compact.includes('DATATRANSFERAGENT'))&&(hasTrainingAlias||hasCertificateAlias)||new RegExp(`^(?:(?:DTA|DATATRANSFERAGENT)(?:USER)?${trainingPattern}(?:CERT|CERTIFICATE|CERTIFICATION)?|${trainingPattern}(?:DTA|DATATRANSFERAGENT))$`).test(compact)||evidenceWords.some(value=>compact===`DTA${value}`||compact===`${value}DTA`);
 const hasPrivilegedTrainingAlias=(has('PRIV')||has('PRIVILEGED'))&&(hasTrainingAlias||hasCertificateAlias)||new RegExp(`^(?:PRIV(?:ILEGED)?(?:USER|ACCESS)?(?:CYBERSECURITY)?${trainingPattern}(?:CERT|CERTIFICATE|CERTIFICATION)?|${trainingPattern}PRIV(?:ILEGED)?)$`).test(compact)||evidenceWords.some(value=>compact===`PRIV${value}`||compact===`${value}PRIV`||compact===`PRIVILEGED${value}`||compact===`${value}PRIVILEGED`);
 // DTA Agreement is no longer a recognized artifact; only an explicit "User Agreement" survives a DTA marker.
 const retiredDtaAgreement=(has('DTA')||compact.includes('DATATRANSFERAGENT')||compact.includes('DTAAGREEMENT')||compact.includes('AGREEMENTDTA'))&&!has('USER')&&!compact.includes('USERAGREEMENT');
 let result:string|undefined;
 if(hasSaarMarker(filename))result='SAAR';
 else if(!retiredDtaAgreement&&(has('AGREEMENT')||has('AGREEMENTS')||compact.includes('AGREEMENT')||compactHasPair(compact,'ACCEPTABLE','USE')))result='User Agreement';
 else if(has('8140')||compact.includes('8140')||has('8570'))result='8140 Cert Memo';
 else if(hasDtaTrainingAlias)result='DTA Training';
 else if(hasPrivilegedTrainingAlias)result='Privileged User Training Cert';
 else if(hasStrongCyberAlias)result='DoD Cyber Cert';
 else if(has8140DocumentAlias)result='8140 Cert Memo';
 else if(hasCyberCertificateAlias)result='DoD Cyber Cert';
 else if(has('RESPONSIBILITIES')||has('COURSE'))result='Privileged User Training Cert';
 return remember(artifactKindCache,filename,result??null)??undefined;
}
export function filenameMatchesKind(filename:string,kind:string){return artifactKindFromFilename(filename)===canonicalArtifactKind(kind)}
export function disabledSaarFilename(filename:string){return filenameMatchesKind(filename,'SAAR')&&fileTokens(filename).has('DISABLED')}

const canonicalFilePart=(value:string,maxLength=80)=>clean(value,maxLength).replace(/[<>:"/\\|?*()]/g,' ').replace(/[^A-Za-z0-9'+.-]+/g,'_').replace(/^_+|_+$/g,'');
export function organizationArtifactStorageFolder(kind:string,organization:string){const folder=artifactStorageFolder(kind),prefix=canonicalFilePart(organization);return folder&&prefix?`${prefix} ${folder}`:undefined}
export function canonicalManualEvidenceFilename(input:{filename:string;embeddedPdfFilename?:string;kind:string;last:string;first:string;organization:string;role?:'GEN'|'PRIV';privilegedType?:string;disabledSaar?:boolean}){
 const date=parseDate(input.filename)??parseDate(input.embeddedPdfFilename??''),kind=canonicalArtifactKind(input.kind),last=canonicalFilePart(input.last),first=canonicalFilePart(input.first),organization=canonicalFilePart(input.organization);
 if(!date||evidenceDateIsInFuture(date)||!artifactKinds.includes(kind)||!last||!first||!organization)return;
 let artifact=kind.replaceAll(' ','_');
 if(kind==='DTA Training')artifact='DTA_Training';
 if(kind==='SAAR'){
  if(input.role==='GEN')artifact='GEN_SAAR';
  else if(input.role==='PRIV'){const privilegedType=canonicalFilePart(normalizePrivilegedType(input.privilegedType??''));if(!privilegedType)return;artifact=`PRIV_${privilegedType}_SAAR`}
  else return;
  if(input.disabledSaar)artifact+='_DISABLED';
 }
 const dateToken=`${String(date.getUTCDate()).padStart(2,'0')}${months[date.getUTCMonth()]}${date.getUTCFullYear()}`,target=`${last}_${first}_(${organization})_${artifact}_${dateToken}.pdf.zip`;
 return target.length<=180?target:undefined;
}
export function canonicalEvidenceFilename(filename:string,organizationOverride?:string){
 if(legacy8570MemoFilename(filename))return;
 const identity=identityFromFilename(filename),organization=organizationOverride||organizationFrom(filename),date=parseDate(filename),kind=artifactKindFromFilename(filename);
 if(!identity||!organization||!date||evidenceDateIsInFuture(date)||!kind)return;
 const last=canonicalFilePart(identity.last),first=canonicalFilePart(identity.first),org=canonicalFilePart(organization),dateToken=`${String(date.getUTCDate()).padStart(2,'0')}${months[date.getUTCMonth()]}${date.getUTCFullYear()}`;if(!last||!first||!org)return;
 let artifact=kind.replaceAll(' ','_');
 if(kind==='DTA Training')artifact='DTA_Training';
 if(kind==='SAAR'){const markers=saarMarkers(filename);if(markers.general===!!markers.privilegedType)return;artifact=markers.general?'GEN_SAAR':`PRIV_${canonicalFilePart(normalizePrivilegedType(markers.privilegedType??''))}_SAAR`;if(artifact.includes('__'))return}
 const extension=/\.zip$/i.test(filename)?'.pdf.zip':'.pdf',target=`${last}_${first}_(${org})_${artifact}_${dateToken}${extension}`;
 return target.length<=180?target:undefined;
}

export function pdfFilenameNeedsRework(filename:string,organizationOverride?:string){
 if(!filename.toLowerCase().endsWith('.pdf'))return false;
 return !evidenceFilenamePassesStorageGate(filename,organizationOverride);
}

export function zipFilenameNeedsRework(filename:string,organizationOverride?:string){
 if(!filename.toLowerCase().endsWith('.zip'))return false;
 return !evidenceFilenamePassesStorageGate(filename,organizationOverride);
}

/**
 * The document-type organizer is intentionally fail-closed. Fault-tolerant input
 * names are normalized before this gate; only the resulting complete canonical
 * name may enter a managed document-type folder.
 */
export function evidenceFilenamePassesStorageGate(filename:string,organizationOverride?:string){
 if(!/\.pdf(?:\.zip)?$/i.test(filename))return false;
 if(legacy8570MemoFilename(filename)){
  const identity=identityFromFilename(filename),organization=organizationFrom(filename),date=parseDate(filename);
  if(!identity||!organization||!date||evidenceDateIsInFuture(date))return false;
  return !organizationOverride||clean(organization).toUpperCase()===clean(organizationOverride).toUpperCase();
 }
 if(filenameMatchesKind(filename,'SAAR')&&!validateNewUserSaarFilename(filename,{organization:organizationOverride,allowDisabled:true}).valid)return false;
 const canonical=canonicalEvidenceFilename(filename,organizationOverride);
 return !!canonical&&canonical.toUpperCase()===filename.toUpperCase();
}

/**
 * INCOMPLETE is an operator-applied disposition, not an evidence type. Match it
 * only as a standalone filename token so words such as "incompleteness" do not
 * trigger an irreversible cleanup action.
 */
export function operatorMarkedIncomplete(filename:string){
 const base=filename.split(/[\\/]/).pop()??filename;
 return/(?:^|[^A-Z0-9])INCOMPLETE(?:[^A-Z0-9]|$)/i.test(base);
}

export function looksLikeEvidenceFilename(filename:string){return !!parseDate(filename)&&!!artifactKindFromFilename(filename)}

/** Drop trailing _ , . - and whitespace in linear time (an end-anchored regex is quadratic on long inner runs). */
function trimTrailingSeparators(value:string){let end=value.length;while(end>0&&/[_,\s.-]/.test(value[end-1]))end--;return value.slice(0,end)}

export function identityFromFilename(filename:string){
 const cached=identityCache.get(filename);if(cached!==undefined)return cached??undefined;
 const base=filename.split(/[\\/]/).pop()??filename,prefix=trimTrailingSeparators(base.split('(')[0]).trim(),comma=prefix.match(/^(.+?),\s*([^,\s_]+)/);let last='',first='';
 if(comma){last=clean(comma[1]);first=clean(comma[2])}
 else{
  const parts=prefix.split(/_+|\s+/).map(value=>clean(value)).filter(Boolean),suffixes=new Set(['JR','SR','II','III','IV','V']);if(suffixes.has(parts.at(-1)?.toUpperCase()??''))parts.pop();if(parts.length>=3&&parts.at(-1)?.length===1)parts.pop();
  const surnamePrefix=/^(?:VAN|VON|DE|DEL|DA|DI|LA|LE|ST|SAINT)$/i.test(parts[0]??'');
  if(parts.length===2){last=parts[0];first=parts[1]}else if(parts.length>=3&&surnamePrefix){const organizationIndex=parts.findIndex(value=>value.startsWith('(')),nameParts=organizationIndex>0?parts.slice(0,organizationIndex):parts;last=nameParts.slice(0,-1).join(' ');first=nameParts.at(-1)!}else if(parts.length>=2){last=parts[0];first=parts[1]}
 }
 return remember(identityCache,filename,last&&first&&plausiblePersonIdentity(last,first)?{last,first}:null)??undefined;
}
export function plausiblePersonIdentity(last:string,first:string){
 const lastToken=clean(last,80).toUpperCase().replace(/[^A-Z0-9]+/g,''),firstToken=clean(first,80).toUpperCase().replace(/[^A-Z0-9]+/g,'');
 if(!lastToken||!firstToken||lastToken==='LAST'&&firstToken==='FIRST')return false;
 return!(documentTitleIdentityWords.has(lastToken)&&documentTitleIdentityWords.has(firstToken));
}
export type NewUserSaarFilenameValidation=
 |{valid:true;identity:{last:string;first:string};organization:string;role:'General'|'Privileged';privilegedTypes:string[]}
 |{valid:false;reason:string};
const verifiedAccountDate=(date?:Date)=>date&&!Number.isNaN(date.getTime())&&date.getUTCFullYear()>=1900&&date.getUTCFullYear()<=2099?date:undefined;
export function validateNewUserSaarFilename(filename:string,fallback?:{identity?:{last:string;first:string};organization?:string;accountActionDate?:Date;requestDate?:Date;allowDisabled?:boolean}):NewUserSaarFilenameValidation{
 if(!filenameMatchesKind(filename,'SAAR'))return{valid:false,reason:'The filename is not recognized as a SAAR.'};
 if(disabledSaarFilename(filename)&&!fallback?.allowDisabled)return{valid:false,reason:'A SAAR marked DISABLED is an archive record and cannot create or update an active user profile.'};
 const filenameIdentity=identityFromFilename(filename),reservedIdentityTokens=new Set(['LAST','FIRST','ORG','ORGANIZATION','GEN','PRIV','SAAR','DOD','CYBER','CERT','USER','AGREEMENT','TRAINING','MEMO','TYPE']),filenameIdentityUsable=filenameIdentity&&!reservedIdentityTokens.has(filenameIdentity.last.toUpperCase())&&!reservedIdentityTokens.has(filenameIdentity.first.toUpperCase()),identity=filenameIdentityUsable?filenameIdentity:fallback?.identity;
 if(!identity)return{valid:false,reason:'The SAAR filename must begin with Last Name followed by First Name.'};
 if(identity.last.toUpperCase()==='LAST'&&identity.first.toUpperCase()==='FIRST')return{valid:false,reason:'The SAAR filename still contains the Last_First template placeholders and the form identity could not be read.'};
 const filenameOrganization=organizationFrom(filename),organization=filenameOrganization&&!['ORG','ORGANIZATION'].includes(filenameOrganization.toUpperCase())?filenameOrganization:fallback?.organization;
 if(!organization)return{valid:false,reason:'The SAAR filename is missing its parenthesized organization.'};
 if(['ORG','ORGANIZATION'].includes(organization.toUpperCase()))return{valid:false,reason:'The SAAR filename still contains the organization template placeholder and the form organization could not be read.'};
 if(!parseDate(filename)&&!verifiedAccountDate(fallback?.accountActionDate??fallback?.requestDate))return{valid:false,reason:'The SAAR filename is missing a valid recognized date, and no signed Part IV Created By or Disabled By account-action date could be read from the fillable form.'};
 const markers=saarMarkers(filename),hasGeneral=markers.general,hasPrivileged=!!markers.privilegedType;
 if(hasGeneral===hasPrivileged)return{valid:false,reason:'The SAAR filename must identify exactly one role: GEN or PRIV.'};
 if(hasGeneral)return{valid:true,identity,organization,role:'General',privilegedTypes:[]};
 const privilegedType=normalizePrivilegedType(clean(markers.privilegedType??'',200));
 if(!privilegedType||privilegedType==='TYPE')return{valid:false,reason:'A PRIV SAAR filename must contain the actual privileged account type between PRIV and SAAR.'};
 return{valid:true,identity,organization,role:'Privileged',privilegedTypes:[privilegedType]};
}
export function canRecoverNewUserSaarFromForm(filename:string,fallback?:{organization?:string}){
 if(validateNewUserSaarFilename(filename,fallback).valid)return false;
 return validateNewUserSaarFilename(filename,{identity:{last:'RecoveredLast',first:'RecoveredFirst'},organization:fallback?.organization||'RecoveredOrganization',accountActionDate:new Date('2000-01-01T00:00:00.000Z')}).valid;
}
export function canonicalValidatedSaarFilename(filename:string,validation:Extract<NewUserSaarFilenameValidation,{valid:true}>,accountActionDate?:Date,disabled=false){
 const date=parseDate(filename)??verifiedAccountDate(accountActionDate),last=canonicalFilePart(validation.identity.last),first=canonicalFilePart(validation.identity.first),organization=canonicalFilePart(validation.organization),type=validation.role==='Privileged'?canonicalFilePart(normalizePrivilegedType(validation.privilegedTypes[0]??'')):'';
 if(!date||!last||!first||!organization||(validation.role==='Privileged'&&!type))return;
 const dateToken=`${String(date.getUTCDate()).padStart(2,'0')}${months[date.getUTCMonth()]}${date.getUTCFullYear()}`,artifact=validation.role==='General'?'GEN_SAAR':`PRIV_${type}_SAAR`,state=disabled?'_DISABLED':'',extension=/\.zip$/i.test(filename)?'.pdf.zip':'.pdf',target=`${last}_${first}_(${organization})_${artifact}${state}_${dateToken}${extension}`;
 return target.length<=180?target:undefined;
}
export const identityKey=(last:string,first:string)=>`${clean(last).toUpperCase()}\u0000${clean(first).toUpperCase()}`;
export function filenameIdentityMatches(filename:string,user:{last:string;first:string}){const identity=identityFromFilename(filename);return !!identity&&identityKey(identity.last,identity.first)===identityKey(user.last,user.first)}
export function preserveEvidenceExtension(sourceFilename:string,targetFilename:string){const source=sourceFilename.match(/\.(pdf|zip)$/i)?.[0].toLowerCase(),target=targetFilename.match(/\.(pdf|zip)$/i)?.[0].toLowerCase();if(!source||source===target)return targetFilename;if(source==='.zip'&&/\.pdf$/i.test(targetFilename))return`${targetFilename}.zip`;if(source==='.pdf'&&/\.pdf\.zip$/i.test(targetFilename))return targetFilename.slice(0,-4);if(target)return`${targetFilename.slice(0,-target.length)}${source}`;return`${targetFilename}${source}`}
