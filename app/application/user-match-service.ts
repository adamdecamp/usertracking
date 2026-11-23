import type {UserRecord} from '../domain/tracker-models';
import type {ReconciliationIssue} from '../workflow-utils';

export type PossibleUserMatch={
 userId:string;
 label:string;
 reason:string;
 score:number;
};

export type MatchableUser=Pick<UserRecord,'id'|'last'|'first'|'organization'|'email'|'disabled'>;

export type PossibleDuplicateUser={left:UserRecord;right:UserRecord;reason:string;score:number};

const nicknameGroups=[
 ['ALEXANDER','ALEX'],['ANTHONY','TONY'],['BENJAMIN','BEN'],['CHARLES','CHARLIE','CHUCK'],
 ['CHRISTOPHER','CHRIS'],['DANIEL','DAN','DANNY'],['DAVID','DAVE'],['EDWARD','ED','EDDIE','TED'],
 ['ELIZABETH','BETH','BETTY','LIZ','LIZZIE'],['JAMES','JIM','JIMMY'],['JOHN','JACK','JOHNNY'],
 ['JOSEPH','JOE','JOEY'],['KATHERINE','KATHARINE','KATHRYN','KATE','KATIE','KATHY'],
 ['MARGARET','MAGGIE','MEG','PEGGY'],['MATTHEW','MATT'],['MICHAEL','MIKE'],['NICHOLAS','NICK'],
 ['PATRICIA','PAT','PATTY','TRICIA'],['RICHARD','RICH','RICK','RICKY','DICK'],['ROBERT','ROB','ROBBIE','BOB','BOBBY'],
 ['SAMUEL','SAM','SAMMY'],['STEVEN','STEPHEN','STEVE'],['THOMAS','TOM','TOMMY'],['WILLIAM','WILL','BILL','BILLY'],
] as const;

const nicknameCanonical=new Map<string,string>();
for(const group of nicknameGroups)for(const name of group)nicknameCanonical.set(name,group[0]);

export function comparablePersonName(value:string){
 return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g,'');
}

function sameGivenName(left:string,right:string){
 if(!left||!right)return false;
 if(left===right)return true;
 return nicknameCanonical.get(left)!==undefined&&nicknameCanonical.get(left)===nicknameCanonical.get(right);
}

function editDistanceAtMostOne(left:string,right:string){
 if(left===right)return true;
 if(left.length<4||right.length<4||Math.abs(left.length-right.length)>1)return false;
 let edits=0,leftIndex=0,rightIndex=0;
 while(leftIndex<left.length&&rightIndex<right.length){
  if(left[leftIndex]===right[rightIndex]){leftIndex++;rightIndex++;continue}
  if(++edits>1)return false;
  if(left.length>right.length)leftIndex++;
  else if(right.length>left.length)rightIndex++;
  else{leftIndex++;rightIndex++}
 }
 return edits+(leftIndex<left.length||rightIndex<right.length?1:0)<=1;
}

function organizationMatches(left:string,right:string){return left.trim().toLocaleUpperCase('en-US')===right.trim().toLocaleUpperCase('en-US')}

export function userInformationEditConflicts(previous:Pick<UserRecord,'id'|'systemId'>,next:Pick<UserRecord,'last'|'first'|'organization'|'email'>,users:UserRecord[]){
 const candidates=users.filter(user=>user.systemId===previous.systemId&&user.id!==previous.id),last=comparablePersonName(next.last),first=comparablePersonName(next.first),email=next.email.trim().toLocaleUpperCase('en-US');
 const identity=candidates.find(user=>comparablePersonName(user.last)===last&&comparablePersonName(user.first)===first&&organizationMatches(user.organization,next.organization));
 const emailOwner=email?candidates.find(user=>user.email.trim().toLocaleUpperCase('en-US')===email):undefined;
 const messages=[identity?`Another User Record already has this name and storage organization (${identity.last}, ${identity.first} · ${identity.organization}).`:undefined,emailOwner?`Another User Record already uses this Official Email (${emailOwner.last}, ${emailOwner.first} · ${emailOwner.organization}).`:undefined].filter((value):value is string=>!!value);
 return{identity,emailOwner,messages};
}

