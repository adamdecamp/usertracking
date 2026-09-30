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
  :'Normalizes recognizable filenames, uses strict final storage rules, and opens PDF content only for new, changed, or moved files while unchanged Rework evidence remains cached.';
}

export function shouldReadPdfForFilenameNormalization(mode:SyncMode,unchanged?:boolean){
 return isLegacyImport(mode)||!unchanged;
}
