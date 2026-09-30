import test from 'node:test';
import assert from 'node:assert/strict';
import {isLegacyImport,shouldReadPdfForFilenameNormalization,syncModeDescription,syncModeLabel} from '../app/sync-mode-utils.ts';

test('Daily Sync is the strict fast path',()=>{
 assert.equal(isLegacyImport('daily'),false);
 assert.equal(syncModeLabel('daily'),'Daily Sync');
 assert.match(syncModeDescription('daily'),/Normalizes recognizable filenames/);
 assert.equal(shouldReadPdfForFilenameNormalization('daily',false),true);
 assert.equal(shouldReadPdfForFilenameNormalization('daily',true),false);
});

test('Legacy Import explicitly enables historical recovery',()=>{
 assert.equal(isLegacyImport('legacy'),true);
 assert.equal(syncModeLabel('legacy'),'Legacy Import');
 assert.match(syncModeDescription('legacy'),/tolerant filename normalization/);
 assert.equal(shouldReadPdfForFilenameNormalization('legacy',true),true);
});
