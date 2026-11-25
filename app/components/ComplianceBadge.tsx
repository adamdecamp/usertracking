import type {UserRecord} from '../domain/tracker-models';
import {complianceLabels,userComplianceLabel} from '../application/user-compliance';

/** The User Directory's Compliance cell, using the same rule as the dashboard tiles and the CSV export. */
export function ComplianceBadge({user,asOf}:{user:UserRecord;asOf:Date}){
 const label=userComplianceLabel(user,asOf);
 return <span className={`status ${label===complianceLabels.compliant?'current':label===complianceLabels.disabled?'not-applicable':'missing'}`}>{label}</span>;
}
