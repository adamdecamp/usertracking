import {readFileSync} from 'node:fs';

/** app/page.tsx and the storage modules split out of it, which structural tests read as one source. */
export const pageSourceFiles=['../app/page.tsx','../app/storage-session.ts','../app/system-storage.ts','../app/evidence-storage.ts'] as const;

export function readPageSource(){return pageSourceFiles.map(file=>readFileSync(new URL(file,import.meta.url),'utf8')).join('\n')}
