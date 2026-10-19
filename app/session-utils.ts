export const idleTimeoutMs=15*60*1000;

export type AccessMode='unselected'|'read-only'|'full';

export function accessModeCanWrite(mode:AccessMode){
 return mode==='full';
}

export type LauncherActivity={activeStorageRequests?:number;longOperationActive?:boolean};

export function storageWorkInProgress(localOperations:number,launcher?:LauncherActivity){
 return localOperations>0||(launcher?.activeStorageRequests??0)>0||launcher?.longOperationActive===true;
}

export function sessionIdleExpired(now:number,lastActivity:number,operationInProgress:boolean,timeout=idleTimeoutMs){
 return !operationInProgress&&now-lastActivity>=timeout;
}

export function automaticSaveAllowed(hydrated:boolean,sessionState:string,syncRunning:boolean,accessMode:AccessMode='full'){
 return hydrated&&sessionState==='active'&&!syncRunning&&accessModeCanWrite(accessMode);
}
