import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';
import {officialEmailFromText,parseSaarName,readSaarFormFields} from '../app/saar-form-utils.ts';

test('reads name, organization, and official email from the derived SAAR AcroForm',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),form=pdf.getForm();
 for(const[name,value,y]of[
  ['1 NAME Last First Middle Initial','Brown, Jacob A',700],
  ['2 ORGANIZATION','LM',650],
  ['4 OFFICIAL EMAIL ADDRESS','jacob.brown@example.mil',600],
 ]as const){const field=form.createTextField(name);field.setText(value);field.addToPage(page,{x:20,y,width:300,height:20})}
 const result=await readSaarFormFields(await pdf.save());
 assert.deepEqual(result,{fillable:true,format:'AcroForm',identity:{last:'Brown',first:'Jacob',middle:'A'},organization:'LM',email:'jacob.brown@example.mil'});
});

test('accepts a simplified Official Email AcroForm field name',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),form=pdf.getForm(),field=form.createTextField('Official Email');field.setText('alternate.user@example.com');field.addToPage(page,{x:20,y:600,width:300,height:20});
 const result=await readSaarFormFields(await pdf.save());
 assert.equal(result.email,'alternate.user@example.com');
});

test('reads equivalent fields from an official DD2875-style XFA datasets packet',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage([612,792]);
 const xml='<?xml version="1.0"?><xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><form1><page1><Part1><Organization2>Boeing</Organization2><Email_Address5>vivian.shaw@example.mil</Email_Address5></Part1></page1><name1>Shaw, Vivian R</name1></form1></xfa:data></xfa:datasets>';
 const datasets=pdf.context.register(pdf.context.flateStream(xml)),xfa=pdf.context.obj([PDFString.of('datasets'),datasets]),acro=pdf.context.obj({Fields:[],XFA:xfa});
 pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(acro));
 const result=await readSaarFormFields(await pdf.save({useObjectStreams:false}));
 assert.deepEqual(result,{fillable:true,format:'XFA',identity:{last:'Shaw',first:'Vivian',middle:'R'},organization:'Boeing',email:'vivian.shaw@example.mil'});
});

test('rejects a PDF without AcroForm or XFA form data',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage([612,792]);
 assert.deepEqual(await readSaarFormFields(await pdf.save()),{fillable:false});
});

test('parses Last, First, Middle and rejects template names',()=>{
 assert.deepEqual(parseSaarName('De Camp, Adam J'),{last:'De Camp',first:'Adam',middle:'J'});
 assert.deepEqual(parseSaarName('Brown Jacob Q'),{last:'Brown',first:'Jacob',middle:'Q'});
 assert.equal(parseSaarName('Last, First M'),undefined);
});

test('finds a valid email immediately after the Official Email label',()=>{
 assert.equal(officialEmailFromText('4. OFFICIAL EMAIL ADDRESS Jacob.Brown@Example.mil 5. JOB TITLE'),'jacob.brown@example.mil');
 assert.equal(officialEmailFromText('Official E-mail: vivian.shaw@example.com'),'vivian.shaw@example.com');
 assert.equal(officialEmailFromText('4. OFFICIAL/ORGANIZATION E\u00adMAIL ADDRESS user.name@example.mil 5. JOB TITLE'),'user.name@example.mil');
 assert.equal(officialEmailFromText('Email jacob@example.mil without the required label'),undefined);
});

test('does not substitute another official\'s email for the user email',()=>{
 assert.equal(officialEmailFromText('OFFICIAL EMAIL ADDRESS Supervisor Email supervisor@example.mil'),undefined);
 assert.equal(officialEmailFromText('OFFICIAL EMAIL ADDRESS invalid-address PHONE 555-0100'),undefined);
});
