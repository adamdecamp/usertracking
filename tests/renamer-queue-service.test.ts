import test from'node:test';
import assert from'node:assert/strict';
import{decodeRenamerQueuePayload}from'../app/application/renamer-queue-service.ts';

const systemId='system-one',rules='rules-1';
const validItem={id:'item-1',path:'Organizations/LM/file.pdf',filename:'Brown_Jacob_(LM)_Cyber_26AUG2026.pdf',kind:'DoD Cyber Cert',first:'Jacob',last:'Brown',organization:'LM',date:'2026-08-26',role:'',privilegedType:'',confidence:'Review',evidence:['Filename identity recognized.'],selected:true,score:.91,margin:.2,vetoes:[],normalizedPattern:'BROWN|JACOB|LM|CYBER|{DATE}',decisionSource:'review',candidates:[{userId:'user-one',last:'Brown',first:'Jacob',organization:'LM',label:'Brown, Jacob · LM',score:.91,reasons:['Same organization.']} ]};
const payload=(item:Record<string,unknown>=validItem)=>({version:1,ruleSetVersion:rules,systemId,savedAtUtc:'2026-11-22T12:00:00.000Z',items:[item]});

test('renamer queue decoder accepts bounded recognition review metadata',()=>{
 const decoded=decodeRenamerQueuePayload(payload(),systemId,rules,100);
 assert.equal(decoded?.items[0].candidates?.[0].userId,'user-one');assert.equal(decoded?.items[0].decisionSource,'review');
});

test('renamer queue decoder rejects malformed, oversized, and foreign-boundary data',()=>{
 assert.equal(decodeRenamerQueuePayload({...payload(),systemId:'other'},systemId,rules,100),undefined);
 assert.equal(decodeRenamerQueuePayload(payload({...validItem,score:2}),systemId,rules,100),undefined);
 assert.equal(decodeRenamerQueuePayload(payload({...validItem,candidates:Array.from({length:4},()=>validItem.candidates[0])}),systemId,rules,100),undefined);
 assert.equal(decodeRenamerQueuePayload({...payload(),items:Array.from({length:101},()=>validItem)},systemId,rules,100),undefined);
});

test('renamer queue decoder recovers a valid version-one queue saved before recognition metadata existed',()=>{
 const modernFields=new Set(['score','margin','vetoes','normalizedPattern','decisionSource','candidates']),legacyItem=Object.fromEntries(Object.entries(validItem).filter(([key])=>!modernFields.has(key)));
 const decoded=decodeRenamerQueuePayload(payload(legacyItem),systemId,rules,100);
 assert.equal(decoded?.items.length,1);assert.equal(decoded?.items[0].score,undefined);
});

test('renamer queue decoder is deterministic for interrupted partial JSON objects',()=>{
 for(const interrupted of[null,{},payload({id:'item-1'}),{...payload(),items:'not-an-array'}])assert.equal(decodeRenamerQueuePayload(interrupted,systemId,rules,100),undefined);
});
