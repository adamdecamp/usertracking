import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeLegacyWorkspaceRecoveryResult,decodeLegacyWorkspaceRecoveryStatus,decodeLegacyWorkspaceReviewPackage} from '../app/infrastructure/portable-contracts.ts';
import {isLegacyWorkspaceRecoveryRequired} from '../app/infrastructure/legacy-workspace-recovery.ts';

const hash='a'.repeat(64),status={required:true,dirty:true,legacy:true,baseSnapshotAvailable:false,systemName:'Test System',userCount:42,savedAtUtc:'2026-10-22T20:46:26.656Z',baseSharedSha256:hash,sharedManifestSha256:'b'.repeat(64),sharedDataWillChange:false,automaticDeletion:false},reviewPackage={created:true,filename:'legacy-workspace-review.zip',path:'C:\\Recovery\\legacy-workspace-review.zip',sha256:hash,createdAtUtc:'2026-10-22T21:00:00.000Z',sharedDataChanged:false,evidenceIncluded:false};

test('legacy recovery contracts require non-destructive, integrity-verified receipts',()=>{
 assert.equal(decodeLegacyWorkspaceRecoveryStatus(status).required,true);
 assert.equal(decodeLegacyWorkspaceReviewPackage(reviewPackage).sha256,hash);
 assert.equal(decodeLegacyWorkspaceRecoveryResult({saved:'now',backup:'now',filename:'backup.json.gz',auditEntries:1,auditHeadHash:hash,manifestSha256:hash,recoveryCompleted:true,archivedWorkspacePath:'C:\\Recovery\\workspace',reviewPackage}).recoveryCompleted,true);
 assert.throws(()=>decodeLegacyWorkspaceRecoveryStatus({...status,sharedDataWillChange:true}),/unsafe recovery policy/);
 assert.throws(()=>decodeLegacyWorkspaceReviewPackage({...reviewPackage,sha256:'bad'}),/invalid package receipt/);
 assert.throws(()=>decodeLegacyWorkspaceRecoveryResult({saved:'now',backup:'now',filename:'x',auditEntries:1,auditHeadHash:hash,manifestSha256:hash,recoveryCompleted:false,archivedWorkspacePath:'x',reviewPackage}),/confirm completion/);
});

test('only the stable fail-closed legacy reconciliation error opens guided recovery',()=>{
 assert.equal(isLegacyWorkspaceRecoveryRequired(new Error('The earlier workspace predates safe cross-computer reconciliation, so publishing remains blocked.')),true);
 assert.equal(isLegacyWorkspaceRecoveryRequired(new Error('The audit log failed integrity verification.')),false);
 assert.equal(isLegacyWorkspaceRecoveryRequired('predates safe cross-computer reconciliation'),false);
});

test('guided recovery remains lease-protected, audited, explicit, and non-deleting',()=>{
 const component=readFileSync(new URL('../app/components/LegacyWorkspaceRecoveryPanel.tsx',import.meta.url),'utf8'),storage=readFileSync(new URL('../portable-launcher/PortableLegacyWorkspaceRecovery.cs',import.meta.url),'utf8'),launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8'),policy=readFileSync(new URL('../portable-launcher/LauncherPolicy.cs',import.meta.url),'utf8');
 assert.match(component,/BACK UP AND RESET/);assert.match(component,/No files are automatically deleted/);assert.match(component,/Continue In Read-Only/);
 assert.match(storage,/CreateLegacyWorkspaceReviewPackage/);assert.match(storage,/RelocateProtectedWorkspaceFiles\(state\.WorkspaceRoot, archivedWorkspace\)/);assert.match(storage,/TryFileHash\(target\)/);assert.match(storage,/LEGACY WORKSPACE RECOVERY COMPLETED/);assert.doesNotMatch(storage,/Directory\.Delete\(state\.WorkspaceRoot/);
 assert.match(launcher,/workspace-recovery-reset/);assert.equal(/workspace-recovery-reset/.test(policy)&&!policy.includes('ReadOnlyStorageActionAllowed("workspace-recovery-reset"'),true);
});
