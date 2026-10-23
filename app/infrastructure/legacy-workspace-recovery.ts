import {portableStorageRequest} from './portable-storage-request.ts';
import {decodeJsonResponse} from './runtime-decoders.ts';
import {decodeLegacyWorkspaceRecoveryResult,decodeLegacyWorkspaceRecoveryStatus,decodeLegacyWorkspaceReviewPackage,type LegacyWorkspaceRecoveryResult,type LegacyWorkspaceRecoveryStatus,type LegacyWorkspaceReviewPackage} from './portable-contracts.ts';

type TrackerRecoveryWindow=Window&{__trackerSessionToken?:string;__trackerSessionId?:string};
const headers=(initial?:HeadersInit)=>{const result=new Headers(initial),host=window as TrackerRecoveryWindow;if(host.__trackerSessionToken)result.set('X-RAPTOR-Session-Token',host.__trackerSessionToken);if(host.__trackerSessionId)result.set('X-RAPTOR-Lease-Session',host.__trackerSessionId);return result};
const request=(storageId:string,action:string,init?:RequestInit)=>portableStorageRequest({systemId:storageId,action,init,networkWriteTimeoutMs:10*60*1000,launcherHeaders:headers,onStart:()=>undefined,onFinish:()=>undefined});

export function isLegacyWorkspaceRecoveryRequired(error:unknown){return error instanceof Error&&/earlier workspace predates safe cross-computer reconciliation/i.test(error.message)}
export async function readLegacyWorkspaceRecovery(storageId:string,logicalSystemId:string):Promise<LegacyWorkspaceRecoveryStatus>{return decodeJsonResponse(await request(storageId,`workspace-recovery?logical=${encodeURIComponent(logicalSystemId)}`),'Legacy workspace recovery',decodeLegacyWorkspaceRecoveryStatus,64*1024)}
export async function exportLegacyWorkspaceRecovery(storageId:string,logicalSystemId:string):Promise<LegacyWorkspaceReviewPackage>{return decodeJsonResponse(await request(storageId,'workspace-recovery-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({logicalSystemId})}),'Legacy workspace review export',decodeLegacyWorkspaceReviewPackage,64*1024)}
export async function resetLegacyWorkspaceRecovery(storageId:string,logicalSystemId:string):Promise<LegacyWorkspaceRecoveryResult>{return decodeJsonResponse(await request(storageId,'workspace-recovery-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({logicalSystemId,confirmation:'BACK UP AND RESET'})}),'Legacy workspace reset',decodeLegacyWorkspaceRecoveryResult,100*1024*1024)}
