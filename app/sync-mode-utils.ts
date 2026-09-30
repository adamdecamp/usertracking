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
  :'Uses strict filenames and the validated Sync index. Only new, changed, or moved files are opened, while unchanged Rework evidence remains cached.';
}
