/**
 * Points of contact for each organization in an information system, stored on
 * the system record (manifest v8). The five standard positions are dropdown
 * choices only; operators may add any other position, which is then offered
 * for the rest of the system.
 */
export const standardContactPositions=['Program Manager','CPSO/FSO/GSSO','ISSM','ISSO','System Administrator'] as const;
export const contactMethodTypes=['Email','Phone'] as const;
export type ContactMethodType=typeof contactMethodTypes[number];
export type ContactMethod={type:ContactMethodType;value:string};
export type OrganizationContact={id:string;organization:string;position:string;name:string;methods:ContactMethod[]};
export const contactLimits={perSystem:500,methods:4,id:100,organization:200,position:80,name:120,email:254,phone:40} as const;

const oneLine=(value:string)=>value.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
const bounded=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\r\n\u0000]/.test(value);

export const validContactEmail=(value:string)=>value.length<=contactLimits.email&&/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
/** Digits with common separators, an optional leading +, and an optional extension such as "x123" or "ext. 4". */
export const validContactPhone=(value:string)=>value.length<=contactLimits.phone&&/^\+?[0-9().\-\s]{7,30}(?:\s*(?:x|ext\.?)\s*[0-9]{1,6})?$/i.test(value)&&(value.match(/[0-9]/g)??[]).length>=7;

export function contactMethodProblem(method:ContactMethod):string|undefined{
 if(!method.value.trim())return `Enter the ${method.type==='Email'?'email address':'phone number'}.`;
 return method.type==='Email'?(validContactEmail(method.value.trim())?undefined:'Enter a valid email address, such as name@example.mil.'):(validContactPhone(method.value.trim())?undefined:'Enter a valid phone number, such as (555) 555-0100 x123.');
}

/** Cleans one contact from the editor, or throws an operator-readable reason. */
export function normalizeContact(input:OrganizationContact,organizations:readonly string[]):OrganizationContact{
 const organization=organizations.find(value=>value.toUpperCase()===oneLine(input.organization).toUpperCase());
 if(!organization)throw new Error('Choose an organization in this information system.');
 const position=oneLine(input.position),name=oneLine(input.name);
 if(!position)throw new Error('Choose a position, or choose Other and enter one.');
 if(position.length>contactLimits.position)throw new Error(`Positions must be ${contactLimits.position} characters or fewer.`);
 if(!name)throw new Error('Enter the contact’s name.');
 if(name.length>contactLimits.name)throw new Error(`Names must be ${contactLimits.name} characters or fewer.`);
 if(!input.methods.length)throw new Error('Add an email address or phone number.');
 if(input.methods.length>contactLimits.methods)throw new Error(`A contact can have at most ${contactLimits.methods} email addresses and phone numbers.`);
 const methods=input.methods.map(method=>{const problem=contactMethodProblem(method);if(problem)throw new Error(problem);const value=method.value.trim();return{type:method.type,value:method.type==='Email'?value.toLowerCase():oneLine(value)}});
 return{id:input.id,organization,position:canonicalPosition(position),name,methods};
}

/** A typed position that matches a standard one (any case) is stored with the standard spelling. */
export function canonicalPosition(position:string){return standardContactPositions.find(value=>value.toUpperCase()===position.toUpperCase())??position}

/** Standard positions first, then every custom position already used in this system. */
export function contactPositionChoices(contacts:readonly OrganizationContact[]){
 const standard=new Set(standardContactPositions.map(value=>value.toUpperCase())),custom=new Map<string,string>();
 for(const contact of contacts)if(!standard.has(contact.position.toUpperCase())&&!custom.has(contact.position.toUpperCase()))custom.set(contact.position.toUpperCase(),contact.position);
 return[...standardContactPositions,...Array.from(custom.values()).sort((left,right)=>left.localeCompare(right))];
}

const positionRank=(position:string)=>{const index=standardContactPositions.findIndex(value=>value===position);return index<0?standardContactPositions.length:index};
export function sortContacts(contacts:readonly OrganizationContact[]){
 return[...contacts].sort((left,right)=>left.organization.localeCompare(right.organization)||positionRank(left.position)-positionRank(right.position)||left.position.localeCompare(right.position)||left.name.localeCompare(right.name));
}

