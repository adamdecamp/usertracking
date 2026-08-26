import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync} from 'fflate';
import {acceptsEvidenceExtension,inspectEvidenceBytes} from '../app/evidence-validation.ts';

const pdf=new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

test('accepts a direct PDF by content',()=>{
 const result=inspectEvidenceBytes('Shaw_Vivian_(GOV)_GEN_SAAR_24AUG2026.pdf',pdf);
 assert.equal(result.kind,'pdf');
 assert.equal(result.pdfBytes.length,pdf.length)
});

test('accepts a ZIP containing exactly one PDF',()=>{
 const archive=zipSync({'Shaw_Vivian_(GOV)_GEN_SAAR_24AUG2026.pdf':pdf});
 const result=inspectEvidenceBytes('Shaw_Vivian_(GOV)_GEN_SAAR_24AUG2026.pdf.zip',archive);
 assert.equal(result.kind,'zip');
 assert.equal(result.pdfName,'Shaw_Vivian_(GOV)_GEN_SAAR_24AUG2026.pdf')
});

test('rejects renamed files, non-PDF ZIP entries, and multiple documents',()=>{
 assert.throws(()=>inspectEvidenceBytes('evidence.pdf',new TextEncoder().encode('this is not a real PDF document')),/PDF header/);
 assert.throws(()=>inspectEvidenceBytes('evidence.zip',zipSync({'evidence.txt':new TextEncoder().encode('text')})),/exactly one PDF/);
 assert.throws(()=>inspectEvidenceBytes('evidence.zip',zipSync({'one.pdf':pdf,'two.pdf':pdf})),/exactly one PDF/)
});

test('rejects unsafe ZIP paths and excessive expansion ratios',()=>{
 assert.throws(()=>inspectEvidenceBytes('evidence.zip',zipSync({'../escape.pdf':pdf})),/unsafe entry path/);
 const highlyCompressible=new Uint8Array(2*1024*1024);highlyCompressible.set(pdf);highlyCompressible.set(new TextEncoder().encode('%%EOF'),highlyCompressible.length-5);
 assert.throws(()=>inspectEvidenceBytes('evidence.zip',zipSync({'large.pdf':highlyCompressible},{level:9})),/expansion ratio/)
});

test('limits the accepted evidence extensions',()=>{
 assert.equal(acceptsEvidenceExtension('document.PDF'),true);
 assert.equal(acceptsEvidenceExtension('document.zip'),true);
 assert.equal(acceptsEvidenceExtension('document.docx'),false)
});
