'use client';

import {useSyncExternalStore} from 'react';
import type {ThrottledValue} from '../throttled-value';
import {OperationHistory,type OperationHistoryEntry} from './OperationHistory';
import {ProcessingPanel,type ProcessingStatus} from './ProcessingPanel';

/**
 * The progress panel and Recent Activity, fed by their own fast-updating source so a running Sync
 * redraws only this small part of the screen for each file instead of the whole page.
 */
export function LiveProcessingStatus({source,history,onDismiss,onClearHistory}:{source:ThrottledValue<ProcessingStatus|null>;history:OperationHistoryEntry[];onDismiss:()=>void;onClearHistory:()=>void}){
 const status=useSyncExternalStore(source.subscribe,source.get,source.get);
 return <>{status&&<ProcessingPanel status={status} onDismiss={onDismiss}/>}<OperationHistory current={status} history={history} onClear={onClearHistory}/></>;
}
