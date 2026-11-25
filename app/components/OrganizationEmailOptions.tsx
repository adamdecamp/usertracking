'use client';

import {contactPositionChoices,type OrganizationContact} from '../domain/organization-contacts';
import {organizationEmailRecipientLimit,type OrganizationEmailPlan} from '../application/organization-report-email';

/** Compliance Snapshot option that prepares one Outlook draft per organization, addressed to its Organization Contacts. */
export function OrganizationEmailOptions({enabled,available,onEnabled,contacts,positions,onPositions,plan}:{enabled:boolean;available:boolean;onEnabled:(value:boolean)=>void;contacts:readonly OrganizationContact[];positions:string[];onPositions:(value:string[])=>void;plan:readonly OrganizationEmailPlan[]}){
 const choices=contactPositionChoices(contacts),skipped=plan.filter(item=>!item.recipients.length).length;
 const toggle=(position:string)=>onPositions(positions.includes(position)?positions.filter(value=>value!==position):[...positions,position]);
 return <section className="organization-email-options" aria-label="Email Each Organization">
  <h3>Email Each Organization</h3>
  <label className="checkbox"><input type="checkbox" checked={enabled} disabled={!available} onChange={event=>onEnabled(event.target.checked)}/>Email each organization its own Compliance Snapshot</label>
  {!available&&<p className="hint">Emailing each organization needs the R.A.P.T.O.R. portable application and Microsoft Outlook.</p>}
  {enabled&&<>
   <p className="hint">Each selected organization gets its own PDF covering only its users. The PDF is stored and audited in the Reports folder, then attached to an Outlook draft addressed to the organization&apos;s contacts in the positions you check. Drafts open one at a time so you can review each one; nothing is sent automatically.</p>
   <div className="check-grid" role="group" aria-label="Contact Positions to Email">{choices.map(position=><label key={position}><input type="checkbox" checked={positions.includes(position)} onChange={()=>toggle(position)}/>{position}</label>)}</div>
   <div className="system-list">{plan.map(item=><div key={item.organization}><div><strong>{item.organization}</strong>{item.recipients.length?<small>To: {item.contacts.join(', ')}</small>:<small className="restore-warning">No email address for the checked positions. This organization will be skipped. Add one in Organization Contacts.</small>}{item.overLimit&&<small className="restore-warning">Only the first {organizationEmailRecipientLimit} addresses will be used.</small>}</div></div>)}</div>
   {skipped>0&&<p className="hint">{skipped} organization{skipped===1?'':'s'} will be skipped.</p>}
  </>}
 </section>;
}
