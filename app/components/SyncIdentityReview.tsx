import type {UserRecord} from '../domain/tracker-models';
import type {SyncNewUser} from '../tracker-workflow-types';
import {normalizePrivilegedTypes} from '../privileged-type-utils';
import {syncNewUserReviewText} from '../sync-review-utils';
import {needsElevatedRole} from '../user-status-utils';

export type ReviewedSyncNewUser=SyncNewUser&{included:boolean};

export function syncIdentityReviewState(items:ReviewedSyncNewUser[],users:UserRecord[],emailAccepted:(email:string)=>boolean){
 const selected=items.filter(item=>item.included),existingEmails=new Set(users.map(user=>user.email.trim().toUpperCase()).filter(Boolean)),selectedEmailCounts=new Map<string,number>();
 for(const item of selected.filter(item=>!item.matchToUserId)){const email=item.record.email.trim().toUpperCase();if(email)selectedEmailCounts.set(email,(selectedEmailCounts.get(email)??0)+1)}
 const valid=selected.every(item=>{if(item.possibleMatches?.length&&!item.matchToUserId&&!item.confirmedNewUser)return false;if(item.matchToUserId)return users.some(user=>user.id===item.matchToUserId);const email=item.record.email.trim(),emailKey=email.toUpperCase(),emailAllowed=item.emailRequired===false?(!email||emailAccepted(email)):emailAccepted(email),emailUnique=!email||(!existingEmails.has(emailKey)&&selectedEmailCounts.get(emailKey)===1);return!!item.record.last&&!!item.record.first&&!!item.record.organization&&emailAllowed&&emailUnique&&(!needsElevatedRole(item.record.roles)||item.emailRequired===false||item.record.privilegedTypes.length>0)});
 return{selected,existingEmails,selectedEmailCounts,valid};
}

export function SyncIdentityReview({items,users,existingEmails,selectedEmailCounts,onChange}:{
 items:ReviewedSyncNewUser[];
 users:UserRecord[];
 existingEmails:Set<string>;
 selectedEmailCounts:Map<string,number>;
 onChange:(id:string,update:(item:ReviewedSyncNewUser)=>ReviewedSyncNewUser)=>void;
}){
 return <div className="sync-review-list">{items.map(item=>{
  const matchedUser=item.matchToUserId?users.find(user=>user.id===item.matchToUserId):undefined,emailKey=item.record.email.trim().toUpperCase(),duplicateEmail=!matchedUser&&!!emailKey&&(existingEmails.has(emailKey)||(selectedEmailCounts.get(emailKey)??0)>1),resolutionValue=matchedUser?`match:${matchedUser.id}`:item.confirmedNewUser?'new':'';
  return <div key={item.id} className="sync-new-user">
   <label><input type="checkbox" checked={item.included} onChange={event=>onChange(item.id,current=>({...current,included:event.target.checked}))}/><span><strong>{item.possibleMatches?.length?'Include Identity Review':'Include New User'}</strong><small>{item.source}</small></span></label>
   {item.possibleMatches?.length&&<label className="span2">Possible Existing User<select aria-label={`Resolve possible existing user for ${item.record.last}, ${item.record.first}`} value={resolutionValue} onChange={event=>onChange(item.id,current=>({...current,matchToUserId:event.target.value.startsWith('match:')?event.target.value.slice(6):undefined,confirmedNewUser:event.target.value==='new'}))}><option value="">Select An Existing Profile Or Confirm A New User</option>{item.possibleMatches.map(match=><option key={match.userId} value={`match:${match.userId}`}>{match.label} — {match.reason}</option>)}<option value="new">None Of These — Create A New User</option></select><small>R.A.P.T.O.R. found a reversed, abbreviated, similar, or nickname-based identity. Nothing is matched automatically; an operator must choose.</small></label>}
   <div className="form-grid">
    <label>Last Name<input value={item.record.last} onChange={event=>onChange(item.id,current=>({...current,record:{...current.record,last:event.target.value}}))}/></label>
    <label>First Name<input value={item.record.first} onChange={event=>onChange(item.id,current=>({...current,record:{...current.record,first:event.target.value}}))}/></label>
    <label>Organization<input value={item.record.organization} onChange={event=>onChange(item.id,current=>({...current,record:{...current.record,organization:event.target.value}}))}/></label>
    {needsElevatedRole(item.record.roles)&&<div className="sync-type-input"><input aria-label="Privileged Account Type" placeholder="_type" value={item.record.privilegedTypes.map(type=>`_${type}`).join(', ')} onChange={event=>onChange(item.id,current=>({...current,record:{...current.record,privilegedTypes:normalizePrivilegedTypes(event.target.value.split(','))}}))}/></div>}
    <label>Official Email<input readOnly={!item.missingOfficialEmail} type="email" value={item.record.email} placeholder={item.missingOfficialEmail?'Enter now or add from the User Record':''} onChange={event=>onChange(item.id,current=>({...current,record:{...current.record,email:event.target.value}}))}/></label>
   </div>
   {matchedUser&&<small className="renamer-message">Matched User Profile: {matchedUser.last}, {matchedUser.first} · {matchedUser.organization} · {matchedUser.email||'Official Email Missing'} · {matchedUser.disabled?'Disabled':'Active'}</small>}
   {duplicateEmail&&<small className="restore-warning">This Official Email is already assigned to another selected or existing user.</small>}
   <small>{syncNewUserReviewText(item)}</small>
  </div>;
 })}{!items.length&&<div className="empty">No validated new identities were found. SAARs requiring correction are listed only under Clean Up.</div>}</div>;
}
