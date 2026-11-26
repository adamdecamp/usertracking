import {ccContactChoices,individualEmailCcLimit,type OrganizationContact} from '../domain/organization-contacts';

type Props={contacts:readonly OrganizationContact[];organization:string;userEmail:string;selected:readonly string[];disabled?:boolean;onChange:(ids:string[])=>void};

/** Lets the operator CC individual Organization Contacts on a user's follow-up email. */
export function IndividualEmailCc({contacts,organization,userEmail,selected,disabled,onChange}:Props){
 const choices=ccContactChoices(contacts,organization),own=userEmail.trim().toLowerCase();
 const toggle=(id:string,checked:boolean)=>onChange(checked?[...new Set([...selected,id])]:selected.filter(value=>value!==id));
 if(!choices.length)return <p className="hint">No {organization} contact has an email address to CC. Add one in Organization Contacts.</p>;
 return <fieldset className="individual-email-cc" disabled={disabled}>
  <legend>CC {organization} Contacts</legend>
  {choices.map(contact=>{const email=contact.methods.find(method=>method.type==='Email')!.value,isUser=email.trim().toLowerCase()===own;return <label key={contact.id} className="checkbox"><input type="checkbox" checked={selected.includes(contact.id)&&!isUser} disabled={isUser} onChange={event=>toggle(contact.id,event.target.checked)}/><span><b>{contact.position}</b> {contact.name} <small>{email}{isUser?' (this user)':''}</small></span></label>})}
  {selected.length>individualEmailCcLimit&&<p className="restore-warning">Only the first {individualEmailCcLimit} contacts will be copied.</p>}
 </fieldset>;
}
