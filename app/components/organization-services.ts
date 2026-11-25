/**
 * Storage, audit, and Outlook operations the organization windows need from
 * the route component. Passing them in keeps these windows out of the
 * size-budgeted page module without giving them direct storage access.
 */
export type OutlookDraftRequest={to:string;subject:string;body:string;attachmentFilename?:string;attachmentText?:string;reportFilename?:string;reportSha256?:string;auditSystemIds:string[]};

export type OrganizationServices={
 /** Appends one tamper-evident audit entry; false when the log could not be extended. */
 audit:(action:string,systemId:string)=>Promise<boolean>;
 /** Shows the standard warning when an audit entry for a completed action failed. */
 warnAudit:(ok:boolean)=>void;
 /** Records an operational error and returns the operator-readable message. */
 report:(context:string,error:unknown,systemId:string,fallback:string)=>Promise<string>;
 mapped:(systemId:string)=>boolean;
 listOrganizations:(systemId:string,recorded:string[])=>Promise<string[]>;
 createOrganization:(systemId:string,name:string)=>Promise<string>;
 /** Queues an Outlook draft for operator review. Null when this session cannot use Outlook (browser mode). */
 draft:(systemId:string,request:OutlookDraftRequest)=>Promise<string|null>;
};
