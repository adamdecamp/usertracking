/**
 * Evidence that needs correction stays in its organization folder with
 * "REWORK_" at the start of its filename instead of moving to a Rework folder.
 * Sync reads a marked file under its unmarked name, so the marker is dropped
 * as soon as that name passes every storage rule. Legacy "<ORG> Rework"
 * folders are left untouched for operators and are no longer scanned.
 */
export const reworkMarker='REWORK_';
const markerPattern=/^REWORK[_ -]/i;
const basename=(value:string)=>value.replaceAll('\\','/').split('/').pop()??'';

/** True when the file name (or the last segment of a path) starts with the REWORK marker. */
export function hasReworkMarker(filenameOrPath:string){const name=basename(filenameOrPath).trimStart();return name.length>reworkMarker.length&&markerPattern.test(name)}

/** The name Sync validates: every leading REWORK marker removed. */
export function withoutReworkMarker(filename:string){let name=filename;while(hasReworkMarker(name))name=name.trimStart().slice(reworkMarker.length).trimStart();return name}

/** Adds the marker once, shortening the stem so the name stays within the filename limit. */
export function withReworkMarker(filename:string,limit=180){
 if(hasReworkMarker(filename))return filename;
 const extension=filename.toLowerCase().endsWith('.pdf.zip')?filename.slice(-8):filename.lastIndexOf('.')>0?filename.slice(filename.lastIndexOf('.')):'',stem=filename.slice(0,filename.length-extension.length);
 return `${reworkMarker}${stem.slice(0,Math.max(1,limit-reworkMarker.length-extension.length))}${extension}`;
}
