import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAuditText} from '../app/audit-utils.ts';
import {inspectEvidenceBytes} from '../app/evidence-validation.ts';
import {artifactKinds,fileTokenList,fileTokens,filenameIdentityMatches,filenameMatchesKind,identityFromFilename,looksLikeEvidenceFilename,normalizeFilenameDate,organizationFrom,parseDate,trainingCertificateRecoveryKind,validateNewUserSaarFilename} from '../app/filename-utils.ts';
import {readSaarFormFields} from '../app/saar-form-utils.ts';
import {readSyncIndex} from '../app/sync-utils.ts';
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';

let seed=0x53a91f27;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/0x100000000}
function pick<T>(values:T[]){return values[Math.floor(random()*values.length)]}
const fuzzCharacters=['A','z','0','_','-',',',' ','(',')','.','/','\\','\0','\n','\r','\t','é','中','😀','%','?','*',String.fromCharCode(0x7f)];
function randomText(maxLength=700){const length=Math.floor(random()*maxLength);let value='';for(let index=0;index<length;index++)value+=pick(fuzzCharacters);return value}

test('fuzzes filename parsing without uncaught parser failures',()=>{
 for(let index=0;index<5000;index++){
  const filename=randomText();
  assert.doesNotThrow(()=>{
   fileTokenList(filename);fileTokens(filename);parseDate(filename);normalizeFilenameDate(filename);organizationFrom(filename);identityFromFilename(filename);looksLikeEvidenceFilename(filename);trainingCertificateRecoveryKind(filename);validateNewUserSaarFilename(filename);filenameIdentityMatches(filename,{last:'Brown',first:'Jacob'});
   for(const kind of artifactKinds)filenameMatchesKind(filename,kind);
  });
 }
});

test('fuzzes accepted separator variations while preserving ordered identity and artifact matching',()=>{
 const nameSeparators=['_','_   ',', ','   '],tokenSeparators=['_',' ','   ','__',''];
 for(let index=0;index<1000;index++){
  const nameSeparator=pick(nameSeparators),tokenSeparator=pick(tokenSeparators),leading=pick(['',' ','   ']),extension=pick(['.pdf','.PDF','.pdf.zip']);
  const cyber=`${leading}Brown${nameSeparator}Jacob${tokenSeparator}(LM)${tokenSeparator}DoD${tokenSeparator}Cyber${tokenSeparator}Cert${tokenSeparator}26AUG2026${extension}`;
  const agreement=`${leading}Brown${nameSeparator}Jacob${tokenSeparator}(LM)${tokenSeparator}GEN${tokenSeparator}User${tokenSeparator}Agreement${tokenSeparator}26AUG2026${extension}`;
  assert.equal(filenameIdentityMatches(cyber,{last:'Brown',first:'Jacob'}),true,cyber);
  assert.equal(filenameMatchesKind(cyber,'DoD Cyber Cert'),true,cyber);
  assert.equal(filenameIdentityMatches(agreement,{last:'Brown',first:'Jacob'}),true,agreement);
  assert.equal(filenameMatchesKind(agreement,'User Agreement'),true,agreement);
 }
});

test('fuzzes malformed PDF and ZIP bytes with controlled validation errors',()=>{
 for(let index=0;index<1500;index++){
  const length=Math.floor(random()*4096),bytes=new Uint8Array(length);for(let byte=0;byte<length;byte++)bytes[byte]=Math.floor(random()*256);
  try{const result=inspectEvidenceBytes(`Fuzz_${index}${pick(['.pdf','.zip','.PDF','.ZIP'])}`,bytes);assert.ok(result.pdfBytes.length>0)}catch(error){assert.ok(error instanceof Error)}
 }
});

test('fuzzes corrupted audit text with controlled integrity errors',async()=>{
 for(let index=0;index<750;index++)try{await verifyAuditText(randomText(5000))}catch(error){assert.ok(error instanceof Error)}
});

test('fuzzes malformed Sync indexes without parser failures',()=>{
 for(let index=0;index<1500;index++)assert.doesNotThrow(()=>readSyncIndex(index%3===0?randomText(3000):{version:pick([0,1,2]),ruleSetVersion:randomText(40),generatedAtUtc:randomText(60),files:[{path:randomText(),name:randomText(),size:Math.floor((random()-.25)*100000),lastModifiedUnixMs:Math.floor((random()-.25)*2e12),accepted:pick([true,false,'yes']),error:randomText(400)}]},'rules-1'));
});

test('fuzzes DD2875 XFA dataset values without parser failures or markup leakage',async()=>{
 for(let index=0;index<125;index++){
  const pdf=await PDFDocument.create();pdf.addPage([100,100]);
  const value=randomText(1200).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),xml=`<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><form1><name1>${value}</name1><page1><Part1><Organization2>${value}</Organization2><Email_Address5>${value}</Email_Address5></Part1></page1></form1></xfa:data></xfa:datasets>`,stream=pdf.context.register(pdf.context.flateStream(xml)),acro=pdf.context.obj({Fields:[],XFA:pdf.context.obj([PDFString.of('datasets'),stream])});
  pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(acro));
  const result=await readSaarFormFields(await pdf.save({useObjectStreams:false}));
  assert.equal(typeof result.fillable,'boolean');assert.ok(!result.organization?.includes('<')&&!result.email?.includes('<'));
 }
});
