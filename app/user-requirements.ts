import {normalizePrivilegedTypes,privilegedTypeMatches} from './privileged-type-utils.ts';

export const baseRequirementKinds=['SAAR','DoD Cyber Cert','User Agreement'] as const;

export type RequirementUser={roles:Iterable<string>;privilegedTypes:Iterable<string>};

export function isDtaOnlyPrivilegedUser(user:RequirementUser){
 const roles=Array.from(user.roles),types=normalizePrivilegedTypes(user.privilegedTypes);
 return roles.includes('Privileged')&&types.length>0&&types.every(type=>privilegedTypeMatches(type,'DTA'));
}

export function requiredKindsForUser(user:RequirementUser){
 const required:string[]=[...baseRequirementKinds],roles=Array.from(user.roles);
 if(!roles.includes('Privileged'))return required;
 if(!isDtaOnlyPrivilegedUser(user))required.push('8140 Cert Memo');
 required.push('Privileged User Training Cert');
 if(normalizePrivilegedTypes(user.privilegedTypes).some(type=>privilegedTypeMatches(type,'DTA')))required.push('DTA Training');
 return required;
}

export function requirementAppliesToUser(user:RequirementUser,kind:string){
 return requiredKindsForUser(user).includes(kind);
}

export function requirementStatusLabel(kind:string,status:string){
 return kind==='SAAR'&&status==='Current'?'Present':status;
}
