import './user-guide.css';
/* eslint-disable @next/next/no-img-element -- The small static logo must remain compatible with the portable Vite build. */

const formats=[
 ['General System Access Request','Last_First_(ORG)_GEN_SAAR_DDMMMYYYY'],
 ['Privileged System Access Request','Last_First_(ORG)_PRIV_TYPE_SAAR_DDMMMYYYY'],
 ['DoD Cyber Awareness','Last_First_(ORG)_DoD_Cyber_Cert_DDMMMYYYY'],
 ['User Agreement','Last_First_(ORG)_User_Agreement_DDMMMYYYY'],
 ['8140 Certification Memo','Last_First_(ORG)_8140_Cert_Memo_DDMMMYYYY'],
 ['Privileged User Training','Last_First_(ORG)_PRIV_Training_Cert_DDMMMYYYY'],
 ['DTA Training','Last_First_(ORG)_DTA_Training_DDMMMYYYY'],
];

export default function Guide(){
 return <main className="guide">
  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
  <a href="/">← Return to R.A.P.T.O.R.</a>
  <header><div className="guide-brand"><img src="/raptor-icon.png" alt="R.A.P.T.O.R. raptor claw and verified document logo"/><div><p>Reference</p><h1>R.A.P.T.O.R. User Guide</h1><p>Role-Based Access Personnel Tracking &amp; Oversight Registry</p></div></div></header>
  <nav>{['Getting Started','Systems','Users','Evidence','Sync & Backup','Reconciliation & Exceptions','Exports & Notifications','Archive'].map(item=><a key={item} href={`#${item.toLowerCase().split(' ')[0]}`}>{item}</a>)}</nav>
  <aside><ul><li>Use this guide for routine operation, evidence handling, reporting, and recovery.</li><li>Each signed release also includes a one-page Executive Capability Summary.</li></ul></aside>

  <section id="getting">
   <h2>1. Getting Started</h2>
   <ol>
    <li>Launch R.A.P.T.O.R. If your verified Windows ID has no saved name, enter your full name when prompted.</li>
    <li>Choose <b>Read-Only Access</b> or <b>Full Access</b>.</li>
    <li>Select an information system or choose <b>Map System Folder</b>.</li>
    <li>For Full Access, wait for storage verification and the exclusive editor lock.</li>
    <li>Choose <b>Sync</b>, then select Daily Sync or Legacy Import and the required scope.</li>
    <li>Review proposed record changes, conflicts, Rework items, and cleanup actions.</li>
    <li>Apply verified updates, then choose <b>Commit Session</b> to publish local changes.</li>
    <li>Choose <b>Log Off</b> when finished so pending work completes and the editor lock is released.</li>
   </ol>
   <h3>Access Modes</h3>
   <ul>
    <li><b>Read-Only:</b> Search, filter, review, report, and export without changing records or evidence.</li>
    <li><b>Full Access:</b> Requires verified storage and the single-editor lease.</li>
    <li>Read-Only Access is identified by a persistent banner and gold frame.</li>
    <li>Multiple Read-Only operators may connect; only one Full Access operator may edit at a time.</li>
    <li>If Full Access is already locked, R.A.P.T.O.R. identifies the current editor by full name, Windows ID, workstation, and session start time.</li>
    <li>Open <b>User Administration → Operator Directory</b> to view names and Windows IDs recorded in the selected system&apos;s verified audit history.</li>
   </ul>
   <h3>Dashboard Navigation and Status</h3>
   <ul>
    <li>Routine actions remain in the header: Map, Sync, Clean Up, Commit Session, and Log Off.</li>
    <li>Other actions are grouped under <b>User Administration</b>, <b>Reports &amp; Oversight</b>, and <b>System Tools</b>.</li>
    <li>Only one menu stays open; choosing an option, opening another menu, pressing Escape, or moving focus away closes it.</li>
    <li><b>Local Changes</b> shows whether work is clean, pending, committing, or needs recovery.</li>
    <li><b>Recent Activity</b> shows the last five completed or failed actions for the session.</li>
    <li>Processing panels show the stage, current item, count, percent, and elapsed time for that stage.</li>
    <li>The elapsed timer resets whenever a new action or stage starts.</li>
    <li>Notifications are nonblocking; expand one to read or copy the full detail.</li>
   </ul>
  </section>

  <section id="systems">
   <h2>2. Manage Information Systems</h2>
   <ul>
    <li>Use <b>Manage Systems</b> to add, edit, archive, unarchive, or delete a registration.</li>
    <li>Deleting a registration does not delete its mapped folder, evidence, database, or backups.</li>
    <li>Archiving locks the system and its users while preserving the records.</li>
    <li>Mapping remembers the path for the signed-in Windows user and loads an existing system manifest.</li>
    <li>Remap only when the shared path changes or becomes unavailable.</li>
   </ul>
   <h3>Organization Folders</h3>
   <ul>
    <li>Mapping prepares a top-level <code>Organizations</code> folder.</li>
    <li>Use <b>Manage Organizations</b> to create each organization beneath it.</li>
    <li>The Information System Organization description does not create an evidence folder.</li>
    <li>Each document folder starts with the organization name, such as <code>LM SAAR</code> or <code>LM DoD Cyber Cert</code>.</li>
    <li>Place new files in the organization root and corrected files in its prefixed Rework folder.</li>
   </ul>
  </section>

  <section id="users">
   <h2>3. Add and Update Users</h2>
   <h3>Roles and Requirements</h3>
   <ul>
    <li>User roles are <b>General</b> and <b>Privileged</b>.</li>
    <li>DTA is a Privileged User Type, not a separate role.</li>
    <li>All users require a SAAR, DoD Cyber Cert, and User Agreement.</li>
    <li>Privileged users require Privileged User Training.</li>
    <li>Non-DTA privileged types require an 8140 Certification Memo.</li>
    <li>DTA-only users require DTA Training and show 8140 Memo as N/A.</li>
    <li>SAAR status is <b>Present</b> or <b>Missing</b>; SAARs never expire.</li>
    <li>Annual evidence becomes Due Within 30 Days, then Overdue, and remains Overdue until replaced.</li>
   </ul>
   <h3>Add a User</h3>
   <ol>
    <li>Choose <b>Add User</b> in the User Directory.</li>
    <li>Drag in a completed SAAR or choose <b>Browse Files</b>.</li>
    <li>Review the detected name, Storage Organization, Official Email, role, and Privileged User Type.</li>
    <li>Add available supporting evidence as a PDF or a ZIP containing exactly one PDF.</li>
    <li>If supporting evidence is unavailable, document the missing items and continue; each item remains marked Missing.</li>
    <li>The SAAR cannot be omitted during manual user creation.</li>
    <li>Submit the record; accepted PDFs are compressed and stored in the correct organization folder.</li>
   </ol>
   <h3>SAAR Data Recovery</h3>
   <ul>
    <li>Filename identity and organization take priority.</li>
    <li>Supported fillable DD2875 or derived-SAAR fields provide fallback identity and organization.</li>
    <li>Official Email comes from the labeled form field or the first valid address after the Official Email label.</li>
    <li>Manual Add User permits a valid email entry when the form email is missing.</li>
    <li>Image-only scanned or unreadable SAARs cannot create users automatically.</li>
    <li>Designation of Person maps Military to MIL, Civilian to CIV, and Contractor to CTR.</li>
   </ul>
   <h3>Privileged Accounts</h3>
   <ul>
    <li>Use <code>username_type</code>, such as <code>jsmith_dev</code> or <code>jsmith_dta</code>.</li>
    <li>Separate multiple privileged accounts with commas.</li>
    <li>Types are case-insensitive and stored consistently, so <code>_DEV</code> and <code>_dev</code> are the same.</li>
    <li>A verified PRIV SAAR may elevate the role even when supporting evidence is missing.</li>
    <li>Missing supporting evidence remains visible and notification-ready.</li>
   </ul>
   <h3>Edit, Disable, Re-Enable, or Delete</h3>
   <ul>
    <li>Open a User Record and choose <b>Edit User Information</b> to correct name, organization, middle initial, or Official Email.</li>
    <li>Name or organization changes relabel and move active evidence without overwriting collisions.</li>
    <li>Disable normally requires an updated SAAR; a documented justification may override the upload.</li>
    <li>Disabling preserves supporting-document status and archives associated evidence.</li>
    <li>A newer active SAAR may propose reactivation, but an operator must approve it.</li>
    <li>Manual re-enable restores the newest disabled SAAR when no replacement SAAR is supplied.</li>
    <li>Deleting a user requires a written justification and confirmation.</li>
    <li>Missing files are logged but do not block an authorized disable or delete.</li>
   </ul>
   <h3>User Directory</h3>
   <ul>
    <li>Search by name, email, Storage Organization, Affiliated Organization, contractor, privileged account, or type.</li>
    <li>Filter by system, organization, status, role, privileged type, email, SAAR, artifact, and compliance.</li>
    <li>Select <b>SAAR Missing</b> to isolate records without a SAAR.</li>
    <li>The Privileged User Type filter and column hide when General is selected.</li>
    <li>Use <b>Reset Filters</b> to restore the defaults.</li>
    <li>Choose 20, 40, 50, or 100 rows per page from the controls above or below the table.</li>
   </ul>
  </section>

  <section id="evidence">
   <h2>4. Filename Rules</h2>
   <ul>
    <li>Use <b>Last Name</b>, then <b>First Name</b>, then organization, document type, and date.</li>
    <li>The required stored date format is <b>DDMMMYYYY</b>, such as <b>24AUG2026</b>.</li>
    <li>Matching is case-insensitive.</li>
    <li>Sync tolerates underscores, commas, ordinary spaces, and extra separators when the meaning is unambiguous.</li>
    <li>Recognized alternative dates are normalized to DDMMMYYYY.</li>
    <li>The immediate organization folder is authoritative and replaces an incorrect filename organization.</li>
    <li>Files must pass the complete filename gate before entering a managed document folder.</li>
   </ul>
   <div className="formats">{formats.map(([label,format])=><div key={label}><span>{label}</span><code>{format}</code></div>)}</div>
   <h3>Accepted Evidence</h3>
   <ul>
    <li>Accepted formats are PDF and ZIP containing exactly one PDF.</li>
    <li>Direct PDFs are compressed after validation.</li>
    <li>Valid one-PDF ZIPs are not zipped again.</li>
    <li>Encrypted PDFs are accepted only when the complete filename independently passes every required field.</li>
    <li>Mixed ZIPs, encrypted ZIPs, multiple-document ZIPs, unsafe paths, oversized files, and non-PDF content are rejected.</li>
   </ul>
   <h3>Automatic Normalization</h3>
   <ul>
    <li>Filename normalization runs during Sync; there is no separate Document Renamer button.</li>
    <li>Canonical unchanged files stay on the metadata-only fast path.</li>
    <li>New, changed, loose, or corrected Rework PDFs receive full applicable validation.</li>
    <li>Cyber Awareness and Awareness Challenge normalize to <code>DoD_Cyber_Cert</code>.</li>
    <li>General, Privileged, and combined agreements normalize to <code>User_Agreement</code>.</li>
    <li>8140 and legacy 8570 indicators route to the 8140 Certification Memo folder.</li>
    <li>Responsibilities or Course indicators route to Privileged User Training or DTA Training as applicable.</li>
    <li>Ambiguous, unidentified, incomplete, or invalid active files go to Rework.</li>
    <li>Archive trees are historical and excluded from automatic renaming.</li>
   </ul>
   <h3>Unarchive for Correction</h3>
   <ul>
    <li>Choose <b>Unarchive Evidence</b> under User Administration.</li>
    <li>Select a folder or individual ZIP files.</li>
    <li>Review 20 results at a time and select the page or all discovered files.</li>
    <li>Extraction never overwrites an existing PDF.</li>
    <li>The source ZIP remains until the extracted PDF passes SHA-256 verification.</li>
   </ul>
  </section>

  <section id="sync">
   <h2>5. Shared-Folder Sync, Audit Logs, and Backups</h2>
   <h3>Choose the Correct Sync</h3>
   <ul>
    <li><b>Daily Sync:</b> Fast routine processing for organization-root intake files and Rework.</li>
    <li><b>Legacy Import:</b> Historical recovery for unmanaged or inconsistently named repositories.</li>
    <li><b>Targeted Sync:</b> Processes one immediate organization folder.</li>
    <li><b>Full System Sync:</b> Processes every organization in the selected system.</li>
    <li><b>Full Rescan:</b> Ignores cached validation and inspects all active in-scope evidence.</li>
    <li>Document-type subfolders cannot be selected as independent Sync scopes.</li>
   </ul>
   <h3>Sync Behavior</h3>
   <ul>
    <li>New SAARs create users before supporting evidence is matched.</li>
    <li>Same-year supporting evidence may create a user with SAAR marked Missing.</li>
    <li>The newest valid file date controls each user requirement.</li>
    <li>Duplicates, collisions, and conflicts are review items and do not stop unrelated work.</li>
    <li>Stop Sync discards uncommitted scan results while retaining safe recovery checkpoints.</li>
    <li>Failed individual files are logged while the remaining files continue.</li>
    <li>Deferred cleanup remains available from <b>Clean Up</b> after Sync Review closes.</li>
    <li>You may start another Sync without logging off or clearing earlier review results.</li>
   </ul>
   <h3>Local-First Session</h3>
   <ul>
    <li>R.A.P.T.O.R. uses a Windows-user-protected local workspace for responsive editing.</li>
    <li>Changes remain local until <b>Commit Session</b> publishes them to the shared system.</li>
    <li>Only changed files and changed organization data are published.</li>
    <li>Successful files move to the local Complete area for manual review; nothing is deleted automatically.</li>
    <li>Files in Complete are final local copies and are never resubmitted; only Pending Upload, the organization root, or Rework can supply new evidence.</li>
    <li>A clean manual commit prevents a redundant shutdown commit.</li>
    <li>Network retry, journaling, checksums, and resumable operations protect slow or interrupted shares.</li>
   </ul>
   <h3>Audit and Error Records</h3>
   <ul>
    <li>Consequential actions are written to <code>System/Audit Logs</code>.</li>
    <li>Audit entries use ISO 8601 UTC time, the operator&apos;s full name and verified Windows ID, sequence, previous hash, and entry hash.</li>
    <li>Viewing, searching, filtering, and theme changes are not audited.</li>
    <li>Operational failures append to one daily text report under <code>System/Error Reports</code>.</li>
    <li>Use <b>View Audit Log</b> to verify the chain and review entries.</li>
    <li>Use <b>Export Independent Audit Receipt</b> to preserve the verified chain head outside the system folder.</li>
   </ul>
   <h3>Backups and Recovery</h3>
   <ul>
    <li>The app maintains checksum-protected daily snapshots under <code>System/backup</code>.</li>
    <li>Use <b>Restore Backup</b> to verify and restore a selected snapshot.</li>
    <li>A restore backs up the current database first and never deletes evidence files.</li>
    <li>The Recovery Center offers reconnect, remap, verify, refresh, restore, retry, or safe logoff.</li>
    <li>Storage-integrity errors may restrict editing, but recovery actions remain available.</li>
    <li>Idle shutdown begins only after active processing finishes.</li>
   </ul>
  </section>

  <section id="reconciliation">
   <h2>6. Reconciliation and Temporary Exceptions</h2>
   <h3>Reconciliation</h3>
   <ul>
    <li>Reconciliation compares database-recorded active evidence with current active locations.</li>
    <li>It reports collisions, duplicate identities or emails, changed hashes, organization conflicts, and contradictory account states.</li>
    <li>It ignores unrecorded evidence and files in Archive or Rework.</li>
    <li>Missing requirements remain in normal reporting and are not Reconciliation issues.</li>
    <li>Reconciliation is read-only and never moves files or changes records.</li>
    <li>Choose <b>Generate PDF Report</b> for a correction reference stored under <code>System/Reports</code>.</li>
   </ul>
   <h3>Temporary Exceptions</h3>
   <ul>
    <li>Open a User Record and choose the requirement, approving official, justification, and expiration date.</li>
    <li>The underlying Missing or Overdue status remains visible.</li>
    <li>Active exceptions appear in the directory, reports, and CSV exports.</li>
    <li>Active exceptions are excluded from notification drafts.</li>
    <li>Expired exceptions stop applying but remain in history.</li>
   </ul>
  </section>

  <section id="exports">
   <h2>7. Reports, Exports, and Notification Messages</h2>
   <h3>Compliance Snapshot</h3>
   <ul>
    <li>Select mapped systems, organizations, and the reporting date.</li>
    <li>Disabled users are excluded.</li>
    <li>The PDF includes report identity, UTC time, operator, versions, scope, totals, aging, exceptions, and required breakdowns.</li>
    <li>A checksum-protected copy is stored under <code>System/Reports</code>.</li>
   </ul>
   <h3>CSV Export</h3>
   <ul>
    <li>Set User Directory filters first.</li>
    <li>Choose <b>Export CSV</b> beside Add User.</li>
    <li>The export contains the complete filtered result, not only the visible page.</li>
    <li>Use <b>Reset Filters</b> before exporting all users in the selected system.</li>
   </ul>
   <h3>Organization Snapshot</h3>
   <ul>
    <li>Select one organization and enter its ISSO email.</li>
    <li>Include disabled users in the snapshot.</li>
    <li>Use passphrase encryption for transport outside the protected shared folder.</li>
    <li>Send the passphrase separately.</li>
    <li>The recipient opens the snapshot in the standalone R.A.P.T.O.R. executable without main-share access.</li>
   </ul>
   <h3>Outlook Notifications</h3>
   <ol>
    <li>Open one User Record or select Missing, Due Within 30 Days, or Overdue from the dashboard.</li>
    <li>Select one system, organization, and artifact type.</li>
    <li>Review recipients and exclusions.</li>
    <li>Open each Outlook batch and review it before sending.</li>
   </ol>
   <ul>
    <li>Recipients are placed in BCC for bulk drafts.</li>
    <li>The subject includes the information system name.</li>
    <li>SAAR appears only in Missing notifications because it does not expire.</li>
    <li>User Agreement notices attach the approved User Agreement template.</li>
    <li>8140 notices attach the newest approved 8140 Qualification Memo template.</li>
    <li>DoD Cyber and Privileged User Training notices include their official training links.</li>
    <li>The required filename and rejection warning are highlighted in yellow.</li>
    <li>Messages explain the annual revalidation requirement and show a filename example.</li>
    <li>Messages use the Sir/Ma&apos;am salutation and never request credentials.</li>
    <li>Draft attempts are recorded in the User Record and clear when the evidence is updated.</li>
    <li>R.A.P.T.O.R. prepares drafts but never sends email automatically.</li>
   </ul>
  </section>

  <section id="archive">
   <h2>8. Review Archived Records</h2>
   <ul>
    <li>Archived systems and users remain locked, read-only history.</li>
    <li>Unarchive a system to restore normal editing.</li>
    <li>SAAR history is retained permanently in the organization SAAR Archive.</li>
    <li>Other archived evidence follows the configured five-year retention workflow.</li>
    <li>Use <b>Release Health</b> to verify the database checksum, newest backup, and complete audit chain.</li>
    <li>Release Health can download an integrity record for independent retention.</li>
   </ul>
  </section>
  <footer>R.A.P.T.O.R. is an administrative evidence-management tool. Operators remain responsible for source-document accuracy, approvals, access decisions, and records policy.</footer>
 </main>;
}