export function possibleExistingUserMatches(incoming:Pick<UserRecord,'last'|'first'|'email'|'organization'>,existing:MatchableUser[],limit=8):PossibleUserMatch[]{
 const incomingLast=comparablePersonName(incoming.last),incomingFirst=comparablePersonName(incoming.first),incomingEmail=incoming.email.trim().toLocaleUpperCase('en-US');
 if(!incomingLast||!incomingFirst)return[];
 const matches:PossibleUserMatch[]=[];
 for(const user of existing){
  const last=comparablePersonName(user.last),first=comparablePersonName(user.first),email=user.email.trim().toLocaleUpperCase('en-US'),sameOrganization=organizationMatches(incoming.organization,user.organization);
  let score=0,reason='';
  if(incomingEmail&&email&&incomingEmail===email){score=100;reason='Exact Official Email match'}
  else if(incomingLast===last&&incomingFirst===first){score=sameOrganization?99:94;reason=sameOrganization?'Exact name and organization match':'Exact name match in a different organization'}
  else if(incomingLast===first&&incomingFirst===last){score=sameOrganization?96:91;reason='First and Last Names appear reversed'}
  else if(incomingLast===last&&sameGivenName(incomingFirst,first)){score=sameOrganization?91:86;reason='Same Last Name and a common First Name or nickname'}
  else if(incomingLast===last&&(incomingFirst[0]===first[0])&&(incomingFirst.length===1||first.length===1)){score=sameOrganization?84:78;reason='Same Last Name and matching First Initial'}
  else if(incomingLast===last&&editDistanceAtMostOne(incomingFirst,first)){score=sameOrganization?83:77;reason='Same Last Name and a closely matching First Name'}
  else if(incomingFirst===first&&editDistanceAtMostOne(incomingLast,last)){score=sameOrganization?82:76;reason='Same First Name and a closely matching Last Name'}
  else if(incomingFirst===last&&sameGivenName(incomingLast,first)){score=sameOrganization?88:82;reason='Names appear reversed and one is a common nickname'}
  if(score<76)continue;
  matches.push({userId:user.id,label:`${user.last}, ${user.first} · ${user.organization} · ${user.disabled?'Disabled':'Active'}${user.email?` · ${user.email}`:''}`,reason,score});
 }
 return matches.sort((left,right)=>right.score-left.score||left.label.localeCompare(right.label)).slice(0,Math.max(1,limit));
}

export function possibleDuplicateUsers(users:UserRecord[]):PossibleDuplicateUser[]{
 const findings:PossibleDuplicateUser[]=[];
 const usersById=new Map(users.map(user=>[user.id,user]));
 for(let index=0;index<users.length;index++){
  const left=users[index]!;
  for(const match of possibleExistingUserMatches(left,users.slice(index+1),users.length)){
   if(match.reason.startsWith('Exact '))continue;
   const right=usersById.get(match.userId);if(!right)continue;
   findings.push({left,right,reason:match.reason,score:match.score});
  }
 }
 return findings.sort((left,right)=>right.score-left.score||left.left.last.localeCompare(right.left.last));
}

export function possibleDuplicateUserIssues(users:UserRecord[]):ReconciliationIssue[]{
 const identityGroups=new Map<string,UserRecord[]>(),emailGroups=new Map<string,UserRecord[]>();
 for(const user of users){const identity=`${user.systemId}\0${comparablePersonName(user.last)}\0${comparablePersonName(user.first)}\0${user.organization.trim().toLocaleUpperCase('en-US')}`,email=user.email.trim().toLocaleUpperCase('en-US');identityGroups.set(identity,[...(identityGroups.get(identity)??[]),user]);if(email)emailGroups.set(`${user.systemId}\0${email}`,[...(emailGroups.get(`${user.systemId}\0${email}`)??[]),user])}
 const exactIdentity=Array.from(identityGroups.values()).filter(group=>group.length>1).map((group):ReconciliationIssue=>({id:`duplicate-identity:${group.map(user=>user.id).sort().join(':')}`,category:'Duplicate Identity',severity:'High',summary:`${group[0].last}, ${group[0].first} has ${group.length} records in ${group[0].organization}`,detail:`Exact Last Name, First Name, and storage organization match. Records: ${group.map(user=>`${user.email||'Official Email Missing'} · ${user.disabled?'Disabled':'Active'}`).join(' | ')}. Operator review is required; Reconciliation made no changes.`}));
 const exactEmail=Array.from(emailGroups.entries()).filter(([,group])=>group.length>1).map(([key,group]):ReconciliationIssue=>({id:`duplicate-email:${group.map(user=>user.id).sort().join(':')}`,category:'Duplicate Email',severity:'High',summary:`${key.slice(key.indexOf('\0')+1)} is assigned to ${group.length} records`,detail:`Records: ${group.map(user=>`${user.last}, ${user.first} · ${user.organization} · ${user.disabled?'Disabled':'Active'}`).join(' | ')}. Operator review is required; Reconciliation made no changes.`}));
 const possible=possibleDuplicateUsers(users).map((finding):ReconciliationIssue=>({id:`possible-user:${[finding.left.id,finding.right.id].sort().join(':')}`,category:'Possible Duplicate User',severity:'Medium',summary:`${finding.left.last}, ${finding.left.first} may be the same person as ${finding.right.last}, ${finding.right.first}`,detail:`${finding.reason}. Profile 1: ${finding.left.organization} · ${finding.left.email||'Official Email Missing'} · ${finding.left.disabled?'Disabled':'Active'}. Profile 2: ${finding.right.organization} · ${finding.right.email||'Official Email Missing'} · ${finding.right.disabled?'Disabled':'Active'}. Operator confirmation is required; Reconciliation made no changes.`}));
 return[...exactIdentity,...exactEmail,...possible];
}
