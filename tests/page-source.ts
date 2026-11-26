import {readFileSync} from 'node:fs';

/** app/page.tsx and the modules and pop-up windows split out of it, which structural tests read as one source. */
export const pageSourceFiles=[
 '../app/page.tsx',
 '../app/storage-session.ts','../app/system-storage.ts','../app/evidence-storage.ts',
 '../app/page-helpers.ts','../app/renamer-analysis.ts','../app/report-presets.ts',
 '../app/components/CleanupPagination.tsx','../app/components/SyncReview.tsx','../app/components/DocumentRenamerModal.tsx','../app/components/SystemsModal.tsx',
 '../app/components/EvidenceUnarchiveModal.tsx','../app/components/AddUser.tsx','../app/components/UserModal.tsx','../app/components/MessageAutomation.tsx','../app/components/ComplianceReportModal.tsx',
] as const;

export function readPageSource(){return pageSourceFiles.map(file=>readFileSync(new URL(file,import.meta.url),'utf8')).join('\n')}
