# Privacy

R.A.P.T.O.R. — Role-Based Access Personnel Tracking & Oversight Registry — is designed for local administrative use.

- The executable hosts its interface only on the local Windows computer.
- It reads the active Windows account name to attribute consequential audit actions.
- Its local Windows launcher accesses only a shared directory explicitly selected by the operator. It also uses a per-Windows-user working directory under Local AppData so edits and newly processed evidence can be completed without repeated network-share round trips.
- The local working database, state, and publication journal are protected with Windows DPAPI for the signed-in user and a restrictive Windows ACL. The shared directory remains the authoritative published record; successful session publication copies and verifies staged evidence before committing the shared database.
- Authoritative user records, evidence archives, audit logs, and backups remain in the selected shared directory. Archive-bound local evidence waits in the organization-specific `Complete/Pending Upload` folder and moves to `Complete/Published Evidence` after verified publication. R.A.P.T.O.R. does not automatically delete published evidence locally or on the shared drive.
- Each user record keeps a compliance history: the dates on which that user became compliant or stopped being compliant. It is stored in the database with the rest of the record and is used only to draw the Compliance Trend chart. An Organization Status File does not include it.
- The launcher writes a small session-lock metadata file containing the active Windows account, computer name, process identifier, session identifier, and update time. It contains no user-tracking records or evidence.
- Outlook access is read-only and happens only when the operator asks for it. The launcher reads messages and attachments from the signed-in user's Outlook to find evidence documents, and it can open a draft for the operator to review. It never sends mail.
- Display choices (Dark Mode, the color scheme, and User Directory view preferences) are saved in the browser storage of the local interface for the signed-in Windows user. They contain no user-tracking records.
- The application contains no telemetry, advertising, analytics, or external data-upload service.

The organization operating the tracker is responsible for access permissions, records retention, privacy notices, and protection of the selected shared directory. Do not place real operational data in public GitHub issues or vulnerability reports.
