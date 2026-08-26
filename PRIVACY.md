# Privacy

Information System User Tracker is designed for local administrative use.

- The executable hosts its interface only on the local Windows computer.
- It reads the active Windows account name to attribute consequential audit actions.
- Its local Windows launcher accesses only a shared directory explicitly selected by the operator and performs all persistent file writes there.
- User records, evidence archives, audit logs, and backups remain in that selected directory.
- The launcher writes a small session-lock metadata file containing the active Windows account, computer name, process identifier, session identifier, and update time. It contains no user-tracking records or evidence.
- The application contains no telemetry, advertising, analytics, or external data-upload service.

The organization operating the tracker is responsible for access permissions, records retention, privacy notices, and protection of the selected shared directory. Do not place real operational data in public GitHub issues or vulnerability reports.
