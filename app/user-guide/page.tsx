import "./user-guide.css";

const formats = [
  ["General System Access Request", "Last_First_(ORG)_GEN_SAAR_DDMMMYYYY"],
  [
    "Privileged System Access Request",
    "Last_First_(ORG)_PRIV_TYPE_SAAR_DDMMMYYYY",
  ],
  ["DoD Cyber Awareness", "Last_First_(ORG)_DoD_Cyber_Cert_DDMMMYYYY"],
  ["User Agreement", "Last_First_(ORG)_User_Agreement_DDMMMYYYY"],
  ["8140 Certification Memo", "Last_First_(ORG)_8140_Cert_Memo_DDMMMYYYY"],
  ["Privileged User Training", "Last_First_(ORG)_PRIV_Training_Cert_DDMMMYYYY"],
  ["DTA Training", "Last_First_(ORG)_DTA_Training_Cert_DDMMMYYYY"],
];

export default function Guide() {
  return (
    <main className="guide">
      {/* Plain anchor keeps the same guide compatible with the portable Vite build. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/">← Return to the Tracker</a>
      <header>
        <p>Reference</p>
        <h1>User Guide</h1>
      </header>
      <nav>
        {[
          "Getting Started",
          "Systems",
          "Users",
          "Evidence",
          "Sync & Backup",
          "Reconciliation & Exceptions",
          "Exports & Notifications",
          "Archive",
        ].map((x) => (
          <a key={x} href={`#${x.toLowerCase().split(" ")[0]}`}>
            {x}
          </a>
        ))}
      </nav>
      <aside>
        Every validation build and signed public release includes a freshly
        generated, one-page <b>Executive Capability Summary</b> PDF beside the
        Windows executable and checksum file. It describes mission value,
        operational capabilities, audit readiness, secure deployment, and the
        tool&apos;s administrative scope.
      </aside>
      <section id="getting">
        <h2>1. Getting Started</h2>
        <ol>
          <li>Open the tracker in Chrome or Edge.</li>
          <li>
            Add a new information system, or choose <b>Map System Folder</b> to
            load an existing one.
          </li>
          <li>
            Map that system&apos;s shared folder and approve folder access. Sync
            starts automatically after mapping.
          </li>
          <li>
            Review Sync Review and the Current, Missing, and Overdue totals. On
            later portable-app launches, the last active mapped system is
            restored and synced automatically. Selecting another mapped system
            also syncs that system automatically.
          </li>
          <li>
            Choose <b>Stop Sync</b> while a scan is running if you need to
            cancel it. Cancelled scan results are discarded and no partial
            database update is applied.
          </li>
          <li>
            You may close Sync Review or apply verified updates without running
            cleanup. Deferred and failed actions remain available under the
            correct system&apos;s main <b>Clean Up</b> button until completed or
            replaced by a later Sync of that system.
          </li>
          <li>
            Click the Missing or Overdue total to filter affected users and
            prepare notifications.
          </li>
          <li>
            Choose <b>View Audit Log</b> to verify and review the selected
            system&apos;s read-only audit entries.
          </li>
          <li>
            When finished, choose <b>Log Off</b>. The tracker completes its
            final backup, records the logoff, releases the shared-folder lock,
            and terminates the portable Windows application.
          </li>
        </ol>
        <aside>
          Folder Sync is the primary way to create and update records. Manual
          Add User remains available only as a fallback. Every release opens
          without bundled systems or users. The portable launcher remembers only
          each mapped folder path in the signed-in Windows user&apos;s Local
          AppData. On the next launch it revalidates those paths, reloads
          operational records from the shared folders, reacquires the selected
          system&apos;s lock, and starts Sync. User records are not copied into
          browser storage or the mapping cache.
        </aside>
      </section>
      <section id="systems">
        <h2>2. Manage Information Systems</h2>
        <p>
          Use <b>Manage Systems</b> to add a system, set its type and
          organization, map its shared folder, archive it, or unarchive it.
          Every system folder contains only that system&apos;s users, evidence,
          manifest, audit logs, and backups. The portable app remembers valid
          mappings for the current Windows account, so normally each folder is
          selected only once per computer. Remap a system if its shared path
          changes or becomes unavailable. Archiving locks the system and its
          users while preserving all records.
        </p>
      </section>
      <section id="users">
        <h2>3. Add and Update Users</h2>
        <p>
          Map the selected system&apos;s shared folder and choose{" "}
          <b>Add User</b> in the User Directory header. <b>General</b> and{" "}
          <b>Privileged</b> are the only user roles. DTA is a Privileged User
          Type, not a separate role.
        </p>
        <h3>Upload and Store New-User Evidence</h3>
        <ol>
          <li>
            Start by dragging the completed SAAR onto its upload area or choose{" "}
            <b>Browse Files</b> to select it in Windows File Explorer. The app
            reads Last Name, First Name, and Organization from the filename
            first. When those values are unavailable or still use template
            placeholders, it reads them from supported fillable DD2875 XFA or
            derived-SAAR AcroForm fields instead. Middle Initial and Official
            Email are read from the fillable form when available. If the
            form&apos;s stored Official Email value is blank or invalid, the app
            searches selectable PDF text immediately after the{" "}
            <b>Official Email</b> label for a valid address. It does not use
            unrelated sponsor, supervisor, or security-manager email addresses.
          </li>
          <li>
            Review and correct the prepopulated identity, organization, Official
            Email, and role. For manual Add User only, a valid Official Email
            can be entered when both the fillable field and labeled-text
            fallback are blank or invalid. Image-only scanned or unreadable
            SAARs remain prohibited.
          </li>
          <li>
            For a Privileged account, enter the full account name as{" "}
            <code>username_type</code>. The tracker derives the Privileged User
            Type from everything after the final underscore. Separate multiple
            accounts with commas—for example,{" "}
            <code>jsmith_admin, jsmith_dta</code>. A <code>_dta</code> suffix
            keeps the user&apos;s role as Privileged and adds DTA as a
            Privileged User Type.
          </li>
          <li>
            Drag and drop or browse for either a readable PDF or a ZIP
            containing exactly one readable PDF for every displayed evidence
            requirement. Other file types, mixed-content ZIPs, and
            multi-document ZIPs are rejected.
          </li>
          <li>
            Choose <b>Add User</b>. A direct PDF is compressed into its own ZIP
            before storage; an already valid one-PDF ZIP is stored without
            another compression layer.
          </li>
          <li>
            The files are saved under{" "}
            <code>User Evidence / Organization / Last_First</code> inside that
            information system&apos;s mapped shared folder.
          </li>
        </ol>
        <aside>
          Each ZIP retains the evidence filename, including its artifact
          keywords and date. Missing and Overdue validation therefore continues
          to work against the stored ZIP filename.
        </aside>
        <p>
          The User Directory can be searched by privileged username and filtered
          by Active, Disabled, or All users; General or Privileged role; derived
          Privileged User Type; organization; artifact; and compliance status.
          When General is selected, the inapplicable Privileged User Type filter
          and column are hidden. Choose{" "}
          <b>Reset Filters</b> to clear the search and restore every directory
          filter to its default. The directory displays Privileged User Type but
          keeps the full privileged username inside the User Record and CSV
          exports. The directory displays only document categories required by
          every user currently shown. Every user requires one consolidated User
          Agreement. All Privileged users additionally require the 8140 memo and
          Privileged User Training certificate. Privileged users with DTA type
          also require DTA training. Open a User Record to replace evidence,
          disable or enable access, or modify privileges. Access and privilege
          changes require an updated SAAR by default. Disabling a user moves the
          user&apos;s prior active evidence into the organization Archive folder. When
          disabling without an updated SAAR, an operator may select the documented
          override and must enter a justification. To re-enable a disabled user,
          select that user through the Disabled Users filter and upload a fresh
          SAAR plus every artifact required for the user&apos;s role. Reactivation may
          also use a documented override with a required justification. Overrides,
          comments, and archive results are preserved in the user history and
          tamper-evident audit log. Privilege changes still require an updated SAAR.
          Updated PDF evidence is validated and stored as a ZIP, and newly added
          roles or Privileged User Types require their additional evidence before
          submission.
        </p>
      </section>
      <section id="evidence">
        <h2>4. Filename Rules</h2>
        <p>
          Use the formats below. The filename must begin with the user&apos;s{" "}
          <b>Last Name</b> followed by <b>First Name</b> in that order.
          Underscores remain the recommended separator, but Sync also accepts a
          comma or ordinary spaces between Last and First, missing underscores
          between the other sections, and additional spaces. For example, both{" "}
          <code>Brown_Jacob_(LM)_DoD_Cyber_Cert_26AUG2026.pdf</code> and{" "}
          <code>Brown, Jacob (LM) DoD Cyber Cert 26AUG2026.pdf</code> are
          accepted. When enough metadata is present, Sync renames every
          recognized active evidence file to the complete canonical structure
          shown below. A file accepted as Cyber Awareness evidence is therefore
          stored as <code>Last_First_(ORG)_DoD_Cyber_Cert_DDMMMYYYY.pdf</code>,
          rather than retaining its previous artifact wording. General,
          Privileged, and legacy combined agreement filenames are all stored as
          the single canonical{" "}
          <code>Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf</code> form in
          every active organization folder. The standard date is{" "}
          <b>DDMMMYYYY</b>, such as <b>24AUG2026</b>. Sync also recognizes
          common valid alternatives, including <code>YYYYMMDD</code>,{" "}
          <code>MMDDYYYY</code>, <code>MMMDDYYYY</code>, <code>MMDDYY</code>,
          and separated numeric or month-name dates. It converts a recognized
          nonstandard date in an active evidence filename to DDMMMYYYY before
          matching. When an all-numeric date could be read more than one way,
          Sync uses U.S. month-day order; impossible dates remain invalid and
          are never guessed. For a privileged SAAR, replace <code>_TYPE</code>{" "}
          with the privileged-account suffix—for example, <code>_admin</code>,{" "}
          <code>_DTA</code>, <code>_dev</code>, or <code>_cyber</code>. A
          complete canonical example is{" "}
          <code>Smith_John_(LM)_PRIV_admin_SAAR_24AUG2026.pdf</code>. The first
          value in parentheses becomes the user&apos;s organization—for example,{" "}
          <b>(LM)</b> becomes LM, <b>(GOV)</b> becomes GOV, and <b>(Boeing)</b>{" "}
          becomes Boeing. The validator checks the ordered Last-First identity,
          required artifact key words, and a valid calendar date without
          requiring one exact separator style. For a completed fillable SAAR
          whose filename date is missing, Sync may use the requester-signed date
          from supported DD2875 or derived-SAAR fields; it never uses an
          investigation date or an unrelated official&apos;s date. A DoD Cyber
          certificate must contain the separate <code>DoD</code> token;{" "}
          <code>_cyber</code> in a privileged SAAR is only an account type and
          does not count as the certificate. A SAAR is either Current or Missing
          and never becomes Overdue. Other valid evidence becomes Overdue after
          one year.
        </p>
        <h3>Rename Existing Documents</h3>
        <p>
          After mapping the system folder, choose <b>Document Renamer</b> from
          the main toolbar. It finds loose PDFs whose names do not already match
          tracker rules, reads selectable text and supported SAAR form fields
          locally, and uses the selected system&apos;s User Directory to propose
          Last Name, First Name, document type, and signed or certification
          date. Analysis yields to the interface after each small batch and
          supports administrative migrations of up to 10,000 candidate PDFs in one
          mapped repository. Progress is checkpointed in the mapped folder after
          every completed batch. Choose <b>Pause Analysis</b> or close the window; reopening
          Document Renamer resumes unchanged files from that saved queue.{" "}
          <b>Analyze Again</b> clears the checkpoint and starts a fresh
          analysis. The queue contains proposed metadata only and is excluded
          from Sync evidence scans. The PDF&apos;s authoritative top-level
          organization folder is used as the read-only Organization value in its
          proposed filename; only a PDF at the mapped root uses the mapped
          folder name. High-confidence rows are selected automatically, editable
          fields can be corrected, and every original PDF can be previewed
          before approval. Image-only scans are marked for manual entry.
          Applying a rename changes only the filesystem name, verifies that the
          PDF&apos;s SHA-256 is identical before and after, and writes an audit
          entry. It never rewrites, flattens, signs, or compresses the PDF.
        </p>
        <p>
          Within a User Record, choose <b>Preview &amp; Provenance</b> to open
          the validated embedded PDF without changing it. The preview shows its
          mapped path, filename date, current SHA-256, and the available
          administrative or ingestion history. Manually stored evidence records
          a baseline SHA-256 for later reconciliation.
        </p>
        <div className="formats">
          {formats.map(([label, format]) => (
            <div key={label}>
              <span>{label}</span>
              <code>{format}</code>
            </div>
          ))}
        </div>
      </section>
      <section id="sync">
        <h2>5. Shared-Folder Sync, Audit Logs, and Backups</h2>
        <p>
          <b>Map System Folder</b> opens the native Windows folder selector in
          the foreground and authorizes the selected information system&apos;s
          evidence root. Both mapped drive letters and UNC paths are supported.
          If a network share disconnects, reconnect it under the same Windows
          account and remap when necessary. The launcher retries brief SMB locks
          and write interruptions, uses write-through temporary files, and
          verifies replacement bytes before reporting success. If a replacement
          cannot be verified, the previous file is preserved or restored. If
          that folder already contains a single-system tracker manifest, its
          system and users are loaded before anything is written. <b>Sync</b>{" "}
          reloads that system&apos;s manifest and scans every subfolder. The
          filename parser treats the first recognized identity value as{" "}
          <b>Last Name</b> and the second as <b>First Name</b>, accepting
          underscores, a comma, ordinary spaces, and additional surrounding
          spaces. When multiple valid files match the same user and artifact
          type, the tracker uses the file with the newest normalized filename
          date for compliance status, display, notifications, and exports.
        </p>
        <p>
          The <b>Processing Status</b> panel appears during Sync, verified
          clean-up actions, backup restoration, storage verification, and
          Compliance Snapshot generation. It displays the current phase,
          processed count, exact percentage when a total is known, and the final
          result. Initial folder discovery shows an indeterminate progress bar
          until the launcher knows how many files are present.
        </p>
        <p>
          Large legacy repositories are handled in two stages. Files that already
          contain a complete canonical identity, organization, artifact type, and
          date are matched without opening the PDF. Incomplete training-certificate
          names receive one short first-page classification pass in concurrent
          batches. Sync does not perform a slower deep-read or retry pass. Successful
          batch renames are applied and audited immediately, so stopping or
          restarting Sync does not discard the filename normalization already
          completed. Unresolved files remain available in the resumable
          <b>Document Renamer</b> queue for operator-reviewed migration rather than
          delaying clean-file Sync.
        </p>
        <p>
          Sync accepts direct PDFs and ZIPs containing exactly one PDF. It
          checks actual PDF and ZIP structure instead of trusting the extension.
          For a valid ZIP, Sync reads identity, organization, artifact type, and
          date from the formatted outer <code>.zip</code> or{" "}
          <code>.pdf.zip</code> filename and validates the one embedded PDF for
          readability. Renamed non-PDFs, unreadable PDFs, unsafe archive paths,
          encrypted or unsupported ZIPs, mixed-content archives, multi-document
          archives, files over 100 MB, and suspiciously high ZIP expansion
          ratios are rejected. An active file with any extension other than PDF
          or ZIP is automatically moved to that organization&apos;s Rework folder
          and flagged as <b>Unaccepted File Format</b>. Scanned or flattened SAAR
          copies are not accepted for automatic user discovery because the
          required form fields cannot be verified. When the PDF parser opens a
          file marked SAAR and conclusively finds no fillable AcroForm or XFA
          fields, Sync compresses the copy when necessary and moves it into the
          permanent <code>ORG SAAR Archive</code>. An unreadable or temporarily
          locked PDF is reported and left in place rather than being assumed to
          be flattened. Rejected evidence-like filenames appear in the Sync
          Review with the reason and are never used to populate compliance
          status.
        </p>
        <p>
          Sync automatically renames a recognized nonstandard evidence date to
          DDMMMYYYY in the same active folder and records the change in the
          audit log. At the beginning of every Sync, a lightweight Archive
          preflight checks every active organization folder and Rework folder
          before any PDF content or form-field extraction. A non-SAAR artifact with either a
          full evidence date or a recognizable four-digit year that is safely
          beyond the one-year currency window is moved to that organization&apos;s
          dated Archive folder without correcting its filename; if it is older than five years, it
          moves directly to <code>ORG Archive / Superseded</code>. A SAAR whose
          filename contains the standalone word <b>DISABLED</b> moves into the
          permanent <code>ORG SAAR Archive</code> during this preflight and is
          never attached to or used to create a User Directory profile. No SAAR
          is ever placed in Superseded or selected for deletion. The preflight
          also repairs prior storage mistakes: archived SAARs are recovered into
          the permanent SAAR Archive, and non-SAAR evidence less than five years
          old is moved out of Superseded into a dated Archive folder. Every loose
          PDF already in a dated Archive, Superseded, or permanent SAAR Archive
          is converted to a ZIP containing exactly that one validated PDF. The
          source PDF is removed only after the ZIP is reopened and verified;
          existing ZIP evidence is not recompressed. Other SAARs never expire,
          and current or undated Rework files stay in Rework until their
          filenames are corrected. Any file-level retention error is listed at
          the end of Sync without stopping the remaining files. Other
          After filename normalization, accepted active files are placed into a
          canonical document-type folder inside the authoritative organization,
          including <code>SAAR</code>, <code>User Agreement</code>,{" "}
          <code>DoD Cyber Cert</code>, <code>8140 Certification Memo</code>,{" "}
          <code>Privileged User Training</code>, and <code>DTA Training</code>.
          Archive, SAAR Archive, Rework, and Superseded trees remain separate
          managed locations. Other correction, duplicate, superseded, and
          active loose-PDF actions remain
          operator controlled. When the first Sync discovers
          valid users, choosing <b>Apply Verified Updates</b> ingests those
          records and immediately re-evaluates the evidence already scanned
          against the new User Directory. Any newly eligible duplicate,
          superseded, Rework, or loose-PDF actions open directly in Clean Up, so
          a second Sync is not required. Clean Up opens a compact action menu
          for <b>Rework Corrections</b>, <b>Duplicate or Superseded</b>, and{" "}
          <b>ZIP Loose PDFs</b>. Only the selected action is displayed, 20
          records at a time. Use <b>Previous</b> and <b>Next</b> to move between
          pages, <b>Select All on Page</b> for only the visible 20 records, or{" "}
          <b>Select All Files</b> for every eligible record in that action
          category. PDFs that require correction are moved into an
          organization-named folder inside the authoritative organization
          folder, such as <code>GDMS / GDMS Rework</code>. Duplicate and
          superseded files explicitly approved by the operator are moved into
          that organization&apos;s dated Archive folder, such as{" "}
          <code>GDMS / GDMS Archive / YYYY-MM-DD</code>, for later manual review
          or deletion. Archived SAARs instead move permanently to{" "}
          <code>GDMS / GDMS SAAR Archive</code> and are retained indefinitely. A prior SAAR is eligible as a duplicate only when a newer
          valid SAAR for the same user and organization is already recorded, or
          the operator approves that newer SAAR in the same Sync review. Evidence
          from another organization can never justify archiving the user&apos;s SAAR.
          Only loose PDFs matched to a verified User Directory
          record are eligible for compression. The new ZIP is reopened and
          validated as containing exactly one readable PDF before the original
          PDF is deleted; a creation, validation, or deletion failure leaves no
          incomplete replacement and preserves the original PDF. Organization
          Rework and Archive folders and generated reports are excluded from
          later Sync scans.
        </p>
        <p>
          For an existing user, Sync proposes matching artifact and organization
          updates. A valid SAAR for an identity not yet in the database creates
          a proposed new-user record before supporting evidence is matched. The
          filename is always the primary source for Last Name, First Name, and
          Organization. If those filename values are missing or still contain
          template placeholders, Sync reads the requester name and organization
          from either a standard DD Form 2875 XFA dataset or the derived
          SAAR&apos;s AcroForm fields. Official Email is read from the
          corresponding form field first; if that stored value is blank or
          invalid, Sync searches selectable PDF text immediately after the{" "}
          <b>Official Email</b> label for a valid address while rejecting
          unrelated sponsor, supervisor, or security-manager addresses. A
          successful field fallback immediately renames that SAAR to the
          canonical Last_First_(ORG) structure, rescans it, and uses the
          corrected SAAR as the user-creation seed. Filename role, privileged
          type, SAAR marker, and valid date are still required. Image-only scans
          remain prohibited. A SAAR that fails any admission check is never
          presented as ordinary unmatched evidence; Sync Review lists the exact
          admission failure under <b>New-User SAARs Requiring Correction</b> and
          offers it only for movement to the organization&apos;s Rework folder.
          Return a corrected fillable SAAR to an active evidence folder before
          running Sync again.
        </p>
        <p>
          The Sync Review window displays separate editable Last Name, First
          Name, and Organization fields, the read-only email extracted from the
          form&apos;s Official Email field or labeled selectable text, and the
          role inferred from the filename. A <code>PRIV</code> SAAR creates a
          Privileged role. Its editable Privileged Account Type field is
          prepopulated with the <code>_TYPE</code> suffix, such as{" "}
          <code>_admin</code> or <code>_DTA</code>; DTA remains a Privileged
          User Type. Verify or correct the permitted fields and deselect any
          user or artifact that should not be applied. Only approved matches and
          proposed users are written when you choose{" "}
          <b>Apply Verified Updates</b>. In the manual <b>Add User</b> workflow
          only, the operator may enter a valid <b>Official Email</b> when the
          uploaded SAAR&apos;s email field and labeled-text fallback are blank;
          Sync never substitutes a manually entered value.
        </p>
        <p>
          A correctly named supporting artifact may create a proposed minimal
          user record even when no SAAR exists. Sync reads the ordered{" "}
          <code>Last_First</code> identity, authoritative organization folder,
          document type, and valid date from the filename. The proposed record
          keeps Official Email blank, marks SAAR as Missing, and includes the
          recognized supporting evidence. Evidence that indicates 8140,
          Privileged User Training, or DTA requirements proposes a Privileged
          role; other supporting evidence proposes General. The operator must
          review and approve the record in Sync Review. Files with ambiguous
          identity, invalid dates, conflicting authoritative organization
          folders, or unrecognized document types remain unmatched or are sent
          to Rework and never create a record automatically.
        </p>
        <p>
          In the portable Windows app, the launcher—not the browser tab—performs
          the critical file operations. It atomically writes the manifest, daily
          CSV, timestamped JSON snapshots, SHA-256 files, evidence ZIPs, audit
          entries, reports, and session lease. The browser validates changes and
          sends them to this local-only storage service. This design keeps the
          final disk write and shutdown backup available even if the browser
          window closes unexpectedly.
        </p>
        <p>
          Every portable Sync writes a per-run journal under{" "}
          <code>Sync Journals</code>. Each discovered file advances through
          Pending, Validated or Rejected, Indexed, and Committed states. If the
          launcher, computer, or network share is interrupted, the next Sync
          resumes unchanged completed files from the latest compatible journal
          instead of starting the validation work again. The manifest is not
          considered committed until its verified write succeeds.
        </p>
        <p>
          Rename, compression, Rework, Archive, and manifest replacement use
          recoverable transactions recorded under{" "}
          <code>Storage Transactions</code>. On the next mapping, the launcher
          verifies source and destination hashes and either completes or rolls
          back an interrupted operation before accepting new changes. Operators
          should still review any exception reported after recovery; the app
          does not silently discard the original evidence.
        </p>
        <p>
          The storage-health strip shows <b>Last Saved</b>, <b>Last Backup</b>,
          and <b>Last Sync</b> for the selected system. Green means the manifest
          and backup are current; amber means a save or verification is in
          progress; red means the mapped folder needs attention. Choose{" "}
          <b>Verify Backup</b> to validate the current manifest, newest JSON
          snapshot, and complete audit hash chain. A verification failure does
          not delete or overwrite evidence.
        </p>
        <p>
          Only one portable Windows launcher can modify a mapped system folder
          at a time. While the system is active, the launcher holds{" "}
          <code>tracker-exclusive-session.lock</code> open with an exclusive
          Windows file lock. A second computer is denied write access until the
          first operator switches systems, disconnects, closes the app, or stops
          renewing the lock for three minutes. The file records the operator,
          computer, process, session, and update time for troubleshooting. A
          leftover lock file after a crash is harmless because ownership depends
          on the open Windows handle, not the file&apos;s presence. This
          cross-computer protection requires a Windows or SMB shared folder that
          honors native file locking; browser-only development mode remains
          advisory.
        </p>
        <p>
          After 15 minutes without activity, the operator is disconnected and
          must choose <b>Yes, Reconnect Me</b>. Reconnection succeeds only when
          another operator does not hold the exclusive lock.
        </p>
        <p>
          Each meaningful database state creates a full-fidelity, timestamped
          JSON snapshot in the selected system&apos;s <code>backup</code>{" "}
          folder, alongside the daily CSV report. Every JSON snapshot has a
          matching <code>.sha256</code> file and includes the system, users,
          artifact references, and administrative change histories. Unchanged
          data is not duplicated, at least one snapshot is retained for each
          active day, and the newest 30 snapshots are kept.
        </p>
        <p>
          Use <b>Restore Backup</b> to review available snapshots. The launcher
          verifies both the SHA-256 file and the snapshot&apos;s internal
          content hash before enabling restoration, verifies the selected file
          again immediately before use, and backs up the current database before
          replacing its records. Evidence files are never deleted by a database
          restore.
        </p>
        <p>
          The portable Windows app shuts down after 60 minutes without keyboard,
          pointer, or touch activity, and it also shuts down when its browser
          window is closed. Before either automatic shutdown, the launcher
          verifies or refreshes the mapped systems&apos; JSON backups. The
          browser also refreshes the selected system&apos;s manifest and daily
          CSV, records the shutdown in the audit log, and releases the
          shared-folder session when it remains available. If a pending write or
          final backup fails, shutdown is held so the failure can be corrected
          without discarding changes.
        </p>
        <p>
          Consequential changes—including system administration, user and
          privilege changes, evidence storage, exports, report generation,
          filename-date normalization, and synchronization—are written to one
          UTF-8 JSON Lines text file per UTC day in that system&apos;s{" "}
          <code>Audit Logs</code> folder. Every entry contains an ISO 8601 UTC
          timestamp, the Windows operator, a continuous sequence, the previous
          entry&apos;s SHA-256, and its own SHA-256. The chain continues across
          daily files. Before appending, and whenever storage is verified, the
          launcher checks the entire chain and refuses to extend it if an entry
          was changed, removed, reordered, or inserted. Existing legacy{" "}
          <code>audit-*.txt</code> files remain available but are not part of
          the cryptographic chain. Viewing, searching, filtering, and theme
          changes are excluded.
        </p>
      </section>
      <section id="reconciliation">
        <h2>6. Reconciliation and Temporary Exceptions</h2>
        <h3>Reconcile the Mapped Folder</h3>
        <p>
          Choose <b>Reconciliation</b> for the selected system to compare the
          active evidence folders with its manifest. The read-only results
          identify missing referenced files, evidence whose current SHA-256
          differs from a recorded manual-upload baseline, orphan evidence,
          duplicate identities or email addresses, organization conflicts, and
          rejected evidence. Reconciliation does not move files or change
          records; use the listed path and issue details to correct the source
          data, then run Sync again.
        </p>
        <p>
          Sync itself blocks automatic matching when more than one User
          Directory record has the same Last Name and First Name, when a SAAR
          organization conflicts with the existing record, or when multiple
          new-user SAARs disagree on organization, role, or Privileged User
          Type. The conflict queue lists every affected file or record for
          operator resolution. Before duplicate or superseded cleanup, Sync also
          hashes the embedded PDF bytes and warns when differently named PDF or
          ZIP files contain identical content.
        </p>
        <h3>Record a Temporary Exception</h3>
        <p>
          Open a User Record and use <b>Temporary Exceptions</b> to select a
          required artifact, enter the approving official and justification, and
          choose an expiration date. The underlying Missing or Overdue status
          remains visible. Active exceptions are shown in the directory and
          Compliance Snapshot, included in CSV exports, and excluded from
          notification drafts. Approval and revocation are recorded in the
          tamper-evident audit chain. Expired exceptions stop applying
          automatically and remain in the stored history.
        </p>
      </section>
      <section id="exports">
        <h2>7. Reports, Exports, and Notification Messages</h2>
        <h3>Compliance Snapshot</h3>
        <p>
          Choose <b>Compliance Snapshot</b>, select one or more mapped systems
          and organizations, and set the reporting date. Disabled users are
          always excluded. The PDF contains its report ID, UTC generation time,
          Windows operator, application and rule-set versions, scope,
          active-user and requirement totals, active-exception count, overdue
          aging, and breakdowns by organization, information system, role,
          Privileged User Type, and artifact.
        </p>
        <p>
          The PDF downloads to the computer and a matching copy is written to
          each selected system&apos;s <code>Reports</code> folder with a{" "}
          <code>.sha256</code> file. Report ID, scope, filename, and hash are
          recorded in each system&apos;s audit chain. The report is
          administrative evidence and does not independently establish control
          effectiveness.
        </p>
        <h3>Generate an Inspection Package</h3>
        <p>
          Apply the desired User Directory filters and choose{" "}
          <b>Inspection Package</b>. The app produces one verified ZIP containing
          the Compliance Snapshot PDF, filtered CSV, evidence inventory with
          mapped paths and SHA-256 hashes, audit-chain verification receipt,
          application and rule-set metadata, and active-exceptions CSV. A copy is
          stored in the selected system&apos;s <code>Reports</code> folder with a
          SHA-256 sidecar, the action is added to the audit chain, and the same ZIP
          is downloaded for inspection handoff.
        </p>
        <h3>Export Filtered User Directory Results</h3>
        <p>
          Set the Information System, search text, Organization, Role,
          Privileged User Type, Artifact, and Compliance Status filters in the{" "}
          <b>User Directory</b>, then choose <b>Export CSV</b> beside{" "}
          <b>Add User</b>. The CSV contains only the users and applicable
          requirement rows that match the current directory filters, including
          exact status and active-exception details. Choose <b>Reset Filters</b>{" "}
          to return to the full directory before exporting all results for the
          selected system.
        </p>
        <h3>Prepare Missing, Due-Soon, or Overdue Notifications</h3>
        <ol>
          <li>
            Click the <b>Missing</b>, <b>Due Within 30 Days</b>, or{" "}
            <b>Overdue</b> summary card on the main page. The selected status is
            applied automatically.
          </li>
          <li>Select the information system and organization to contact.</li>
          <li>
            Select exactly one artifact type. The recipient list immediately
            changes to users whose selected artifact has that status. SAAR is
            available for Missing notifications but is not listed for Due Within
            30 Days or Overdue notifications because SAARs do not expire.
          </li>
          <li>
            Review the actionable recipients and users excluded by active
            exceptions. Disabled users and users in archived systems are also
            excluded.
          </li>
          <li>
            Open each numbered Outlook batch. Recipient count and
            encoded-address length are bounded to avoid oversized{" "}
            <code>mailto:</code> links, and every opened batch receives its own
            audit entry in each affected system.
          </li>
          <li>
            Review every Outlook draft, make any required organizational edits,
            and send it manually.
          </li>
        </ol>
        <aside>
          The tracker never sends email automatically. Outlook must be
          configured as the computer&apos;s email handler for each draft button
          to open it.
        </aside>
      </section>
      <section id="archive">
        <h2>8. Review Archived Records</h2>
        <p>
          Archived systems and users remain available as locked, read-only
          history. Unarchive the system to restore normal editing.
        </p>
        <p>
          Choose <b>Release Health</b> to verify the current database, newest
          backup, and complete audit chain and to download a SHA-256 integrity
          record containing the application version, rule-set version, Windows
          operator, mapped folder, verified backup, and audit head hash. The
          checksum is an integrity control, not a digital signature.
        </p>
      </section>
      <aside>
        <b>Incremental Sync:</b> After successful validation, the tracker stores
        a checksum-protected <code>tracker-sync-index.json</code> in each mapped
        system folder. Later Syncs still enumerate active folders to detect
        additions, moves, and deletions, but skip reopening evidence when its
        path, name, size, last-modified UTC value, and rule-set version are
        unchanged. The shared index accelerates another computer using the same
        mapped folder. New or changed files always receive full PDF or ZIP
        validation. Filename tokens, dates, identities, and organizations are
        cached during large runs instead of being reparsed for every rule.
        Filename corrections use the evolving in-memory catalog and, when any
        rename occurs, one final incremental verification pass replaces multiple
        full rescans. Choose <b>Full Rescan</b> to ignore the index and validate
        every active evidence file; a missing, damaged, or outdated index also
        causes safe full validation automatically. Processing Status reports
        unchanged evidence skipped, new or changed evidence validated, and
        non-evidence files ignored.
      </aside>
      <aside>
        <b>Mapped-Folder Compatibility:</b> The portable launcher uses broadly
        compatible buffered file operations and tests create, write, read, and
        delete access before retaining a new mapping. It keeps exclusive
        locking, verified replacement with rollback, and SHA-256 verification
        without requesting filesystem write-through options. Sync avoids
        unnecessary metadata requests for irrelevant file types and treats
        unreadable PDF or ZIP metadata and file-level normalization failures as
        reviewable errors instead of aborting the whole scan. It tries standard
        and legacy-compatible managed enumeration, then native Windows
        enumeration, and finally the Windows Explorer namespace used by File
        Explorer when a file provider rejects the lower-level search operations.
        Explorer-classified ZIP folders remain evidence files. If every method
        fails, the error identifies the exact folder and enumeration stage. This
        update ignores the earlier development mapping-cache format once; after
        one remap, the selected folders are remembered normally.
      </aside>
      <aside>
        <b>Organization From Folder:</b> During Sync, the top-level organization
        folder is authoritative; nested category and <code>Last_First</code>{" "}
        folders do not replace it. If files are directly inside the mapped
        folder, the selected folder&apos;s actual Windows name is used—not the
        Information System name or its stored organization value. A file in a
        mapped folder named <code>NGC</code> is therefore renamed to contain{" "}
        <code>(NGC)</code>. For files stored under{" "}
        <code>User Evidence / Organization / Last_First</code>, the Organization
        folder is used rather than the Last_First folder. Every active PDF and
        one-PDF ZIP is evaluated for organization correction, including files
        whose other filename sections are imperfect and files whose contents
        were safely skipped by the incremental validation index. When ordered
        Last-First identity text is present, an existing or missing
        parenthesized organization is replaced with the authoritative folder
        name before matching. Sync combines organization and date normalization
        when possible, performs each verified rename without changing file
        bytes, and verifies the completed batch in one final incremental pass.
        If one file cannot be renamed or read, Sync records its bounded error in
        the audit batch, continues through every remaining organization and
        file, and lists the failure in Sync Review when processing finishes. If
        the normalized filename already exists, neither file is overwritten or
        deleted; Sync continues, prefers the already normalized file for
        matching, and offers the other eligible copy under <b>Clean Up</b> for
        movement into that organization&apos;s Archive folder.
      </aside>
      <aside>
        <b>New-User Ingestion:</b> A validated General or Privileged SAAR is
        processed as the seed record before supporting evidence is matched. In
        addition to the preferred separated names, Sync tolerates omitted
        separators inside recognized markers such as <code>GENSAAR</code>,{" "}
        <code>PRIVadminSAAR</code>, <code>DoDCyberCert</code>, and{" "}
        <code>GENUserAgreement</code>. After the operator approves the proposed
        user, supporting files with the same ordered Last-First identity are
        attached in the same update.
      </aside>
      <aside>
        <b>Training Certificate Date Recovery:</b> Sync recognizes filenames
        containing Cyber Awareness, Awareness Challenge, Privileged User
        Training, Privileged Access Training, or Privileged User Cybersecurity
        Responsibilities. A certificate whose filename already contains a usable
        ordered Last-First identity, parenthesized organization, recognized
        artifact wording, and complete valid date is handled entirely from the
        filename and is never opened for certificate-text recovery. Document
        title pairs such as <b>Cyber Awareness</b>, <b>Awareness Challenge</b>,
        and <b>DoD Cyber</b> are never accepted as a person&apos;s Last-First
        identity. A direct PDF or one-PDF ZIP with a generic title is opened to
        recover a labeled learner, recipient, participant, candidate, employee,
        student, or user name from the certificate itself. Valid alternate dates
        are normalized later without reading PDF text. Evidence with missing or
        incomplete filename metadata receives one short first-page attempt to
        recover its user and labeled completion, certification, certificate, or
        issue date. Sync does not run the previous deep four-page recovery or retry
        phase.
        Recovery matches against both existing
        User Directory records and identities established by validated new-user
        SAARs found earlier in the same Sync. A high-confidence match is renamed
        to the canonical DoD Cyber or Privileged User Training filename with
        DDMMMYYYY and the authoritative organization folder. The app never
        invents a missing month or day. Ambiguous, timed-out, or image-only
        certificates remain available in Document Renamer for operator review and
        do not delay the rest of Sync.
      </aside>
      <aside>
        <b>Five-Year Archive Retention:</b> Archived evidence keeps its original
        evidence date. At Sync start, non-SAAR evidence in active or Rework
        folders that is older than one year bypasses filename correction and moves to
        Archive; evidence older than five years moves directly to the
        organization&apos;s{" "}
        <code>ORG Archive / Superseded</code> folder instead of the current
        dated Archive folder. SAARs remain active or in Rework regardless of age
        because they do not expire. A SAAR with a standalone DISABLED marker, or
        a SAAR approved for archival after replacement, moves to the permanent
        <code>ORG SAAR Archive</code>; it never enters Superseded and is never
        automatically deleted. Sync repairs any SAAR previously left in a dated
        or Superseded archive. It also moves evidence that is not yet five years
        old out of Superseded and into the current dated Archive bucket. A filename containing only a four-digit year uses
        the end of that year as a conservative retention date, preventing a
        current or borderline year from being archived prematurely. Retention
        preserves the existing evidence filename. Archive compression replaces
        only a loose PDF container with a verified one-PDF ZIP; it does not
        discard the PDF evidence content.
      </aside>
      <aside>
        <b>Non-Destructive Restore Drill:</b> In <b>Restore Backup</b>, select a
        verified snapshot and choose <b>Run Non-Destructive Restore Drill</b>.
        The app verifies the external SHA-256, verifies the snapshot&apos;s
        internal content hash, reconstructs and validates the complete database
        in memory, confirms the selected information system, and records the
        successful drill in the audit log. It does not write the reconstructed
        records to the live manifest and does not move or delete evidence.
      </aside>
      <aside>
        <b>Long Sync Sessions:</b> While Sync is active, the tracker suspends
        the browser-session idle disconnect and keeps the portable Windows
        launcher active. The idle clocks restart from zero only after Sync
        completes, fails, or is stopped by the operator, so a large directory
        scan cannot log off the operator merely because it exceeds an idle
        limit. During new-user ingestion, a complete filename is accepted
        without opening the PDF, and the containing organization folder supplies
        a missing filename organization without a PDF read. Only SAARs that need
        recoverable identity or requester-date fields are opened. Those form-field
        reads run in a bounded group of four with visible completed-file progress;
        a read that does not finish within 30 seconds receives one fresh retry
        with a 60-second limit while the other readers continue. A second timeout
        is listed for correction without stopping the batch. Selectable-text Official Email recovery
        is deferred until Sync selects the newest SAAR for a proposed user, so it
        is not performed across every candidate form. Incomplete DoD Cyber and
        Privileged User Training certificates are processed in a separate
        bounded group of six. Only the first page is inspected, and a complete
        filename bypasses certificate content extraction. Each incomplete
        certificate has a 10-second whole-operation limit with no deep retry. If PDF.js
        cannot destroy a stalled loading
        task promptly, the tracker terminates that worker and continues the batch.
      </aside>
      <aside>
        <b>Batch Processing Resilience:</b> High-volume read-only work uses
        bounded queues instead of one unlimited batch or one blocking serial
        loop. Initial validation gives each changed file a 30-second read limit;
        duplicate-content checks, provenance hashing, Reconciliation hashing,
        and Inspection Package inventory hashing process no more than four files
        at once. Timed-out read-only operations receive no more than one fresh
        retry; deterministic validation failures are not retried. Document Renamer processes saved
        batches of 12 with three active PDF readers, stores progress after every
        batch, and records individual read failures without discarding completed
        analysis. Reconciliation exposes scanning and hashing progress and keeps
        unreadable files as review issues. File mutations—rename, compression,
        Rework, Archive, and manifest commits—remain sequential and transactional
        so concurrency cannot produce partial or conflicting writes. Browser-mode
        audit files are verified in chronological order with a 30-second read
        limit per daily file; verification fails closed instead of hanging or
        extending an unverified chain.
      </aside>
      <aside>
        <b>Extension Safety:</b> Every automated rename preserves the source
        container. A direct PDF remains a <code>.pdf</code>; a validated one-PDF
        ZIP remains a <code>.zip</code> and uses the canonical PDF filename
        immediately before the ZIP suffix. A mismatched proposed extension is
        corrected before the storage request is sent.
      </aside>
      <aside>
        <b>Efficient Audit Batches:</b> Consecutive file-level Sync and Document
        Renamer results are extended as one verified audit batch. The complete
        existing hash chain is verified once, each new action still receives its
        own sequence, UTC timestamp, previous hash, and entry hash, and the
        launcher performs one append per UTC day instead of rereading the chain
        for every file.
      </aside>
      <aside>
        <b>Error records:</b> Operational failures show bounded diagnostic
        details and write an <code>ERROR:</code> entry to the affected mapped
        system&apos;s audit chain. File-level rename, PDF-read, and validation
        errors do not stop the rest of a large Sync; they are audited and listed
        for operator review after processing finishes. Errors before mapping
        identify that no audit destination exists. Storage-verification and
        audit-chain-verification failures are shown but are not appended because
        an unverified chain must not be extended.
      </aside>
      <footer>
        This application supports NIST SP 800-53-aligned recordkeeping. Formal
        compliance depends on organizational policies, deployment, access
        controls, and assessment.
      </footer>
    </main>
  );
}
