import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createExecutiveSummaryPdf} from '../app/executive-summary.ts';
import {complianceRuleSetVersion} from '../app/version.ts';

function argument(name:string){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined}

const output=argument('--output');
if(!output)throw new Error('Use --output to specify the executive summary PDF path.');
const packageData=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')) as{version?:string};
const version=argument('--version')??packageData.version??'Unknown';
const generatedAtUtc=argument('--generated-at')??new Date().toISOString();
const bytes=await createExecutiveSummaryPdf({version,ruleSetVersion:complianceRuleSetVersion,generatedAtUtc});
const resolved=path.resolve(output);await mkdir(path.dirname(resolved),{recursive:true});await writeFile(resolved,bytes);
console.log(`Generated ${resolved} (${bytes.length} bytes)`);
