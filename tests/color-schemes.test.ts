import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {applyColorScheme,brandColors,colorSchemes,customColorScheme,defaultColorSchemeId,parseColorSchemeChoice,resolveColorScheme,schemeColor,schemeVariables} from '../app/color-schemes.ts';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const css=read('../app/globals.css');
const lightness=(hex:string)=>{const v=[0,2,4].map(i=>parseInt(hex.replace('#','').slice(i,i+2),16)/255);return(Math.max(...v)+Math.min(...v))/2};
const hue=(hex:string)=>{const [r,g,b]=[0,2,4].map(i=>parseInt(hex.replace('#','').slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return 0;const h=max===r?((g-b)/d+(g<b?6:0)):max===g?(b-r)/d+2:(r-g)/d+4;return h*60};

test('every brand color in the stylesheet is a scheme variable that defaults to its original color',()=>{
 const variables=new Set([...css.matchAll(/var\(--rc-([0-9a-f]{6}),#([0-9a-f]{6})\)/g)].map(match=>{assert.equal(match[1],match[2],'each variable falls back to its own color');return match[1]}));
 assert.deepEqual([...variables].sort(),[...brandColors].sort(),'the scheme module lists exactly the colors the stylesheet uses');
 const unwrapped=[...css.replace(/var\(--rc-[0-9a-f]{6},#[0-9a-f]{6}\)/g,'').matchAll(/#([0-9a-fA-F]{6})\b/g)].map(match=>match[1].toLowerCase()).filter(hex=>(brandColors as readonly string[]).includes(hex));
 assert.deepEqual(unwrapped,[],'no brand color is left hard-coded');
 for(const status of ['b9554e','d4a62b','8b312a','d6a526'])assert.ok(css.includes(`#${status}`)&&!css.includes(`--rc-${status}`),`status color ${status} never changes`);
});

test('a scheme moves brand colors to its hue and keeps their lightness; the original sets nothing',()=>{
 assert.deepEqual(schemeVariables(resolveColorScheme({id:defaultColorSchemeId})),{});
 const navy=colorSchemes.find(scheme=>scheme.id==='navy')!,variables=schemeVariables(navy);
 assert.equal(Object.keys(variables).length,brandColors.length);
 for(const brand of ['277457','1e5848','eaf1ed','56675f']){const shifted=schemeColor(navy,brand);assert.ok(Math.abs(lightness(shifted)-lightness(brand))<0.01,`${brand} keeps its lightness`)}
 assert.ok(Math.abs(hue(schemeColor(navy,'277457'))-214)<2,'the main brand color takes the scheme hue');
 const slate=colorSchemes.find(scheme=>scheme.id==='slate')!;
 assert.ok(Math.abs(lightness(schemeColor(slate,'277457'))-lightness('277457'))<0.01);
 for(const scheme of colorSchemes){const h=hue(schemeColor(scheme,'277457'));assert.ok(h>=70&&h<=300,`${scheme.label} avoids the red and gold status hues`)}
});

test('a custom color, a saved choice, and applying a scheme are all safe',()=>{
 assert.equal(customColorScheme('not a color'),undefined);
 const custom=customColorScheme('#1e40af')!;assert.equal(custom.id,'custom');assert.ok(Math.abs(custom.hue-226)<=2);
 assert.equal(resolveColorScheme({id:'custom',custom:'#1e40af'}).id,'custom');
 assert.equal(resolveColorScheme({id:'custom',custom:'bad'}).id,defaultColorSchemeId,'a damaged custom value falls back to the original colors');
 assert.equal(resolveColorScheme({id:'unknown'}).id,defaultColorSchemeId);
 assert.deepEqual(parseColorSchemeChoice('{oops'),{id:defaultColorSchemeId});
 assert.deepEqual(parseColorSchemeChoice(null),{id:defaultColorSchemeId});
 assert.deepEqual(parseColorSchemeChoice('{"id":"navy"}'),{id:'navy'});
 const properties=new Map<string,string>(),root={style:{setProperty:(name:string,value:string)=>{properties.set(name,value)},removeProperty:(name:string)=>{properties.delete(name);return''}}};
 applyColorScheme(colorSchemes.find(scheme=>scheme.id==='teal')!,root);assert.equal(properties.size,brandColors.length);
 applyColorScheme(resolveColorScheme({id:defaultColorSchemeId}),root);assert.equal(properties.size,0,'restoring the original removes every override');
});

test('Color Scheme is in System Tools for everyone and the choice is applied and kept like Dark Mode',()=>{
 const header=read('../app/components/OperatorDashboardHeader.tsx'),page=read('../app/page.tsx'),modal=read('../app/components/ColorSchemeModal.tsx');
 const tools=header.slice(header.indexOf(">System Tools</summary>"),header.indexOf('</details>',header.indexOf('>System Tools</summary>')));
 assert.match(tools,/<button onClick=\{\(\)=>runMenuAction\(props\.onColorScheme\)\}>Color Scheme<\/button>/,'available in every access mode');
 assert.match(page,/ColorSchemeModal=lazy\(\(\)=>import\('\.\/components\/ColorSchemeModal'\)/);
 assert.match(page,/\{modal==='colors'&&<Suspense fallback=\{null\}><ColorSchemeModal choice=\{colorScheme\} onChoose=\{setColorScheme\}\/><\/Suspense>\}/);
 assert.match(page,/setColorScheme\(parseColorSchemeChoice\(localStorage\.getItem\(colorSchemeStorageKey\)\)\)/);
 assert.match(page,/if\(!hydrated\)return;applyColorScheme\(resolveColorScheme\(colorScheme\),document\.documentElement\);try\{localStorage\.setItem\(colorSchemeStorageKey,JSON\.stringify\(colorScheme\)\)\}catch\{\}/,'the default state never overwrites a saved scheme before it is loaded');
 assert.match(page,/useLayoutEffect\(\(\)=>\{try\{applyColorScheme\(resolveColorScheme\(parseColorSchemeChoice\(localStorage\.getItem\(colorSchemeStorageKey\)\)\),document\.documentElement\)\}catch\{\}\},\[\]\);/,'a saved scheme is applied before the first paint');
 assert.match(page,/useLayoutEffect\(\(\)=>\{try\{if\(localStorage\.getItem\('isut-theme'\)==='dark'\)document\.querySelector\('main\.app'\)\?\.classList\.add\('dark'\)\}catch\{\}\},\[\]\);/,'saved Dark Mode is applied before the first paint');
 assert.match(modal,/role="radiogroup" aria-label="Color Scheme" data-ignore-unsaved>/,'a choice is saved at once, so closing the window never asks about unsaved changes');
 assert.match(read('../app/components/AccessibleModal.tsx'),/!target\.closest\('\[data-ignore-unsaved\]'\)/);
 assert.match(modal,/Restore Original Colors/);
});
