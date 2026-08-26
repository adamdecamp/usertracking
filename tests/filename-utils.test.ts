import test from 'node:test';
import assert from 'node:assert/strict';
import {filenameIdentityMatches,filenameMatchesKind,identityFromFilename,looksLikeEvidenceFilename,organizationFrom,parseDate} from '../app/filename-utils.ts';

const dod='Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf';
const general='Brown_Jacob_(LM)_GEN_User_Agreement_26AUG2026.pdf';
const spacedDod='Brown, Jacob (LM) DoD Cyber Cert 26AUG2026.pdf';
const extraSpaceGeneral='  Brown  _   Jacob   (LM)   GEN   User   Agreement   26AUG2026.pdf';

test('recognizes the reported DoD Cyber certificate filename',()=>{
 assert.equal(looksLikeEvidenceFilename(dod),true);
 assert.equal(filenameMatchesKind(dod,'DoD Cyber Cert'),true);
 assert.equal(filenameIdentityMatches(dod,{last:'Brown',first:'Jacob'}),true);
 assert.deepEqual(identityFromFilename(dod),{last:'Brown',first:'Jacob'});
 assert.equal(organizationFrom(dod),'LM');
 assert.equal(parseDate(dod)?.toISOString(),'2026-08-26T00:00:00.000Z');
});

test('recognizes the reported General User Agreement filename',()=>{
 assert.equal(looksLikeEvidenceFilename(general),true);
 assert.equal(filenameMatchesKind(general,'GEN User Agreement'),true);
 assert.equal(filenameIdentityMatches(general,{last:'Brown',first:'Jacob'}),true);
 assert.equal(filenameMatchesKind(general,'DoD Cyber Cert'),false);
});

test('recognizes the stored one-PDF ZIP form of both filenames',()=>{
 assert.equal(filenameMatchesKind(`${dod}.zip`,'DoD Cyber Cert'),true);
 assert.equal(filenameMatchesKind(`${general}.zip`,'GEN User Agreement'),true);
});

test('tolerates commas, missing underscores, and additional spaces',()=>{
 assert.equal(looksLikeEvidenceFilename(spacedDod),true);
 assert.equal(filenameMatchesKind(spacedDod,'DoD Cyber Cert'),true);
 assert.equal(filenameIdentityMatches(spacedDod,{last:'Brown',first:'Jacob'}),true);
 assert.deepEqual(identityFromFilename(spacedDod),{last:'Brown',first:'Jacob'});
 assert.equal(organizationFrom(spacedDod),'LM');
 assert.equal(looksLikeEvidenceFilename(extraSpaceGeneral),true);
 assert.equal(filenameMatchesKind(extraSpaceGeneral,'GEN User Agreement'),true);
 assert.equal(filenameIdentityMatches(extraSpaceGeneral,{last:'Brown',first:'Jacob'}),true);
});

test('still rejects a reversed First-Last identity for the expected user',()=>{
 assert.equal(filenameIdentityMatches('Jacob Brown (LM) DoD Cyber Cert 26AUG2026.pdf',{last:'Brown',first:'Jacob'}),false);
});
