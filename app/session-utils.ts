export const idleTimeoutMs=15*60*1000;

export type AccessMode='unselected'|'read-only'|'full';

export function accessModeCanWrite(mode:AccessMode){
 return mode==='full';
}

export function sessionIdleExpired(now:number,lastActivity:number,syncInProgress:boolean,timeout=idleTimeoutMs){
 return !syncInProgress&&now-lastActivity>=timeout;
}

export function automaticSaveAllowed(hydrated:boolean,sessionState:string,syncRunning:boolean,accessMode:AccessMode='full'){
 return hydrated&&sessionState==='active'&&!syncRunning&&accessModeCanWrite(accessMode);
}
