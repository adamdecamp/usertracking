import type {UserRecord} from '../domain/tracker-models.ts';
import {isDueWithin30Days,requiredKinds,statusFor} from '../user-status-utils.ts';

/** People affected and how many of their required items are in this state. */
export type IssueCount={users:number;items:number};

export type DashboardStats={
 activeUsers:number;
 compliantUsers:number;
 nonCompliantUsers:number;
 due:IssueCount;
 overdue:IssueCount;
 missing:IssueCount;
};

/**
 * Dashboard totals for the selected system's active users. Every tile counts
 * users, the same unit a tile click filters the directory to; `items` gives
 * the number of affected requirements for the tile's second line.
 */
export function dashboardStats(activeUsers:readonly UserRecord[],asOf=new Date()):DashboardStats{
 let compliantUsers=0;const due={users:0,items:0},overdue={users:0,items:0},missing={users:0,items:0};
 for(const user of activeUsers){
  const required=requiredKinds(user);let userDue=0,userOverdue=0,userMissing=0;
  for(const kind of required){const status=statusFor(user,kind,asOf);if(status==='Current'&&isDueWithin30Days(user,kind,asOf))userDue++;if(status==='Overdue')userOverdue++;if(status==='Missing')userMissing++}
  if(required.length>0&&required.every(k=>statusFor(user,k,asOf)==='Current'))compliantUsers++;
  if(userDue){due.users++;due.items+=userDue}if(userOverdue){overdue.users++;overdue.items+=userOverdue}if(userMissing){missing.users++;missing.items+=userMissing}
 }
 return{activeUsers:activeUsers.length,compliantUsers,nonCompliantUsers:activeUsers.length-compliantUsers,due,overdue,missing};
}

/** Second line of an issue tile, for example "7 missing items". */
export function issueItemsLabel(count:IssueCount,noun:string):string{
 return `${count.items} ${noun} item${count.items===1?'':'s'}`;
}
