import type {UserRecord} from '../domain/tracker-models.ts';
import {requiredKinds,statusFor} from '../user-status-utils.ts';

export const complianceLabels={compliant:'Compliant',notCompliant:'Not Compliant',disabled:'Disabled'} as const;
export type ComplianceLabel=typeof complianceLabels[keyof typeof complianceLabels];
export const complianceFilterAll='All compliance';
export const complianceFilterChoices=[complianceFilterAll,complianceLabels.compliant,complianceLabels.notCompliant] as const;

/**
 * One rule for "compliant" everywhere: the dashboard tiles, the User Directory
 * column and filter, and the CSV export. Every required item must be current;
 * an item due within 30 days is still current. An approved exception is shown
 * beside the item but does not make the user compliant.
 */
export function userIsCompliant(user:UserRecord,asOf=new Date()){
 const required=requiredKinds(user);
 return required.length>0&&required.every(kind=>statusFor(user,kind,asOf)==='Current');
}

/** Disabled users are labeled Disabled; they are not counted as compliant or not compliant. */
export function userComplianceLabel(user:UserRecord,asOf=new Date()):ComplianceLabel{
 return user.disabled?complianceLabels.disabled:userIsCompliant(user,asOf)?complianceLabels.compliant:complianceLabels.notCompliant;
}

export function matchesComplianceFilter(user:UserRecord,filter:string,asOf=new Date()){
 return filter===complianceFilterAll||userComplianceLabel(user,asOf)===filter;
}
