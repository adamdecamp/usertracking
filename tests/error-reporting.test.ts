import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {installGlobalErrorReporting} from '../app/error-report-events.ts';
import {errorReportDetail} from '../app/error-utils.ts';

test('uncaught browser errors and unhandled rejections reach the central reporter',async()=>{
 const listeners=new Map<string,(event:unknown)=>void>(),original=Object.getOwnPropertyDescriptor(globalThis,'window');
 const fakeWindow={addEventListener:(name:string,listener:(event:unknown)=>void)=>{listeners.set(name,listener)},removeEventListener:(name:string)=>{listeners.delete(name)}} as unknown as Window;
 Object.defineProperty(globalThis,'window',{value:fakeWindow,writable:true,configurable:true});
 const received:{context:string;error:unknown}[]=[],cleanup=installGlobalErrorReporting((context,error)=>{received.push({context,error})});
 listeners.get('error')?.({error:new Error('browser failure'),message:'browser failure'});
 listeners.get('unhandledrejection')?.({reason:new Error('promise failure')});
 cleanup();
 assert.deepEqual(received.map(item=>item.context),['Unhandled browser error.','Unhandled promise rejection.']);
 assert.equal(listeners.size,0);
 if(original)Object.defineProperty(globalThis,'window',original);else delete(globalThis as {window?:unknown}).window;
});

test('daily reports preserve full multi-line error detail while alerts remain bounded',()=>{
 const error=new Error(`primary failure\n${'diagnostic '.repeat(100)}`);
 const detail=errorReportDetail(error);
 assert.match(detail,/primary failure/);
 assert.ok(detail.length>500);
});

test('launcher failures and unavailable shares retain a daily error report',()=>{
 const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8'),storage=readFileSync(new URL('../portable-launcher/PortableStorage.cs',import.meta.url),'utf8'),page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(launcher,/Windows launcher storage operation/);
 assert.match(launcher,/storage\.StoreErrorReport\(systemId/);
 assert.match(launcher,/Windows launcher startup failure/);
 assert.match(launcher,/Windows launcher request failure/);
 assert.match(launcher,/ErrorReportDetail\(ex\)/);
 assert.match(storage,/Error-report shared-folder fallback/);
 assert.match(storage,/Protected Local Workspace\/System\//);
 assert.match(storage,/Deferred backup or CSV flush failure/);
 assert.match(page,/installGlobalErrorReporting/);
 assert.match(page,/pendingErrorReports/);
 assert.match(page,/flushPendingErrorReports/);
});
