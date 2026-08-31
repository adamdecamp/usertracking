export type RenamerUser={first:string;last:string;organization:string;roles:string[];privilegedTypes:string[]};
export type RenamerAnalysis={kind:string;first:string;last:string;organization:string;date:string;role:'GEN'|'PRIV'|'';privilegedType:string;confidence:'High'|'Review'|'Manual';evidence:string[]};

const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const clean=(value:string,max=200)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const token=(value:string,max=80)=>clean(value,max).replace(/[<>:"/\\|?*()]/g,' ').replace(/[^A-Za-z0-9'+.-]+/g,'_').replace(/^_+|_+$/g,'');
const normalized=(value:string)=>clean(value,100000).toUpperCase().replace(/[^A-Z0-9+]+/g,' ').replace(/\s+/g,' ').trim();

const kindRules:[string,RegExp[]][]=[
 ['DTA Training Cert',[/\bDTA\b.{0,80}\bTRAINING\b/i,/\bDELEGATED TRUSTED AGENT\b.{0,80}\bTRAINING\b/i]],
 ['DTA Agreement',[/\bDTA\b.{0,80}\bAGREEMENT\b/i,/\bDELEGATED TRUSTED AGENT\b.{0,80}\bAGREEMENT\b/i]],
 ['Privileged User Training Cert',[/\bPRIVILEGED USER\b.{0,100}\bTRAINING\b/i,/\bPRIVILEGED ACCESS\b.{0,100}\bTRAINING\b/i]],
 ['GEN and PRIV Agreement',[/\b(?:GENERAL|GEN)\b.{0,80}\b(?:AND|&)\b.{0,40}\bPRIV(?:ILEGED)?\b.{0,100}\bAGREEMENT\b/i,/\bPRIVILEGED USER AGREEMENT\b/i]],
 ['8140 Cert Memo',[/\b8140(?:\.0+)?\b.{0,180}\b(?:MEMO|MEMORANDUM|CERTIFICATION|QUALIFICATION)\b/i,/\b(?:MEMO|MEMORANDUM)\b.{0,180}\b8140(?:\.0+)?\b/i]],
 ['SAAR',[/\bDD\s*FORM\s*2875\b/i,/\bSYSTEM AUTHORIZATION ACCESS REQUEST\b/i,/\bSAAR\b/i]],
 ['GEN User Agreement',[/\b(?:GENERAL|GEN) USER AGREEMENT\b/i,/\bACCEPTABLE USE (?:POLICY|AGREEMENT)\b/i,/\bUSER AGREEMENT\b/i]],
 ['DoD Cyber Cert',[/\bCOMPTIA\b/i,/\bSECURITY\s*\+/i,/\bCYSA\s*\+/i,/\bCASP\s*\+/i,/\bCISSP\b/i,/\bCERTIFIED ETHICAL HACKER\b/i,/\bCYBER(?:SECURITY)? (?:CERTIFICATE|CERTIFICATION)\b/i]],
];

function detectKind(text:string,filename:string){const source=`${text.slice(0,120000)}\n${filename.replace(/[_-]+/g,' ')}`;for(const[kind,rules]of kindRules)if(rules.some(rule=>rule.test(source)))return kind;return''}

function identifyUser(text:string,filename:string,users:RenamerUser[]){
 const haystack=` ${normalized(`${text}\n${filename}`)} `,scored=users.map(user=>{const first=normalized(user.first),last=normalized(user.last);let score=0;if(first&&last){if(haystack.includes(` ${first} ${last} `))score+=5;if(haystack.includes(` ${last} ${first} `))score+=4;if(haystack.includes(` ${last} ${first.charAt(0)} `))score+=2;if(normalized(filename).startsWith(`${last} ${first}`))score+=5}return{user,score}}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
 return scored.length&&(scored.length===1||scored[0].score>scored[1].score)?scored[0].user:undefined;
}

function labeledName(text:string){
 const patterns=[/(?:FULL\s+NAME|NAME\s+OF\s+(?:USER|INDIVIDUAL)|EMPLOYEE\s+NAME|STUDENT\s+NAME|CANDIDATE\s+NAME)\s*[:#-]?\s*([A-Z][A-Z'\-.]+)\s*,\s*([A-Z][A-Z'\-.]+)/i,/(?:FULL\s+NAME|NAME\s+OF\s+(?:USER|INDIVIDUAL)|EMPLOYEE\s+NAME|STUDENT\s+NAME|CANDIDATE\s+NAME)\s*[:#-]?\s*([A-Z][A-Z'\-.]+)\s+([A-Z][A-Z'\-.]+)/i,/CERTIF(?:Y|IES)\s+THAT\s+([A-Z][A-Z'\-.]+)\s+([A-Z][A-Z'\-.]+)/i];
 for(const pattern of patterns){const match=text.match(pattern);if(!match)continue;if(match[0].includes(','))return{last:clean(match[1]),first:clean(match[2])};return{first:clean(match[1]),last:clean(match[2])}}
}

function parseCalendarDate(value:string){
 const raw=value.trim().replace(/[,]/g,' ').replace(/\s+/g,' ');let year=0,month=0,day=0,match:RegExpMatchArray|null;
 if((match=raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))){year=+match[1];month=+match[2];day=+match[3]}
 else if((match=raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))){month=+match[1];day=+match[2];year=+match[3]}
 else if((match=raw.match(/^(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(\d{1,2})\s+(\d{2,4})$/i))){month=months.findIndex(item=>match![1].toUpperCase().startsWith(item))+1;day=+match[2];year=+match[3]}
 else if((match=raw.match(/^(\d{1,2})\s+(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(\d{2,4})$/i))){day=+match[1];month=months.findIndex(item=>match![2].toUpperCase().startsWith(item))+1;year=+match[3]}
 else return;
 if(year<100)year=year>=70?1900+year:2000+year;const date=new Date(Date.UTC(year,month-1,day));if(year<1900||year>2099||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return;return`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function signedDate(text:string){
 const datePattern=/(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+\d{1,2},?\s+\d{2,4}|\d{1,2}\s+(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+\d{2,4})/gi;
 const candidates:{date:string;score:number;context:string}[]=[];for(const match of text.matchAll(datePattern)){const date=parseCalendarDate(match[0]);if(!date)continue;const index=match.index??0,leading=clean(text.slice(Math.max(0,index-75),index),100).toUpperCase(),context=clean(text.slice(Math.max(0,index-90),Math.min(text.length,index+match[0].length+35)),180);let score=0;if(/DATE\s+(?:SIGNED|OF SIGNATURE)|SIGNED\s+(?:ON|DATE)?|SIGNATURE\s+DATE/.test(leading))score+=9;if(/DATE\s+(?:CERTIFIED|COMPLETED|EARNED|ISSUED)|CERTIFICATION\s+DATE|COMPLETION\s+DATE|ISSUE\s+DATE/.test(leading))score+=8;if(/\bDATE\b/.test(leading))score+=2;if(/EXPIR|VALID\s+(?:THROUGH|UNTIL)|RENEW/.test(leading))score-=10;candidates.push({date,score,context})}return candidates.sort((a,b)=>b.score-a.score)[0];
}

export function analyzeDocumentText(text:string,filename:string,users:RenamerUser[],defaultOrganization=''):RenamerAnalysis{
 const kind=detectKind(text,filename),matched=identifyUser(text,filename,users),fallback=!matched?labeledName(text):undefined,date=signedDate(text),upper=normalized(`${text}\n${filename}`),role:RenamerAnalysis['role']=/\bPRIV(?:ILEGED)?\b/.test(upper)&&kind==='SAAR'?'PRIV':/\bGEN(?:ERAL)?\b/.test(upper)&&kind==='SAAR'?'GEN':'',privilegedType=role==='PRIV'?(matched?.privilegedTypes.length===1?matched.privilegedTypes[0]:''):'',evidence:string[]=[];
 if(kind)evidence.push(`Recognized ${kind}`);if(matched)evidence.push(`Matched tracker user ${matched.last}, ${matched.first}`);else if(fallback)evidence.push('Read a labeled name from the document');if(date)evidence.push(`Selected date from: ${date.context}`);
 const result={kind,first:matched?.first??fallback?.first??'',last:matched?.last??fallback?.last??'',organization:matched?.organization??defaultOrganization,date:date?.score&&date.score>=2?date.date:'',role,privilegedType,evidence};
 const complete=!!result.kind&&!!result.first&&!!result.last&&!!result.organization&&!!result.date&&(result.kind!=='SAAR'||!!result.role)&&(result.role!=='PRIV'||!!result.privilegedType),strong=complete&&!!matched&&!!date&&date.score>=8;
 return{...result,confidence:strong?'High':complete?'Review':'Manual'};
}

export function buildTrackerFilename(input:Pick<RenamerAnalysis,'kind'|'first'|'last'|'organization'|'date'|'role'|'privilegedType'>){
 const last=token(input.last),first=token(input.first),organization=token(input.organization),dateMatch=input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!last||!first||!organization||!dateMatch||!input.kind)return;
 const month=+dateMatch[2],date=`${dateMatch[3]}${months[month-1]??''}${dateMatch[1]}`;if(!months[month-1])return;let kind=token(input.kind);
 if(input.kind==='SAAR'){if(!input.role)return;kind=input.role==='PRIV'?`PRIV_${token(input.privilegedType)}_SAAR`:'GEN_SAAR';if(kind.includes('__'))return}
 const value=`${last}_${first}_(${organization})_${kind}_${date}.pdf`;return value.length<=180?value:undefined;
}
