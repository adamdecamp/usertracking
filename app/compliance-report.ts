import {PDFDocument,PageSizes,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';

export type ComplianceStatus='Current'|'Missing'|'Overdue';
export type ReportUser={id:string;systemId:string;systemName:string;organization:string;disabled:boolean;roles:string[];privilegedTypes:string[]};
export type ReportRequirement={userId:string;systemId:string;systemName:string;organization:string;roles:string[];privilegedTypes:string[];artifact:string;status:ComplianceStatus;daysOverdue:number;exceptionThrough?:string;exceptionApprover?:string};
export type ComplianceReportInput={
 reportId:string;
 generatedAtUtc:string;
 operator:string;
 applicationVersion:string;
 ruleSetVersion:string;
 reportingDate:string;
 recordStatus:string;
 selectedSystems:string[];
 selectedOrganizations:string[];
 users:ReportUser[];
 requirements:ReportRequirement[];
};
export type BreakdownRow={label:string;users:number;current:number;missing:number;overdue:number};
export type ComplianceReportProgress=(phase:string,processed:number,total:number)=>void;

const ascii=(value:string)=>String(value).replace(/[^\x20-\x7e]/g,'?');

function breakdown(requirements:ReportRequirement[],labels:(row:ReportRequirement)=>string[]){
 const groups=new Map<string,{users:Set<string>;current:number;missing:number;overdue:number}>();
 for(const row of requirements)for(const raw of labels(row)){const label=raw||'Not specified',group=groups.get(label)??{users:new Set<string>(),current:0,missing:0,overdue:0};group.users.add(row.userId);group[row.status.toLowerCase() as'current'|'missing'|'overdue']++;groups.set(label,group)}
 return Array.from(groups,([label,value])=>({label,users:value.users.size,current:value.current,missing:value.missing,overdue:value.overdue})).sort((a,b)=>a.label.localeCompare(b.label));
}

export function summarizeCompliance(input:ComplianceReportInput){
 const total=input.requirements.length,current=input.requirements.filter(row=>row.status==='Current').length,missing=input.requirements.filter(row=>row.status==='Missing').length,overdue=input.requirements.filter(row=>row.status==='Overdue').length,exceptions=input.requirements.filter(row=>!!row.exceptionThrough).length;
 const aging={'1-30 days':0,'31-60 days':0,'61-90 days':0,'Over 90 days':0};
 for(const row of input.requirements)if(row.status==='Overdue'){if(row.daysOverdue<=30)aging['1-30 days']++;else if(row.daysOverdue<=60)aging['31-60 days']++;else if(row.daysOverdue<=90)aging['61-90 days']++;else aging['Over 90 days']++}
 return{
  users:input.users.length,
  generalUsers:input.users.filter(user=>user.roles.includes('General')).length,
  privilegedUsers:input.users.filter(user=>user.roles.includes('Privileged')).length,
  privilegedTypes:Array.from(new Set(input.users.flatMap(user=>user.privilegedTypes))).sort(),
  total,current,missing,overdue,exceptions,
  aging,
  byOrganization:breakdown(input.requirements,row=>[row.organization]),
  bySystem:breakdown(input.requirements,row=>[row.systemName]),
  byRole:breakdown(input.requirements,row=>row.roles),
  byPrivilegedType:breakdown(input.requirements,row=>row.privilegedTypes),
  byArtifact:breakdown(input.requirements,row=>[row.artifact]),
 };
}

export async function createComplianceSnapshotPdf(input:ComplianceReportInput,onProgress?:ComplianceReportProgress){
 const progressTotal=8,yieldToBrowser=()=>new Promise<void>(resolve=>setTimeout(resolve,0));onProgress?.('Calculating Report Scope',0,progressTotal);await yieldToBrowser();
 const summary=summarizeCompliance(input);onProgress?.('Building Executive Summary',1,progressTotal);await yieldToBrowser();
 const document=await PDFDocument.create(),regular=await document.embedFont(StandardFonts.Helvetica),bold=await document.embedFont(StandardFonts.HelveticaBold),navy=rgb(0.07,0.16,0.28),green=rgb(0.04,0.45,0.34),amber=rgb(0.78,0.45,0.05),red=rgb(0.72,0.16,0.18),gray=rgb(0.36,0.41,0.48),light=rgb(0.94,0.96,0.97),margin=42,width=PageSizes.Letter[0],height=PageSizes.Letter[1];
 let page:PDFPage,y:number;
 const pages:PDFPage[]=[];
 const newPage=()=>{page=document.addPage(PageSizes.Letter);pages.push(page);y=height-margin;page.drawText('INFORMATION SYSTEM USER TRACKER',{x:margin,y,size:8,font:bold,color:green});y-=24};
 const ensure=(needed:number)=>{if(y-needed<54)newPage()};
 const wrap=(value:string,font:PDFFont,size:number,maxWidth:number)=>{const words=ascii(value).split(/\s+/),lines:string[]=[];let line='';for(const word of words){const candidate=line?`${line} ${word}`:word;if(font.widthOfTextAtSize(candidate,size)<=maxWidth)line=candidate;else{if(line)lines.push(line);line=word}}if(line)lines.push(line);return lines.length?lines:['']};
 const text=(value:string,size=9,options:{font?:PDFFont;color?:ReturnType<typeof rgb>;indent?:number;gap?:number;maxWidth?:number}={})=>{const selectedFont=options.font??regular,indent=options.indent??0,lines=wrap(value,selectedFont,size,options.maxWidth??width-margin*2-indent),lineHeight=size+3;ensure(lines.length*lineHeight+(options.gap??0));for(const line of lines){page.drawText(line,{x:margin+indent,y,size,font:selectedFont,color:options.color??navy});y-=lineHeight}y-=options.gap??0};
 const section=(title:string)=>{ensure(34);y-=6;page.drawRectangle({x:margin,y:y-3,width:width-margin*2,height:22,color:navy});page.drawText(ascii(title),{x:margin+8,y:y+4,size:10,font:bold,color:rgb(1,1,1)});y-=30};
 const metadata=(label:string,value:string)=>{ensure(16);page.drawText(ascii(label),{x:margin,y,size:8,font:bold,color:gray});page.drawText(ascii(value),{x:160,y,size:8,font:regular,color:navy,maxWidth:width-202});y-=15};
 const cards=(items:{label:string;value:string;color?:ReturnType<typeof rgb>}[])=>{const cardWidth=(width-margin*2-16)/3,cardHeight=54,rowCount=Math.ceil(items.length/3);ensure(rowCount*(cardHeight+8)+4);for(let index=0;index<items.length;index+=3){for(let column=0;column<3&&index+column<items.length;column++){const item=items[index+column],x=margin+column*(cardWidth+8);page.drawRectangle({x,y:y-cardHeight+8,width:cardWidth,height:cardHeight,color:light,borderColor:rgb(0.82,0.85,0.87),borderWidth:0.6});page.drawText(ascii(item.value),{x:x+9,y:y-18,size:18,font:bold,color:item.color??navy});page.drawText(ascii(item.label),{x:x+9,y:y-36,size:8,font:regular,color:gray,maxWidth:cardWidth-18})}y-=cardHeight+8}};
 const table=(title:string,rows:BreakdownRow[])=>{section(title);if(!rows.length){text('No applicable records in this scope.',9,{color:gray,gap:4});return}const columns=[260,48,48,48,48],headers=['Category','Users','Current','Missing','Overdue'];const header=()=>{ensure(22);let x=margin;page.drawRectangle({x:margin,y:y-4,width:columns.reduce((a,b)=>a+b,0),height:18,color:light});headers.forEach((label,index)=>{page.drawText(label,{x:x+4,y:y+1,size:7,font:bold,color:navy});x+=columns[index]});y-=20};header();for(const row of rows){const labelLines=wrap(row.label,regular,7.5,columns[0]-8),rowHeight=Math.max(18,labelLines.length*10+6);if(y-rowHeight<54){newPage();section(`${title} - Continued`);header()}let x=margin;labelLines.forEach((line,index)=>page.drawText(line,{x:x+4,y:y-index*10,size:7.5,font:regular,color:navy}));x+=columns[0];[row.users,row.current,row.missing,row.overdue].forEach((value,index)=>{page.drawText(String(value),{x:x+4,y,size:7.5,font:regular,color:index===2?red:index===3?amber:navy});x+=columns[index+1]});y-=rowHeight}}

 newPage();
 text('COMPLIANCE SNAPSHOT',20,{font:bold,color:navy,gap:5});
 text('Administrative evidence status for user access, agreements, and training records',10,{color:gray,gap:12});
 metadata('Report ID',input.reportId);
 metadata('Generated UTC',input.generatedAtUtc);
 metadata('Windows Operator',input.operator);
 metadata('Application Version',input.applicationVersion);
 metadata('Rule-Set Version',input.ruleSetVersion);
 metadata('Reporting Date',input.reportingDate);
 section('Scope');
 text(`Information Systems: ${input.selectedSystems.join(', ')||'None'}`);
 text(`Organizations: ${input.selectedOrganizations.join(', ')||'None'}`);
 text(`User Record Status: ${input.recordStatus}`,9,{gap:5});
 section('Executive Summary');
 cards([
  {label:'Users in Scope',value:String(summary.users)},
  {label:'General Users',value:String(summary.generalUsers)},
  {label:'Privileged Users',value:String(summary.privilegedUsers)},
  {label:'Current Requirements',value:String(summary.current),color:green},
  {label:'Missing Requirements',value:String(summary.missing),color:red},
  {label:'Overdue Requirements',value:String(summary.overdue),color:amber},
  {label:'Active Exceptions',value:String(summary.exceptions),color:amber},
 ]);
 text(`Privileged User Types Represented (${summary.privilegedTypes.length}): ${summary.privilegedTypes.join(', ')||'None'}`,8,{color:gray,gap:4});
 ensure(158);section('Overdue Aging');
 cards(Object.entries(summary.aging).map(([label,value])=>({label:label.replace('days','Days'),value:String(value),color:value?amber:navy})));
 onProgress?.('Building Organization Breakdown',2,progressTotal);await yieldToBrowser();table('Breakdown by Organization',summary.byOrganization);
 onProgress?.('Building Information System Breakdown',3,progressTotal);await yieldToBrowser();table('Breakdown by Information System',summary.bySystem);
 onProgress?.('Building Role Breakdown',4,progressTotal);await yieldToBrowser();table('Breakdown by Role',summary.byRole);
 onProgress?.('Building Privileged Type Breakdown',5,progressTotal);await yieldToBrowser();table('Breakdown by Privileged User Type',summary.byPrivilegedType);
 onProgress?.('Building Artifact Breakdown',6,progressTotal);await yieldToBrowser();table('Breakdown by Artifact',summary.byArtifact);
 section('Methodology and Limitations');
 text(`Statuses were calculated as of ${input.reportingDate} using rule set ${input.ruleSetVersion}. SAAR records can be Current or Missing and do not expire. Other required artifacts become Overdue one year after the valid DDMMMYYYY filename date. Active exceptions are counted separately and do not alter the underlying Missing or Overdue status.`);
 text('This report is an administrative evidence snapshot. It supports audit and inspection evidence gathering but does not independently establish that technical or organizational controls are effective.',9,{gap:5});
 for(let index=0;index<pages.length;index++){const footer=`Report ${input.reportId} | Page ${index+1} of ${pages.length}`;pages[index].drawLine({start:{x:margin,y:36},end:{x:width-margin,y:36},thickness:0.5,color:rgb(0.82,0.85,0.87)});pages[index].drawText(ascii(footer),{x:margin,y:23,size:7,font:regular,color:gray})}
 document.setTitle(`Compliance Snapshot ${input.reportId}`);document.setAuthor(ascii(input.operator));document.setSubject('Administrative user access and training evidence snapshot');document.setCreator(`Information System User Tracker ${input.applicationVersion}`);document.setCreationDate(new Date(input.generatedAtUtc));
 onProgress?.('Finalizing PDF',7,progressTotal);await yieldToBrowser();const bytes=await document.save({useObjectStreams:true});onProgress?.('PDF Ready',8,progressTotal);return bytes;
}
