'use client';

import {useEffect,useMemo,useState,type KeyboardEvent,type MouseEvent} from 'react';
import type {UserRecord} from '../domain/tracker-models';
import {complianceTrend,trendRanges,type TrendPoint,type TrendRange} from '../application/compliance-trend';

// A short, wide plot: about half the height it first shipped with, so the User Directory stays in view.
const width=720,height=120,left=44,right=18,top=12,bottom=26,plotWidth=width-left-right,plotHeight=height-top-bottom;
/** A display choice only: whether the chart is collapsed to its headline. */
export const trendCollapsedStorageKey='isut-trend-collapsed';
const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const longDate=(date:string)=>{const[year,month,day]=date.split('-').map(Number);return`${monthNames[month-1]} ${day}, ${year}`};
const dateOfDay=(day:number)=>new Date(day*86_400_000).toISOString().slice(0,10);
const describe=(point:TrendPoint)=>point.percent===undefined?`${longDate(point.date)}: no recorded history yet`:`${longDate(point.date)}: ${point.percent}% compliant (${point.compliant} of ${point.known} user${point.known===1?'':'s'})`;

/**
 * Dashboard line chart of the share of users who were compliant over the last 3, 6, 9, or 12 months.
 * It is drawn for the active users the User Directory currently shows, so it follows every filter.
 */
export function ComplianceTrendChart({users,filtered,statusFile=false}:{users:UserRecord[];filtered:boolean;
 /** True when the page is showing an Organization Status File, which carries today's status only. */
 statusFile?:boolean}){
 const[months,setMonths]=useState<TrendRange>(6),[selected,setSelected]=useState<number|null>(null),[collapsed,setCollapsed]=useState(false);
 // Read after the first paint so the saved choice never disagrees with the prerendered page.
 useEffect(()=>{queueMicrotask(()=>{try{setCollapsed(localStorage.getItem(trendCollapsedStorageKey)==='1')}catch{}})},[]);
 const toggle=()=>{const next=!collapsed;setCollapsed(next);setSelected(null);try{localStorage.setItem(trendCollapsedStorageKey,next?'1':'0')}catch{}};
 const trend=useMemo(()=>complianceTrend(users,months),[users,months]);
 const{points,startDay,endDay}=trend,plotted=points.map((point,index)=>({point,index})).filter(item=>item.point.percent!==undefined);
 const x=(day:number)=>left+(endDay===startDay?plotWidth:(day-startDay)/(endDay-startDay)*plotWidth),y=(percent:number)=>top+(1-percent/100)*plotHeight;
 const latest=plotted.at(-1),active=selected!==null&&points[selected]?.percent!==undefined?points[selected]:latest?.point;
 // The chart is a slider over its weeks: screen readers pass arrow keys to a slider and read the chosen week, which they do not for an image.
 const activePosition=active?plotted.findIndex(item=>item.point===active)+1:0;
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
 const historyNote=statusFile?'An Organization Status File holds today’s status only, so this chart has no history.':!trend.historyStartedOn?'History is recorded from the first Full Access session with this version. Until then the chart shows today only.':trend.historyStartedOn>dateOfDay(startDay)?`Recorded history starts ${longDate(trend.historyStartedOn)}. Earlier dates have no line.`:'';
 return <section className={`compliance-trend${collapsed?' collapsed':''}`} aria-label="Compliance Trend">
  <div className="compliance-trend-head">
   <div><p className="eyebrow">Compliance Trend</p><strong>{latest?`${latest.point.percent}% Compliant Today`:'No Users to Chart'}</strong><small>{users.length} active user{users.length===1?'':'s'} {filtered?'shown by the User Directory filters':'in this system'}</small></div>
   <div className="compliance-trend-controls">
    {!collapsed&&<div className="compliance-trend-range" role="group" aria-label="Months Shown">{trendRanges.map(value=><button key={value} type="button" aria-pressed={months===value} className={months===value?'selected':''} onClick={()=>{setMonths(value);setSelected(null)}}>{value} Months</button>)}</div>}
    <button type="button" className="compliance-trend-toggle" aria-expanded={!collapsed} aria-controls="compliance-trend-body" onClick={toggle}>{collapsed?'Show Chart':'Hide Chart'}</button>
   </div>
  </div>
  <div id="compliance-trend-body" hidden={collapsed}>
  <svg viewBox={`0 0 ${width} ${height}`} role="slider" tabIndex={0} aria-orientation="horizontal" aria-label={`Percent of users compliant over the last ${months} months, by week. Use the left and right arrow keys to move between weeks.`} aria-valuemin={plotted.length?1:0} aria-valuemax={plotted.length} aria-valuenow={activePosition} aria-valuetext={active?describe(active):'No data.'} onMouseMove={nearest} onMouseLeave={()=>setSelected(null)} onKeyDown={step}>
   {[0,50,100].map(value=><g key={value}><line className="trend-grid" x1={left} x2={width-right} y1={y(value)} y2={y(value)}/><text className="trend-axis" x={left-8} y={y(value)+4} textAnchor="end">{value}%</text></g>)}
   {monthTicks.filter((_,index)=>index%tickStep===0).map(tick=><text key={tick.day} className="trend-axis" x={x(tick.day)} y={height-8} textAnchor="middle">{tick.label}</text>)}
   {plotted.length>1&&<path className="trend-line" d={path}/>}
   {active&&active.percent!==undefined&&<><line className="trend-cursor" x1={x(active.day)} x2={x(active.day)} y1={top} y2={top+plotHeight}/><circle className="trend-dot" cx={x(active.day)} cy={y(active.percent)} r={4}/></>}
  </svg>
  <p className="compliance-trend-readout" aria-live="polite">{active?describe(active):'Add users to see their compliance over time.'}</p>
  {historyNote&&<p className="hint">{historyNote}</p>}
  <details className="compliance-trend-table"><summary>Show the Numbers</summary><table><thead><tr><th scope="col">Week Of</th><th scope="col">Compliant</th><th scope="col">Users With History</th><th scope="col">Percent</th></tr></thead><tbody>{[...points].reverse().map(point=><tr key={point.date}><td>{longDate(point.date)}</td><td>{point.percent===undefined?'—':point.compliant}</td><td>{point.known}</td><td>{point.percent===undefined?'No history':`${point.percent}%`}</td></tr>)}</tbody></table></details>
  </div>
 </section>;
}
