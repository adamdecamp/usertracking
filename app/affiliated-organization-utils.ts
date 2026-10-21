const maximumAffiliatedOrganizations=50;
const maximumAffiliatedOrganizationLength=200;

/**
 * Normalizes descriptive agencies, divisions, contractors, and subcontractors.
 * These values are deliberately separate from the storage organization that
 * controls evidence folder placement and filename routing.
 */
export function normalizeAffiliatedOrganizations(values:readonly string[]){
 const normalized:string[]=[],seen=new Set<string>();
 for(const raw of values.slice(0,maximumAffiliatedOrganizations)){
  const value=String(raw).replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,maximumAffiliatedOrganizationLength);
  if(!value)continue;
  const key=value.toLocaleUpperCase();
  if(seen.has(key))continue;
  seen.add(key);normalized.push(value);
 }
 return normalized;
}

export function parseAffiliatedOrganizations(value:string){
 return normalizeAffiliatedOrganizations(value.split(/[,;\n]+/));
}

export function formatAffiliatedOrganizations(values:readonly string[]){
 return normalizeAffiliatedOrganizations(values).join(', ');
}

/**
 * GOV account email markers provide a lightweight sub-organization tag. Only
 * the explicit CTR and CIV tokens are classified; MIL is intentionally not a
 * classification and ordinary words containing those letters are ignored.
 */
export function govEmailAffiliations(organization:string,email:string){
 if(organization.trim().toLocaleUpperCase()!=='GOV')return[];
 const value=email.trim().toLocaleUpperCase(),matches=(token:string)=>new RegExp(`(^|[^A-Z])${token}([^A-Z]|$)`,'i').test(value);
 return['CTR','CIV'].filter(matches);
}

export function derivedAffiliatedOrganizations(user:{organization:string;email:string;affiliatedOrganizations:readonly string[]}){
 return normalizeAffiliatedOrganizations([...user.affiliatedOrganizations,...govEmailAffiliations(user.organization,user.email)]);
}

export function withSaarDesignationAffiliation(values:readonly string[],designation?:'MIL'|'CIV'|'CTR'){
 const retained=normalizeAffiliatedOrganizations(values).filter(value=>!['MIL','CIV','CTR'].includes(value.toLocaleUpperCase()));
 return normalizeAffiliatedOrganizations(designation?[...retained,designation]:retained);
}

export function userMatchesDirectoryQuery(user:{last:string;first:string;email:string;organization:string;affiliatedOrganizations:readonly string[];privilegedUsernames:readonly string[];privilegedTypes:readonly string[]},query:string){
 const normalized=query.trim().toLocaleLowerCase();
 if(!normalized)return true;
 return[ user.last,user.first,user.email,user.organization,...derivedAffiliatedOrganizations(user),...user.privilegedUsernames,...user.privilegedTypes].join(' ').toLocaleLowerCase().includes(normalized);
}
