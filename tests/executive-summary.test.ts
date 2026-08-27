import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {createExecutiveSummaryPdf} from '../app/executive-summary.ts';
import {applicationVersion} from '../app/version.ts';

test('generates a single-page executive capability summary',async()=>{
 const bytes=await createExecutiveSummaryPdf({version:'1.2.3',ruleSetVersion:'test-rules',generatedAtUtc:'2026-08-26T12:00:00.000Z'}),pdf=await PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),1);
 assert.equal(pdf.getTitle(),'Information System User Tracker - Executive Capability Summary');
 assert.ok(bytes.length>4000);
});

test('keeps the displayed and packaged application versions aligned',async()=>{
 const packageData=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')) as{version:string};
 assert.equal(applicationVersion,packageData.version);
});
