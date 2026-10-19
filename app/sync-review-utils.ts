import type {UserRecord} from './domain/tracker-models';

type SyncReviewUser={record:UserRecord;emailRequired?:boolean;missingOfficialEmail?:boolean;encryptedFilenameOverride?:boolean};

export function syncNewUserReviewText(item:SyncReviewUser){
 const role=`Role: ${item.record.roles.join(', ')} · ${item.record.artifacts.length} evidence file${item.record.artifacts.length===1?'':'s'} matched`;
 if(item.record.disabled)return'The newest dated SAAR is marked DISABLED. This historical account is created as Disabled, and its archived evidence remains associated so Current, Missing, and Overdue statuses stay visible for possible re-enablement.';
 if(item.encryptedFilenameOverride)return`Encrypted SAAR accepted by the complete filename gate; PDF contents and signatures were not verified. Official Email remains Missing until entered manually · ${role}`;
 if(item.missingOfficialEmail)return`${item.record.email?'Official Email was entered manually during Sync Review.':'Official Email Missing — manual entry is required in Sync Review or the User Record.'} The validated SAAR remains associated with this user · ${role}`;
 if(item.emailRequired===false)return`Supporting evidence created this record; SAAR and Official Email are Missing · ${role}`;
 return`Email read from the fillable SAAR · ${role}`;
}
