import assert from 'node:assert/strict';
import test from 'node:test';
import braces from 'braces';

test('the reviewed braces backport accepts normal patterns',()=>{
  assert.deepEqual(braces('report-{current,missing,overdue}.csv',{expand:true}),['report-current.csv','report-missing.csv','report-overdue.csv']);
});

test('the reviewed braces backport rejects excessive nesting',()=>{
  const nested='{'.repeat(101)+'record'+'}'.repeat(101);
  assert.throws(()=>braces(nested),error=>error instanceof SyntaxError&&/exceeds max depth/.test(error.message));
});
