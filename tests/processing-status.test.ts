import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{test}from'node:test';

const panel=readFileSync('app/components/ProcessingPanel.tsx','utf8');
const hook=readFileSync('app/components/useProcessingStatus.ts','utf8');

test('every processing status uses the shared stage, progress, current-item, and elapsed-time display',()=>{
 assert.match(panel,/Stage: \{status\.phase\}/);
 assert.match(panel,/of \$\{status\.total\} \$\{status\.unit\} processed/);
 assert.match(panel,/Workload total is still being discovered/);
 assert.match(panel,/Elapsed \{elapsed\}/);
 assert.match(panel,/<b>Current:<\/b>/);
 assert.match(panel,/status\.startedAtMs\?\?now/);
 assert.match(panel,/status\.completedAtMs\?\?now/);
 assert.match(hook,/state:'running',startedAtMs:Date\.now\(\)/);
 assert.match(hook,/current\?\.state==='running'&&current\.phase===phase/);
 assert.match(hook,/startedAtMs:continuesCurrentAction\?current\.startedAtMs:Date\.now\(\)/);
 assert.match(hook,/completedAtMs:Date\.now\(\)/);
});
