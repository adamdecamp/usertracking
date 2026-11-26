type RenamedEvidence={encryptedPdf?:boolean;unchanged?:boolean};

/**
 * True when Sync must scan the folder again to verify files it just renamed or moved.
 * The rename or move itself already checked the contents by SHA-256, and these files passed the full
 * content check under their old name, so accepted files keep their results without a second scan.
 * Two cases still need the scan because their result can depend on the new name or folder:
 * an encrypted PDF (its acceptance depends on the filename gate) and a file the first scan rejected.
 */
export function renamedEvidenceNeedsRescan(renamed:readonly RenamedEvidence[],evidence:readonly RenamedEvidence[]){
 const accepted=new Set(evidence);
 return renamed.some(item=>item.encryptedPdf||!accepted.has(item));
}

/**
 * Keeps the first scan after renames instead of scanning again.
 * The renamed items already carry their new path, so this marks them as new or changed (as a second
 * scan would, since the new path is not in the Sync index) and drops rejections recorded at the old paths.
 */
export function keepScanAfterRenames<R extends {path?:string}>(scan:{rejected:R[]},renamed:readonly RenamedEvidence[],replacedPaths:ReadonlySet<string>,pathKey:(path:string)=>string){
 for(const item of renamed)item.unchanged=false;
 scan.rejected=scan.rejected.filter(item=>!item.path||!replacedPaths.has(pathKey(item.path)));
}
