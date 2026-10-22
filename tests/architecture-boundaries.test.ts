import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {dirname,extname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const appRoot=join(root,'app');

function sourceFiles(directory:string):string[]{
 return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const path=join(directory,entry.name);
  if(entry.isDirectory())return sourceFiles(path);
  return ['.ts','.tsx'].includes(extname(entry.name))?[path]:[];
 });
}

function importsOf(path:string):string[]{
 const source=readFileSync(path,'utf8');
 return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)].map(match=>match[1]);
}

function resolvedLocalImport(from:string,specifier:string):string|undefined{
 if(!specifier.startsWith('.'))return;
 return resolve(dirname(from),specifier).split(sep).join('/');
}

test('domain, application, and infrastructure layers cannot depend on React presentation code',()=>{
 const violations:string[]=[];
 for(const path of sourceFiles(appRoot)){
  const normalized=path.split(sep).join('/');
  const layer=normalized.includes('/app/domain/')?'domain':normalized.includes('/app/application/')?'application':normalized.includes('/app/infrastructure/')?'infrastructure':undefined;
  if(!layer)continue;
  for(const specifier of importsOf(path)){
   const target=resolvedLocalImport(path,specifier);
   if(!target)continue;
   const presentation=target.includes('/app/components/')||/\/app\/page$/.test(target)||target.includes('/app/user-guide/');
   const inwardViolation=layer==='domain'&&(target.includes('/app/application/')||target.includes('/app/infrastructure/'));
   const infrastructureToApplication=layer==='infrastructure'&&target.includes('/app/application/');
   if(presentation||inwardViolation||infrastructureToApplication)violations.push(`${relative(root,path)} -> ${specifier}`);
  }
 }
 assert.deepEqual(violations,[],`Layer violations:\n${violations.join('\n')}`);
});

test('no reusable module imports the monolithic route component',()=>{
 const violations=sourceFiles(appRoot)
  .filter(path=>!path.endsWith(`${sep}page.tsx`))
  .flatMap(path=>importsOf(path).filter(specifier=>/(?:^|\/)page$/.test(specifier)).map(specifier=>`${relative(root,path)} -> ${specifier}`));
 assert.deepEqual(violations,[]);
});

test('architectural size budgets prevent silent monolith growth',()=>{
 const pageBytes=statSync(join(appRoot,'page.tsx')).size;
 const storageLines=readFileSync(join(root,'portable-launcher','PortableStorage.cs'),'utf8').split(/\r?\n/).length;
 const launcherLines=readFileSync(join(root,'portable-launcher','Program.cs'),'utf8').split(/\r?\n/).length;
 assert.ok(pageBytes<=479_000,`app/page.tsx is ${pageBytes} bytes; extract behavior before exceeding 479,000.`);
 assert.ok(storageLines<=5_100,`PortableStorage.cs is ${storageLines} lines; extract a storage service before exceeding 5,100.`);
 assert.ok(launcherLines<=1_050,`Program.cs is ${launcherLines} lines; extract endpoint policy before exceeding 1,050.`);
 for(const file of ['PortableSyncJob.cs','PortableNetworkQualification.cs','PortableManifestValidation.cs']){const lines=readFileSync(join(root,'portable-launcher',file),'utf8').split(/\r?\n/).length;assert.ok(lines<=300,`${file} is ${lines} lines; keep the launcher capability focused.`)}
});
