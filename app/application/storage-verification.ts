import type {StorageVerificationResponse} from '../infrastructure/portable-contracts.ts';

export function verificationSessionNotice(result:StorageVerificationResponse){return[result.workspaceRebased?'This computer’s protected non-conflicting changes were reconciled with the latest shared master before Full Access opened.':'',result.workspaceResumed&&!result.workspaceRebased?'The protected local Full Access workspace was resumed after verification.':'',result.backupRecoveryWarning??''].filter(Boolean).join(' ')}
