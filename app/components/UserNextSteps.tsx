import type {UserRecord} from '../domain/tracker-models';
import {userNextSteps} from '../application/user-next-steps';

/** The first thing on a User Record: what this user still needs and what to do about it. */
export function UserNextStepsPanel({user}:{user:UserRecord}){
 const next=userNextSteps(user);
 return <section className="change-box user-next-steps" aria-label="What to Do Next">
  <strong>What to Do Next</strong>
  <p className="hint">{next.summary}</p>
  {next.steps.length>0&&<ul>{next.steps.map(step=><li key={step}>{step}</li>)}</ul>}
 </section>;
}
