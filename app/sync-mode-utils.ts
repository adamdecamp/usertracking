export type SyncMode='daily'|'legacy';

export function isLegacyImport(mode:SyncMode){
 return mode==='legacy';
}

export function syncModeLabel(mode:SyncMode){
 return isLegacyImport(mode)?'Legacy Import':'Daily Sync';
}

export function syncModeDescription(mode:SyncMode){
 return isLegacyImport(mode)
  ?'Recovers local historical evidence through tolerant filename normalization, bounded PDF field extraction, Rework revalidation, and supporting-evidence-only user proposals. Select Full Rescan to include network folders.'
  :'Scans loose evidence directly in each selected local organization folder plus its Rework folder, then normalizes and files new or corrected evidence using strict final storage rules. Network folders require explicit Full Rescan.';
}

export function shouldReadPdfForFilenameNormalization(mode:SyncMode,unchanged?:boolean){
 return isLegacyImport(mode)||!unchanged;
}
