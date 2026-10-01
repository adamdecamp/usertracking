import {PDFDocument,PageSizes,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';
import type {ReconciliationIssue} from './workflow-utils';

export type ReconciliationReportInput={
 reportId:string;
 generatedAtUtc:string;
 operator:string;
 applicationVersion:string;
 ruleSetVersion:string;
 informationSystem:string;
 mappedFolder:string;
 issues:ReconciliationIssue[];
};

const ascii=(value:string)=>String(value).replace(/[^\x20-\x7e]/g,'?');
const correctiveAction=(category:ReconciliationIssue['category'])=>({
 'File Collision':'Review the active copies and retain or associate one authoritative file.',
 'Content Changed':'Confirm the current file is authorized, then replace or re-ingest it so the recorded SHA-256 matches.',
 'Duplicate Identity':'Review the records and retain one authoritative identity before the next Sync.',
 'Duplicate Email':'Confirm the correct account owner and update the duplicate Official Email entry.',
 'Account State Conflict':'Confirm whether the account is Active or Disabled and retain one authoritative state.',
 'Organization Conflict':'Correct the user organization or move and rename the evidence under the authoritative organization folder.',
 'Rejected Evidence':'Correct the reported filename, format, date, or readability problem before reprocessing.',
}[category]);

export async function createReconciliationReportPdf(input:ReconciliationReportInput){
 const document=await PDFDocument.create(),regular=await document.embedFont(StandardFonts.Helvetica),bold=await document.embedFont(StandardFonts.HelveticaBold),navy=rgb(.07,.16,.28),green=rgb(.04,.45,.34),red=rgb(.72,.16,.18),amber=rgb(.78,.45,.05),gray=rgb(.36,.41,.48),light=rgb(.94,.96,.97),margin=42,width=PageSizes.Letter[0],height=PageSizes.Letter[1];
 const pages:PDFPage[]=[];let page!:PDFPage,y=0;
 const wrap=(value:string,font:PDFFont,size:number,maxWidth:number)=>{const words=ascii(value).split(/\s+/),lines:string[]=[];let line='';for(const word of words){const candidate=line?`${line} ${word}`:word;if(font.widthOfTextAtSize(candidate,size)<=maxWidth)line=candidate;else{if(line)lines.push(line);line=word}}if(line)lines.push(line);return lines.length?lines:['']};
 const newPage=()=>{page=document.addPage(PageSizes.Letter);pages.push(page);y=height-margin;page.drawText('R.A.P.T.O.R - ROLE-BASED ACCESS PERSONNEL TRACKING & OVERSIGHT REGISTRY',{x:margin,y,size:8,font:bold,color:green});y-=24};
 const ensure=(needed:number)=>{if(y-needed<54)newPage()};
 const text=(value:string,size=9,options:{font?:PDFFont;color?:ReturnType<typeof rgb>;indent?:number;gap?:number;maxWidth?:number}={})=>{const selectedFont=options.font??regular,indent=options.indent??0,lines=wrap(value,selectedFont,size,options.maxWidth??width-margin*2-indent),lineHeight=size+3;ensure(lines.length*lineHeight+(options.gap??0));for(const line of lines){page.drawText(line,{x:margin+indent,y,size,font:selectedFont,color:options.color??navy});y-=lineHeight}y-=options.gap??0};
 const section=(title:string)=>{ensure(34);y-=6;page.drawRectangle({x:margin,y:y-3,width:width-margin*2,height:22,color:navy});page.drawText(ascii(title),{x:margin+8,y:y+4,size:10,font:bold,color:rgb(1,1,1)});y-=30};
 const metadata=(label:string,value:string)=>{ensure(18);page.drawText(ascii(label),{x:margin,y,size:8,font:bold,color:gray});for(const[lineIndex,line]of wrap(value,regular,8,width-202).entries())page.drawText(line,{x:160,y:y-lineIndex*11,size:8,font:regular,color:navy});y-=Math.max(15,wrap(value,regular,8,width-202).length*11+3)};
 const counts=new Map<string,number>();for(const issue of input.issues)counts.set(issue.category,(counts.get(issue.category)??0)+1);
 const high=input.issues.filter(issue=>issue.severity==='High').length,medium=input.issues.length-high;

 newPage();text('RECONCILIATION REPORT',20,{font:bold,gap:5});text('Read-only mapped-folder integrity findings and operator correction reference',10,{color:gray,gap:12});
 metadata('Report ID',input.reportId);metadata('Generated UTC',input.generatedAtUtc);metadata('Windows Operator',input.operator);metadata('Application Version',input.applicationVersion);metadata('Rule-Set Version',input.ruleSetVersion);metadata('Information System',input.informationSystem);metadata('Mapped Folder',input.mappedFolder);
 section('Summary');
 const cards=[{label:'Total Issues',value:input.issues.length,color:navy},{label:'High Priority',value:high,color:red},{label:'Review',value:medium,color:amber}];ensure(66);const cardWidth=(width-margin*2-16)/3;for(const[index,item]of cards.entries()){const x=margin+index*(cardWidth+8);page.drawRectangle({x,y:y-46,width:cardWidth,height:54,color:light,borderColor:rgb(.82,.85,.87),borderWidth:.6});page.drawText(String(item.value),{x:x+9,y:y-18,size:18,font:bold,color:item.color});page.drawText(item.label,{x:x+9,y:y-36,size:8,font:regular,color:gray})}y-=64;
 if(counts.size){text(Array.from(counts,([category,count])=>`${category}: ${count}`).join(' | '),8,{color:gray,gap:4})}else text('No reconciliation issues were found in this completed run.',10,{font:bold,color:green,gap:6});
 section('Operator Guidance');text('This report is a correction reference. It does not move files or change user records. Resolve High items first, retain supporting evidence for each decision, and run Reconciliation again to verify the corrected state.',9,{gap:5});
 if(input.issues.length){section('Detailed Findings');for(const[index,issue]of input.issues.entries()){const heading=`${index+1}. ${issue.category} - ${issue.severity}`,detailLines=wrap(issue.detail,regular,8.5,width-margin*2-14),summaryLines=wrap(issue.summary,bold,9,width-margin*2-14),pathLines=issue.path?wrap(`Path: ${issue.path}`,regular,7.5,width-margin*2-14):[],actionLines=wrap(`Recommended Action: ${correctiveAction(issue.category)}`,regular,8.5,width-margin*2-14),needed=48+summaryLines.length*12+detailLines.length*11.5+pathLines.length*10.5+actionLines.length*11.5;ensure(needed);page.drawRectangle({x:margin,y:y-needed+8,width:width-margin*2,height:needed,color:light,borderColor:issue.severity==='High'?red:amber,borderWidth:1});y-=14;text(heading,9,{font:bold,color:issue.severity==='High'?red:amber,indent:7});text(issue.summary,9,{font:bold,indent:7});text(issue.detail,8.5,{indent:7});if(issue.path)text(`Path: ${issue.path}`,7.5,{color:gray,indent:7});text(`Recommended Action: ${correctiveAction(issue.category)}`,8.5,{indent:7,gap:8})}}
 for(const[index,current]of pages.entries()){current.drawLine({start:{x:margin,y:36},end:{x:width-margin,y:36},thickness:.5,color:rgb(.82,.85,.87)});current.drawText(ascii(`Report ${input.reportId} | Page ${index+1} of ${pages.length}`),{x:margin,y:23,size:7,font:regular,color:gray})}
 document.setTitle(`Reconciliation Report ${input.reportId}`);document.setAuthor(ascii(input.operator));document.setSubject('Mapped-folder integrity findings and corrective-action reference');document.setCreator(`R.A.P.T.O.R ${input.applicationVersion}`);document.setCreationDate(new Date(input.generatedAtUtc));
 return document.save({useObjectStreams:true});
}
