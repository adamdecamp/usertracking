export const idleTimeoutMs=15*60*1000;

export type AccessMode='unselected'|'read-only'|'full';

export function accessModeCanWrite(mode:AccessMode){
 return mode==='full';
}

export type LauncherActivity={activeStorageRequests?:number;longOperationActive?:boolean};

export function storageWorkInProgress(localOperations:number,launcher?:LauncherActivity){
 return localOperations>0||(launcher?.activeStorageRequests??0)>0||launcher?.longOperationActive===true;
}

/**
 * Processing is never idle time: a running Sync, commit, Reconciliation, Check
 * Outlook, report, or any in-flight storage request keeps the session active.
 */
export function idleClockBusy(protectedWork:boolean,processingRunning:boolean,activeStorageRequests:number){
 return protectedWork||processingRunning||activeStorageRequests>0;
}

/** While busy the idle clock is held at now, so the 15 minutes start only when the work ends. */
export function idleActivityTime(lastActivity:number,busy:boolean,now:number){
 return busy?Math.max(lastActivity,now):lastActivity;
}

export function sessionIdleExpired(now:number,lastActivity:number,operationInProgress:boolean,timeout=idleTimeoutMs){
 return !operationInProgress&&now-lastActivity>=timeout;
}

export function automaticSaveAllowed(hydrated:boolean,sessionState:string,syncRunning:boolean,accessMode:AccessMode='full'){
 return hydrated&&sessionState==='active'&&!syncRunning&&accessModeCanWrite(accessMode);
}
