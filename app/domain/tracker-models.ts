/**
 * Stable domain records used by every R.A.P.T.O.R. layer.
 *
 * Keep browser handles, HTTP response shapes, and storage paths out of this
 * module. Those concerns belong to the presentation and infrastructure layers.
 */
export type ComplianceException={
 id:string;
 artifact:string;
 reason:string;
 approvedBy:string;
 createdAt:string;
 createdBy:string;
 expiresOn:string;
 revokedAt?:string;
 revokedBy?:string;
};

export type SystemRecord={
 id:string;
 name:string;
 type:string;
 organization:string;
 archived:boolean;
};

export type ArtifactSource='Manual Add'|'Manual Update'|'Sync';

export type Artifact={
 kind:string;
 filename:string;
 sha256?:string;
 path?:string;
 storedAt?:string;
 storedBy?:string;
 source?:ArtifactSource;
};

export type ChangeRecord={
 timestamp:string;
 actor:string;
 action:string;
 description:string;
 rolesBefore:string[];
 rolesAfter:string[];
 files:string[];
};

export type UserRecord={
 id:string;
 systemId:string;
 organization:string;
 last:string;
 first:string;
 middle:string;
 email:string;
 disabled:boolean;
 roles:string[];
 privilegedUsernames:string[];
 privilegedTypes:string[];
 artifacts:Artifact[];
 changes?:ChangeRecord[];
 exceptions?:ComplianceException[];
};

export type TrackerDatabase={systems:SystemRecord[];users:UserRecord[]};
