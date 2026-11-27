'use client';

import {useMemo,useState,type KeyboardEvent,type MouseEvent} from 'react';
import type {UserRecord} from '../domain/tracker-models';
import {complianceTrend,trendRanges,type TrendPoint,type TrendRange} from '../application/compliance-trend';

const width=720,height=230,left=44,right=18,top=14,bottom=30,plotWidth=width-left-right,plotHeight=height-top-bottom;
const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const longDate=(date:string)=>{const[year,month,day]=date.split('-').map(Number);return`${monthNames[month-1]} ${day}, ${year}`};
const dateOfDay=(day:number)=>new Date(day*86_400_000).toISOString().slice(0,10);
const describe=(point:TrendPoint)=>point.percent===undefined?`${longDate(point.date)}: no recorded history yet`:`${longDate(point.date)}: ${point.percent}% compliant (${point.compliant} of ${point.known} user${point.known===1?'':'s'})`;

/**
 * Dashboard line chart of the share of users who were compliant over the last 3, 6, 9, or 12 months.
 * It is drawn for the active users the User Directory currently shows, so it follows every filter.
 */
export function ComplianceTrendChart({users,filtered}:{users:UserRecord[];filtered:boolean}){
 const[months,setMonths]=useState<TrendRange>(6),[selected,setSelected]=useState<number|null>(null);
 const trend=useMemo(()=>complianceTrend(users,months),[users,months]);
 const{points,startDay,endDay}=trend,plotted=points.map((point,index)=>({point,index})).filter(item=>item.point.percent!==undefined);
 const x=(day:number)=>left+(endDay===startDay?plotWidth:(day-startDay)/(endDay-startDay)*plotWidth),y=(percent:number)=>top+(1-percent/100)*plotHeight;
 const latest=plotted.at(-1),active=selected!==null&&points[selected]?.percent!==undefined?points[selected]:latest?.point;
 const path=plotted.map((item,position)=>`${position?'L':'M'}${x(item.point.day).toFixed(1)} ${y(item.point.percent!).toFixed(1)}`).join(' ');
 const monthTicks:{day:number;label:string}[]=[];
 for(let day=startDay;day<=endDay;day++){const date=dateOfDay(day);if(date.endsWith('-01')){const month=Number(date.slice(5,7));monthTicks.push({day,label:month===1?`Jan ${date.slice(0,4)}`:monthNames[month-1]})}}
 const tickStep=Math.ceil(monthTicks.length/6);
 function nearest(event:MouseEvent<SVGSVGElement>){
  if(!plotted.length)return;
  const box=event.currentTarget.getBoundingClientRect(),position=(event.clientX-box.left)/box.width*width;
  setSelected(plotted.reduce((best,item)=>Math.abs(x(item.point.day)-position)<Math.abs(x(best.point.day)-position)?item:best).index);
 }
 function step(event:KeyboardEvent<SVGSVGElement>){
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'||!plotted.length)return;
  event.preventDefault();
  const current=plotted.findIndex(item=>item.index===(selected??latest!.index)),next=Math.max(0,Math.min(plotted.length-1,current+(event.key==='ArrowLeft'?-1:1)));
  setSelected(plotted[next].index);
 }
 const historyNote=!trend.historyStartedOn?'History is recorded from the first Full Access session with this version. Until then the chart shows today only.':trend.historyStartedOn>dateOfDay(startDay)?`Recorded history starts ${longDate(trend.historyStartedOn)}. Earlier dates have no line.`:'';
 return <section className="compliance-trend" aria-label="Compliance Trend">
  <div className="compliance-trend-head">
   <div><p className="eyebrow">Compliance Trend</p><strong>{latest?`${latest.point.percent}% Compliant Today`:'No Users to Chart'}</strong><small>{users.length} active user{users.length===1?'':'s'} {filtered?'shown by the User Directory filters':'in this system'}</small></div>
   <div className="compliance-trend-range" role="group" aria-label="Months Shown">{trendRanges.map(value=><button key={value} type="button" aria-pressed={months===value} className={months===value?'selected':''} onClick={()=>{setMonths(value);setSelected(null)}}>{value} Months</button>)}</div>
  </div>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" tabIndex={0} aria-label={`Percent of users compliant over the last ${months} months. ${active?describe(active):'No data.'} Use the left and right arrow keys to move between weeks.`} onMouseMove={nearest} onMouseLeave={()=>setSelected(null)} onKeyDown={step}>
   {[0,25,50,75,100].map(value=><g key={value}><line className="trend-grid" x1={left} x2={width-right} y1={y(value)} y2={y(value)}/><text className="trend-axis" x={left-8} y={y(value)+4} textAnchor="end">{value}%</text></g>)}
   {monthTicks.filter((_,index)=>index%tickStep===0).map(tick=><text key={tick.day} className="trend-axis" x={x(tick.day)} y={height-8} textAnchor="middle">{tick.label}</text>)}
   {plotted.length>1&&<path className="trend-line" d={path}/>}
   {active&&active.percent!==undefined&&<><line className="trend-cursor" x1={x(active.day)} x2={x(active.day)} y1={top} y2={top+plotHeight}/><circle className="trend-dot" cx={x(active.day)} cy={y(active.percent)} r={5}/></>}
  </svg>
  <p className="compliance-trend-readout" aria-live="polite">{active?describe(active):'Add users to see their compliance over time.'}</p>
  {historyNote&&<p className="hint">{historyNote}</p>}
  <details className="compliance-trend-table"><summary>Show the Numbers</summary><table><thead><tr><th scope="col">Week Of</th><th scope="col">Compliant</th><th scope="col">Users With History</th><th scope="col">Percent</th></tr></thead><tbody>{[...points].reverse().map(point=><tr key={point.date}><td>{longDate(point.date)}</td><td>{point.percent===undefined?'—':point.compliant}</td><td>{point.known}</td><td>{point.percent===undefined?'No history':`${point.percent}%`}</td></tr>)}</tbody></table></details>
 </section>;
}
