import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAuditText} from '../app/audit-utils.ts';
import {inspectEvidenceBytes} from '../app/evidence-validation.ts';
import {artifactKinds,fileTokenList,fileTokens,filenameIdentityMatches,filenameMatchesKind,identityFromFilename,looksLikeEvidenceFilename,organizationFrom,parseDate,validateNewUserSaarFilename} from '../app/filename-utils.ts';

let seed=0x53a91f27;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/0x100000000}
function pick<T>(values:T[]){return values[Math.floor(random()*values.length)]}
const fuzzCharacters=['A','z','0','_','-',',',' ','(',')','.','/','\\','\0','\n','\r','\t','é','中','😀','%','?','*',String.fromCharCode(0x7f)];
function randomText(maxLength=700){const length=Math.floor(random()*maxLength);let value='';for(let index=0;index<length;index++)value+=pick(fuzzCharacters);return value}

test('fuzzes filename parsing without uncaught parser failures',()=>{
 for(let index=0;index<5000;index++){
  const filename=randomText();
  assert.doesNotThrow(()=>{
   fileTokenList(filename);fileTokens(filename);parseDate(filename);organizationFrom(filename);identityFromFilename(filename);looksLikeEvidenceFilename(filename);validateNewUserSaarFilename(filename);filenameIdentityMatches(filename,{last:'Brown',first:'Jacob'});
   for(const kind of artifactKinds)filenameMatchesKind(filename,kind);
  });
 }
});

test('fuzzes accepted separator variations while preserving ordered identity and artifact matching',()=>{
 const nameSeparators=['_','_   ',', ','   '],tokenSeparators=['_',' ','   ','__'];
 for(let index=0;index<1000;index++){
  const nameSeparator=pick(nameSeparators),tokenSeparator=pick(tokenSeparators),leading=pick(['',' ','   ']),extension=pick(['.pdf','.PDF','.pdf.zip']);
  const cyber=`${leading}Brown${nameSeparator}Jacob${tokenSeparator}(LM)${tokenSeparator}DoD${tokenSeparator}Cyber${tokenSeparator}Cert${tokenSeparator}26AUG2026${extension}`;
  const agreement=`${leading}Brown${nameSeparator}Jacob${tokenSeparator}(LM)${tokenSeparator}GEN${tokenSeparator}User${tokenSeparator}Agreement${tokenSeparator}26AUG2026${extension}`;
  assert.equal(filenameIdentityMatches(cyber,{last:'Brown',first:'Jacob'}),true,cyber);
  assert.equal(filenameMatchesKind(cyber,'DoD Cyber Cert'),true,cyber);
  assert.equal(filenameIdentityMatches(agreement,{last:'Brown',first:'Jacob'}),true,agreement);
  assert.equal(filenameMatchesKind(agreement,'GEN User Agreement'),true,agreement);
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
