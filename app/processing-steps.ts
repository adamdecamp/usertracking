/** How long one stage of an operation took. A stage that ran more than once is summed. */
export type ProcessingStep={phase:string;ms:number};
/** The stages seen so far for the running operation, and when the current one started. */
export type StepTimeline={title:string;steps:ProcessingStep[];phase:string;phaseStartedAtMs:number};
type StatusShape={title:string;phase:string;state:'running'|'complete'|'error'};

function addStep(steps:ProcessingStep[],phase:string,ms:number){
 const duration=Math.max(0,ms),index=steps.findIndex(step=>step.phase===phase);
 return index<0?[...steps,{phase,ms:duration}]:steps.map((step,position)=>position===index?{phase,ms:step.ms+duration}:step);
}

/**
 * Follows an operation through its stages. A new title starts a new timeline, a new stage
 * closes the previous one, and completion or failure returns every stage's duration.
 */
export function trackProcessingStep(timeline:StepTimeline|null,next:StatusShape|null,now:number):{timeline:StepTimeline|null;steps?:ProcessingStep[]}{
 if(!next)return{timeline:null};
 if(next.state==='running'){
  if(!timeline||timeline.title!==next.title)return{timeline:{title:next.title,steps:[],phase:next.phase,phaseStartedAtMs:now}};
  if(timeline.phase===next.phase)return{timeline};
  return{timeline:{title:timeline.title,steps:addStep(timeline.steps,timeline.phase,now-timeline.phaseStartedAtMs),phase:next.phase,phaseStartedAtMs:now}};
 }
 if(!timeline||timeline.title!==next.title)return{timeline:null};
 return{timeline:null,steps:addStep(timeline.steps,timeline.phase,now-timeline.phaseStartedAtMs)};
}

export function slowestStep(steps:readonly ProcessingStep[]){return steps.reduce<ProcessingStep|undefined>((slowest,step)=>!slowest||step.ms>slowest.ms?step:slowest,undefined)}

/** Short stages read in tenths of a second; longer ones as m:ss or h:mm:ss. */
export function formatStepDuration(ms:number){
 const value=Math.max(0,ms);
 if(value<10_000)return`${(value/1000).toFixed(1)} s`;
 const whole=Math.floor(value/1000),hours=Math.floor(whole/3600),minutes=Math.floor(whole%3600/60),seconds=String(whole%60).padStart(2,'0');
 return hours?`${hours}:${String(minutes).padStart(2,'0')}:${seconds}`:`${minutes}:${seconds}`;
}
