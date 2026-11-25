import {sortContacts,type OrganizationContact} from '../domain/organization-contacts';

const href=(type:string,value:string)=>type==='Email'?`mailto:${value}`:`tel:${value.replace(/[^0-9+]/g,'')}`;

/** The user's organization contacts on the User Record, so the ISSO or ISSM is one click away while working a record. */
export function UserOrganizationContacts({contacts,organization}:{contacts:readonly OrganizationContact[];organization:string}){
 const shown=sortContacts(contacts.filter(contact=>contact.organization.toUpperCase()===organization.toUpperCase()));
 return <section className="change-box user-organization-contacts" aria-label={`${organization} Contacts`}>
  <strong>{organization} Contacts</strong>
  {shown.length?<ul>{shown.map(contact=><li key={contact.id}><b>{contact.position}</b> {contact.name}{contact.methods.map((method,index)=><span key={index}> · <a href={href(method.type,method.value)}>{method.value}</a></span>)}</li>)}</ul>:<p className="hint">No contacts are recorded for {organization}. Add them in Organization Contacts at the top of the User Directory.</p>}
 </section>;
}
