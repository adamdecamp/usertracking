'use client';

import type {OutlookIntakeResult} from '../infrastructure/outlook-intake-contract';
import {outlookIntakeLead,outlookIntakeRows,sentOnBehalf} from '../application/outlook-intake';
import type {UserRecord} from '../domain/tracker-models';

/** Check Outlook's result: one line on what happened, then a count for each outcome with its files. */
export function OutlookIntakeResults({result,users,systemId}:{result:OutlookIntakeResult;users:readonly UserRecord[];systemId:string}){
 return <div className="outlook-results">
  <p className="hint" role="status">{outlookIntakeLead(result)}</p>
  <table aria-label="Check Outlook Results">
   <thead><tr><th>Result</th><th>Count</th><th>What It Means</th></tr></thead>
   <tbody>{outlookIntakeRows(result).map(row=><tr key={row.key} className={row.files.length?undefined:'empty-result'}>
    <th scope="row">{row.label}</th>
    <td>{row.files.length}</td>
    <td>{row.meaning}{row.files.length>0&&row.key!=='held'&&<details open={row.key==='copied'}><summary>Show {row.files.length===1?'File':`${row.files.length} Files`}</summary><ul className="outlook-intake-list">{row.files.map((file,index)=><li key={`${index}:${file.organization??''}/${file.filename}`}><b>{file.filename}</b> <small>{file.sender?`from ${file.sender}`:''}{file.reason?`${file.sender?': ':''}${file.reason}`:''}</small>{row.key==='copied'&&sentOnBehalf(file,users,systemId)&&<small className="restore-warning"> Sent for someone else. Confirm the identity in Sync review.</small>}</li>)}</ul></details>}</td>
   </tr>)}</tbody>
  </table>
 </div>;
}
