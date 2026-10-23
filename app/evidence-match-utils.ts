import {identityFromFilename,identityKey} from './filename-utils.ts';

type EvidenceIdentity={filename:string;path:string};
type UserIdentity={last:string;first:string;organization:string};

const organizationKey=(value:string)=>value.trim().toLocaleUpperCase('en-US');

/**
 * Index evidence by the parsed Last_First identity instead of by one filename
 * token. This keeps matching both faster and correct for punctuation-bearing
 * names such as O'Neil, De-Camp, and other canonical filename identities.
 */
export function indexEvidenceByIdentity<T extends EvidenceIdentity>(evidence:T[]){
 const index=new Map<string,T[]>();
 for(const item of evidence){
  const identity=identityFromFilename(item.filename);if(!identity)continue;
  const key=identityKey(identity.last,identity.first),matches=index.get(key);
  if(matches)matches.push(item);else index.set(key,[item]);
 }
 return index;
}

export function matchingEvidenceForUser<T extends EvidenceIdentity>(index:Map<string,T[]>,user:UserIdentity,organizationFromPath:(item:T,user:UserIdentity)=>string){
 const expectedOrganization=organizationKey(user.organization);
 return(index.get(identityKey(user.last,user.first))??[]).filter(item=>organizationKey(organizationFromPath(item,user))===expectedOrganization);
}
