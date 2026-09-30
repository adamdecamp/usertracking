import test from 'node:test';
import assert from 'node:assert/strict';
import {detailedErrorMessage,errorAuditAction,errorDetail,isMissingEvidenceError} from '../app/error-utils.ts';

test('formats bounded single-line error details for display and audit',()=>{
 const detail=errorDetail(new TypeError('first line\nsecond line'));
 assert.equal(detail,'TypeError: first line second line');
 assert.match(errorAuditAction('System Sync',detail),/^ERROR: System Sync; details TypeError:/);
 assert.ok(errorAuditAction('x'.repeat(500),'y'.repeat(500)).length<=477);
});

test('states whether the error was recorded in an audit log',()=>{
 assert.match(detailedErrorMessage('Sync failed.', 'Disk unavailable.','recorded'),/Audit: Recorded/);
 assert.match(detailedErrorMessage('Sync failed.', 'Disk unavailable.','unavailable'),/No mapped system audit log/);
 assert.match(detailedErrorMessage('Sync failed.', 'Disk unavailable.','failed','Audit directory denied.'),/Audit failure details: Audit directory denied/);
});

test('distinguishes an already-missing evidence source from integrity and permission failures',()=>{
 assert.equal(isMissingEvidenceError(new Error('The selected evidence file no longer exists.')),true);
 assert.equal(isMissingEvidenceError(new Error('FileNotFoundException: Could not find a part of the path.')),true);
 assert.equal(isMissingEvidenceError(new DOMException('Entry was not found.','NotFoundError')),true);
 assert.equal(isMissingEvidenceError(new Error('The archived copy failed its SHA-256 integrity check.')),false);
 assert.equal(isMissingEvidenceError(new Error('Access to the path is denied.')),false);
});
