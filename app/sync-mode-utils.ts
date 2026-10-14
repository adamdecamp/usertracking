export type SyncMode='daily'|'legacy';

export function isLegacyImport(mode:SyncMode){
 return mode==='legacy';
}

export function syncModeLabel(mode:SyncMode){
 return isLegacyImport(mode)?'Legacy Import':'Daily Sync';
}

export function syncModeDescription(mode:SyncMode){
 return isLegacyImport(mode)
  ?'Recovers historical evidence through tolerant filename normalization, bounded PDF field extraction, Rework revalidation, and supporting-evidence-only user proposals.'
  :'Scans only each selected organization’s Incoming and Rework folders, then normalizes and files new or corrected evidence using strict final storage rules.';
}

export function shouldReadPdfForFilenameNormalization(mode:SyncMode,unchanged?:boolean){
 return isLegacyImport(mode)||!unchanged;
}
