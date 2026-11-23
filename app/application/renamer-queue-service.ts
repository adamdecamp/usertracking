import type {RenamerQueuePayload,SavedRenamerItem} from '../tracker-workflow-types.ts';

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bounded=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\r\n\0]/.test(value);
const strings=(value:unknown,maxItems:number,maxLength:number):value is string[]=>Array.isArray(value)&&value.length<=maxItems&&value.every(item=>bounded(item,maxLength));
function validCandidates(value:unknown){return value===undefined||Array.isArray(value)&&value.length<=3&&value.every(item=>record(item)&&bounded(item.userId,100)&&bounded(item.last,100)&&bounded(item.first,100)&&bounded(item.organization,200)&&bounded(item.label,500)&&typeof item.score==='number'&&item.score>=0&&item.score<=1&&strings(item.reasons,10,500))}

/** Runtime-decodes the resumable queue before presentation code sees it. */
export function decodeRenamerQueuePayload(value:unknown,systemId:string,ruleSetVersion:string,limit:number):RenamerQueuePayload|undefined{
 if(!record(value)||value.version!==1||value.ruleSetVersion!==ruleSetVersion||value.systemId!==systemId||!Array.isArray(value.items)||value.items.length>limit)return;
 const items:SavedRenamerItem[]=[];
 for(const raw of value.items){
  if(!record(raw)||!bounded(raw.id,32767)||!bounded(raw.path,32767)||!bounded(raw.filename,500)||!bounded(raw.kind,100)||!bounded(raw.first,100)||!bounded(raw.last,100)||!bounded(raw.organization,200)||!bounded(raw.date,50)||!bounded(raw.role,10)||!bounded(raw.privilegedType,200)||!['High','Review','Manual'].includes(String(raw.confidence))||!strings(raw.evidence,50,1000)||typeof raw.selected!=='boolean'||raw.size!==undefined&&(!Number.isSafeInteger(raw.size)||Number(raw.size)<0)||raw.lastModifiedUnixMs!==undefined&&(!Number.isSafeInteger(raw.lastModifiedUnixMs)||Number(raw.lastModifiedUnixMs)<0)||raw.score!==undefined&&(typeof raw.score!=='number'||raw.score<0||raw.score>1)||raw.margin!==undefined&&(typeof raw.margin!=='number'||raw.margin<0||raw.margin>1)||!strings(raw.vetoes??[],20,1000)||!validCandidates(raw.candidates)||raw.normalizedPattern!==undefined&&!bounded(raw.normalizedPattern,2000)||raw.decisionSource!==undefined&&!['automatic','alias','review'].includes(String(raw.decisionSource)))return;
  items.push(raw as SavedRenamerItem);
 }
 return{version:1,ruleSetVersion,systemId,savedAtUtc:bounded(value.savedAtUtc,50)?value.savedAtUtc:'',items};
}
