import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{test}from'node:test';

const panel=readFileSync('app/components/ProcessingPanel.tsx','utf8');

test('every processing status uses the shared stage, progress, current-item, and elapsed-time display',()=>{
 assert.match(panel,/Stage: \{status\.phase\}/);
 assert.match(panel,/of \$\{status\.total\} \$\{status\.unit\} processed/);
 assert.match(panel,/Workload total is still being discovered/);
 assert.match(panel,/Elapsed \{elapsed\}/);
 assert.match(panel,/<b>Current:<\/b>/);
});