/** Strict decoder for persisted contacts; undefined means the stored value is invalid. */
export function decodeOrganizationContacts(value:unknown):OrganizationContact[]|undefined{
 if(!Array.isArray(value)||value.length>contactLimits.perSystem)return;
 const contacts:OrganizationContact[]=[],ids=new Set<string>();
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item))return;
  const raw=item as Record<string,unknown>;
  if(!bounded(raw.id,contactLimits.id)||!raw.id||ids.has(raw.id)||!bounded(raw.organization,contactLimits.organization)||!raw.organization.trim()||!bounded(raw.position,contactLimits.position)||!raw.position.trim()||!bounded(raw.name,contactLimits.name)||!raw.name.trim()||!Array.isArray(raw.methods)||raw.methods.length<1||raw.methods.length>contactLimits.methods)return;
  const methods:ContactMethod[]=[];
  for(const method of raw.methods){
   if(!method||typeof method!=='object'||Array.isArray(method))return;
   const entry=method as Record<string,unknown>;
   if(entry.type==='Email'&&bounded(entry.value,contactLimits.email)&&validContactEmail(entry.value))methods.push({type:'Email',value:entry.value});
   else if(entry.type==='Phone'&&bounded(entry.value,contactLimits.phone)&&validContactPhone(entry.value))methods.push({type:'Phone',value:entry.value});
   else return;
  }
  ids.add(raw.id);contacts.push({id:raw.id,organization:raw.organization,position:raw.position,name:raw.name,methods});
 }
 return contacts;
}

/** Most CC addresses an individual email may carry; the launcher enforces the same limit. */
export const individualEmailCcLimit=20;

/** The organization's contacts that have an email address, offered as individual CC choices. */
export function ccContactChoices(contacts:readonly OrganizationContact[],organization:string){
 return sortContacts(contacts.filter(contact=>contact.organization.toUpperCase()===organization.toUpperCase()&&contact.methods.some(method=>method.type==='Email')));
}

/**
 * CC recipients for an individual email from the chosen contact ids: each contact's first email address,
 * without duplicates or the user's own address. Labels (position and name) are for the audit record.
 */
export function individualEmailCc(contacts:readonly OrganizationContact[],organization:string,selectedIds:readonly string[],userEmail:string){
 const chosen=new Set(selectedIds),seen=new Set([userEmail.trim().toLowerCase()]),emails:string[]=[],labels:string[]=[];
 for(const contact of ccContactChoices(contacts,organization)){
  if(!chosen.has(contact.id))continue;
  const email=contact.methods.find(method=>method.type==='Email')!.value.trim().toLowerCase();
  if(seen.has(email)||emails.length>=individualEmailCcLimit)continue;
  seen.add(email);emails.push(email);labels.push(`${contact.position} ${contact.name}`);
 }
 return{emails,labels};
}

const contactKey=(contact:OrganizationContact)=>`${contact.organization} ${contact.position} ${contact.name}`;
const sameContact=(left:OrganizationContact,right:OrganizationContact)=>JSON.stringify([left.organization,left.position,left.name,left.methods])===JSON.stringify([right.organization,right.position,right.name,right.methods]);

/** Audit wording for contact edits: who was added, changed, or removed (contact details themselves are not logged). */
export function describeOrganizationContactChanges(previous:readonly OrganizationContact[]=[],next:readonly OrganizationContact[]=[]){
 const before=new Map(previous.map(contact=>[contact.id,contact])),after=new Map(next.map(contact=>[contact.id,contact]));
 const added=next.filter(contact=>!before.has(contact.id)).map(contactKey),removed=previous.filter(contact=>!after.has(contact.id)).map(contactKey),changed=next.filter(contact=>{const old=before.get(contact.id);return!!old&&!sameContact(old,contact)}).map(contactKey);
 return[added.length?`added ${added.join(', ')}`:'',changed.length?`updated ${changed.join(', ')}`:'',removed.length?`removed ${removed.join(', ')}`:''].filter(Boolean).join('; ');
}
