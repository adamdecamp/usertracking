import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SaveGenerations,staleSyncReviewMessage,syncReviewIsCurrent} from '../app/application/sync-review-guard.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');

test('a Sync review stays applicable only until the next save for its system',()=>{
 const generations=new SaveGenerations();
 const review={baseSaveGeneration:generations.current('s1')};
 assert.equal(syncReviewIsCurrent(review,generations.current('s1')),true);
 generations.advance('s2');
 assert.equal(syncReviewIsCurrent(review,generations.current('s1')),true,'saves to another system do not matter');
 generations.advance('s1');
 assert.equal(syncReviewIsCurrent(review,generations.current('s1')),false,'a manual edit after Sync makes the review stale');
});

test('a review without a recorded generation is never treated as current',()=>{
 assert.equal(syncReviewIsCurrent({},0),false);
});

test('the stale-review message tells the operator nothing was changed and what to do',()=>{
 assert.match(staleSyncReviewMessage,/discarded without changing anything/);
 assert.match(staleSyncReviewMessage,/Run Sync again/);
});

test('every database write advances the generation and reviews are stamped and checked',()=>{
 // Real writes advance the counter; unchanged writes do not.
 assert.match(page,/if\(!result\.unchanged\)saveGenerations\.advance\(systemId\)/);
 // Loading a different verified database (for example after Commit Session renames published files) also counts.
 assert.match(page,/if\(committedStateHashes\.current\.get\(systemId\)!==stateHash\)saveGenerations\.advance\(systemId\)/);
 // A new review is stamped with the generation it was built from.
 assert.match(page,/review=\{baseSaveGeneration:saveGenerations\.current\(sourceSystem\.id\),/);
 // Applying checks first, before any file or database action.
 assert.match(page,/if\(!pendingSync\)return;if\(!syncReviewIsCurrent\(pendingSync,saveGenerations\.current\(pendingSync\.systemId\)\)\)/);
 // The remaining review after a partial apply is re-stamped after its own save.
 assert.match(page,/remainingSync=remainingReviewCount\?\{\.\.\.pendingSync,baseSaveGeneration:saveGenerations\.current\(pendingSync\.systemId\),/);
});
