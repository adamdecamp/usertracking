# Privacy

AUDIT — Authorized User Documentation & Information Tracker — is designed for local administrative use.

- The executable hosts its interface only on the local Windows computer.
- It reads the active Windows account name to attribute consequential audit actions.
- Its local Windows launcher accesses only a shared directory explicitly selected by the operator. It also uses a per-Windows-user working directory under Local AppData so edits and newly processed evidence can be completed without repeated network-share round trips.
- The local working database, state, and publication journal are protected with Windows DPAPI for the signed-in user and a restrictive Windows ACL. The shared directory remains the authoritative published record; successful session publication copies and verifies staged evidence before committing the shared database.
- Authoritative user records, evidence archives, audit logs, and backups remain in the selected shared directory. Locally staged evidence moves to organization-specific local-only Complete folders after verified publication for operator review. R.A.P.T.O.R. does not automatically delete retained evidence locally or on the shared drive.
- The launcher writes a small session-lock metadata file containing the active Windows account, computer name, process identifier, session identifier, and update time. It contains no user-tracking records or evidence.
- The application contains no telemetry, advertising, analytics, or external data-upload service.

The organization operating the tracker is responsible for access permissions, records retention, privacy notices, and protection of the selected shared directory. Do not place real operational data in public GitHub issues or vulnerability reports.
