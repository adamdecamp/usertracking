export const idleTimeoutMs=15*60*1000;

export function sessionIdleExpired(now:number,lastActivity:number,syncInProgress:boolean,timeout=idleTimeoutMs){
 return !syncInProgress&&now-lastActivity>=timeout;
}
