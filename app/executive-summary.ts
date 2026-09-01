import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';

export type ExecutiveSummaryInput={
 version:string;
 ruleSetVersion:string;
 generatedAtUtc:string;
};

const navy=rgb(0.055,0.13,0.22),green=rgb(0.08,0.45,0.31),panel=rgb(0.95,0.97,0.98),slate=rgb(0.22,0.29,0.36),muted=rgb(0.43,0.49,0.54),line=rgb(0.82,0.86,0.88),white=rgb(1,1,1);

function wrap(text:string,font:PDFFont,size:number,width:number){
 const words=text.split(/\s+/),lines:string[]=[];let current='';
 for(const word of words){const candidate=current?`${current} ${word}`:word;if(font.widthOfTextAtSize(candidate,size)<=width)current=candidate;else{if(current)lines.push(current);current=word}}
 if(current)lines.push(current);return lines;
}

function paragraph(page:PDFPage,text:string,x:number,y:number,width:number,font:PDFFont,size=9.1,leading=12,color=slate){
 for(const value of wrap(text,font,size,width)){page.drawText(value,{x,y,size,font,color});y-=leading}return y;
}

function heading(page:PDFPage,text:string,x:number,y:number,font:PDFFont){
 page.drawRectangle({x,y:y-5,width:4,height:17,color:green});page.drawText(text,{x:x+11,y,size:12,font,color:navy});return y-24;
}

function bullets(page:PDFPage,items:string[],x:number,y:number,width:number,font:PDFFont){
 for(const item of items){page.drawRectangle({x,y:y+2,width:4,height:4,color:green});const lines=wrap(item,font,8.7,width-13);for(const value of lines){page.drawText(value,{x:x+13,y,size:8.7,font,color:slate});y-=11}y-=6}return y;
}

export async function createExecutiveSummaryPdf(input:ExecutiveSummaryInput){
 const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),page=pdf.addPage([612,792]);
 pdf.setTitle('Information System User Tracker - Executive Capability Summary');pdf.setAuthor('Information System User Tracker');pdf.setSubject('Executive summary of administrative user-access and compliance evidence capabilities');pdf.setKeywords(['user tracking','audit evidence','access administration','NIST SP 800-53']);pdf.setCreationDate(new Date(input.generatedAtUtc));pdf.setModificationDate(new Date(input.generatedAtUtc));

 page.drawRectangle({x:0,y:642,width:612,height:150,color:navy});page.drawRectangle({x:0,y:642,width:9,height:150,color:green});
 page.drawText('EXECUTIVE CAPABILITY BRIEF',{x:42,y:757,size:9,font:bold,color:rgb(0.53,0.89,0.72)});
 page.drawText('Information System User Tracker',{x:42,y:719,size:25,font:bold,color:white});
 page.drawText('Audit-ready administrative oversight for access and training evidence',{x:42,y:693,size:11,font:regular,color:rgb(0.86,0.91,0.94)});
 page.drawRectangle({x:42,y:658,width:332,height:21,color:green});
 page.drawText(`Release ${input.version}   |   Rule Set ${input.ruleSetVersion}`,{x:54,y:665,size:8.5,font:bold,color:white});

 let leftY=611;leftY=heading(page,'Executive Purpose',42,leftY,bold);leftY=paragraph(page,'Provides a single administrative view of user access, roles, training, agreements, and supporting evidence across multiple information systems. It is designed for intermittent Windows use with organization-controlled shared folders.',42,leftY,248,regular);leftY-=9;leftY=heading(page,'Core Capabilities',42,leftY,bold);bullets(page,[
  'Folder-first automation restores mapped systems and starts Sync at launch, after mapping, and when changing systems.',
  'Evidence-driven records discover users from validated SAAR PDFs and update requirements from approved PDF or one-PDF ZIP evidence.',
  'Role-aware tracking distinguishes General and Privileged users, including multiple privileged types such as DTA, admin, developer, and cyber.',
  'Actionable status identifies Current, Due Within 30 Days, Missing, and Overdue items and prepares targeted Outlook drafts.'
 ],42,leftY,248,regular);

 let rightY=611;rightY=heading(page,'Audit and Inspection Readiness',322,rightY,bold);rightY=bullets(page,[
  'Tamper-evident daily audit logs use ISO 8601 UTC timestamps, a SHA-256 chain, and the active Windows operator identity.',
  'Daily CSV and versioned JSON backups include checksums, retention controls, integrity verification, and guided restoration.',
  'Compliance Snapshot PDFs and filtered CSV exports provide leadership counts, requirement status, overdue aging, and organizational breakdowns.',
  'Clean Up review identifies invalid, duplicate, superseded, and loose PDF evidence for approved organization Rework, organization Archive, or ZIP conversion.'
 ],322,rightY,248,regular);rightY-=2;rightY=heading(page,'Secure, Lightweight Deployment',322,rightY,bold);bullets(page,[
  'One portable Windows executable runs locally without an installer or cloud database.',
  'Local-loopback hosting and per-system folders keep records under existing Windows or SMB permissions.',
  'Exclusive folder locking prevents concurrent writers; logoff and automatic shutdown perform final backups.',
  'Strict PDF and ZIP validation, release-clean packaging, and mandatory regression and fuzz tests protect each build.'
 ],322,rightY,248,regular);

 page.drawLine({start:{x:42,y:230},end:{x:570,y:230},thickness:1,color:line});
 page.drawRectangle({x:42,y:96,width:528,height:119,color:panel,borderColor:line,borderWidth:1});
  page.drawText('Mission Value Statement',{x:57,y:190,size:12,font:bold,color:navy});
  paragraph(page,'Strengthens mission assurance by converting distributed access and training evidence into a reliable, audit-ready operational picture. Folder-first automation reduces manual reconciliation, identifies missing and expiring requirements before access is disrupted, preserves traceable records for inspections, and supports timely, accountable decisions across organizations. It operates within existing Windows-controlled storage as an administrative evidence tool and does not replace authorization decisions or technical access controls.',57,168,496,regular,9.2,12,slate);
 page.drawLine({start:{x:42,y:36},end:{x:570,y:36},thickness:0.7,color:line});
 page.drawText(`Information System User Tracker  |  Version ${input.version}`,{x:42,y:20,size:7.4,font:regular,color:muted});
 const generated=`Generated ${input.generatedAtUtc}`;page.drawText(generated,{x:570-regular.widthOfTextAtSize(generated,7.4),y:20,size:7.4,font:regular,color:muted});
 return pdf.save();
}
