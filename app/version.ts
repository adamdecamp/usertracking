export const applicationVersion='1.5.0';
// 2026.11.22-1: due dates use the system's local calendar day (Due Today on the due date),
// exceptions expire at the end of their local date, and future-dated evidence never counts.
export const complianceRuleSetVersion='2026.11.22-1';
// Bump only when evidence validation semantics change. UI and reporting releases
// must not force every previously validated file through content validation again.
export const evidenceValidationCacheVersion='2026.10.21-69';
