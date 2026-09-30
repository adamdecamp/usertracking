import test from 'node:test';
import assert from 'node:assert/strict';
import {isLegacyImport,syncModeDescription,syncModeLabel} from '../app/sync-mode-utils.ts';

test('Daily Sync is the strict fast path',()=>{
 assert.equal(isLegacyImport('daily'),false);
 assert.equal(syncModeLabel('daily'),'Daily Sync');
 assert.match(syncModeDescription('daily'),/Only new, changed, or moved files are opened/);
});

test('Legacy Import explicitly enables historical recovery',()=>{
 assert.equal(isLegacyImport('legacy'),true);
 assert.equal(syncModeLabel('legacy'),'Legacy Import');
 assert.match(syncModeDescription('legacy'),/tolerant filename normalization/);
});
