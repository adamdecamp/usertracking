export const artifactKinds=['SAAR','DoD Cyber Cert','GEN User Agreement','GEN and PRIV Agreement','8140 Cert Memo','Privileged User Training Cert','DTA Training Cert','DTA Agreement'];
const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const clean=(value:string,max=500)=>value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);

export const fileTokenList=(value:string)=>value.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
export const fileTokens=(value:string)=>new Set(fileTokenList(value));

export function parseDate(filename:string){
 const match=filename.toUpperCase().match(/(0[1-9]|[12]\d|3[01])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(20\d{2})/);
 if(!match)return;
 const day=+match[1],month=months.indexOf(match[2]),year=+match[3],date=new Date(Date.UTC(year,month,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day?date:undefined;
}

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
export const identityKey=(last:string,first:string)=>`${clean(last).toUpperCase()}\u0000${clean(first).toUpperCase()}`;
export function filenameIdentityMatches(filename:string,user:{last:string;first:string}){const identity=identityFromFilename(filename);return !!identity&&identityKey(identity.last,identity.first)===identityKey(user.last,user.first)}
