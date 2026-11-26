export type ThrottledValue<T>={get():T;subscribe(listener:()=>void):()=>void;set(value:T,urgent?:boolean):void;flush():void;dispose():void};
type Clock={now():number;setTimer(callback:()=>void,ms:number):unknown;clearTimer(timer:unknown):void};
const systemClock:Clock={now:()=>Date.now(),setTimer:(callback,ms)=>setTimeout(callback,ms),clearTimer:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};

/**
 * Holds a frequently changing value and tells subscribers about it at most once per `intervalMs`.
 * The first change after a quiet period is published at once, later ones are coalesced into one trailing
 * publish, and an urgent change (a new stage, completion, failure) is always published immediately.
 */
export function createThrottledValue<T>(initial:T,intervalMs:number,clock:Clock=systemClock):ThrottledValue<T>{
 let published=initial,latest=initial,lastPublishedAt=Number.NEGATIVE_INFINITY,timer:unknown;
 const listeners=new Set<()=>void>();
 const cancel=()=>{if(timer!==undefined){clock.clearTimer(timer);timer=undefined}};
 const publish=()=>{cancel();lastPublishedAt=clock.now();if(Object.is(published,latest))return;published=latest;for(const listener of Array.from(listeners))listener()};
 return{
  get:()=>published,
  subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener)}},
  set(value,urgent=false){latest=value;const waited=clock.now()-lastPublishedAt;if(urgent||waited>=intervalMs){publish();return}if(timer===undefined)timer=clock.setTimer(publish,Math.max(0,intervalMs-waited))},
  flush:publish,
  dispose(){cancel();listeners.clear()},
 };
}
