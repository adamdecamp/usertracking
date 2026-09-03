export const idleTimeoutMs=15*60*1000;

export function sessionIdleExpired(now:number,lastActivity:number,syncInProgress:boolean,timeout=idleTimeoutMs){
 return !syncInProgress&&now-lastActivity>=timeout;
}

export function automaticSaveAllowed(hydrated:boolean,sessionState:string,syncRunning:boolean){
 return hydrated&&sessionState==='active'&&!syncRunning;
}
