import type {StorageHealth} from '../tracker-workflow-types';

const title=(status:StorageHealth['status'])=>status==='healthy'?'Storage Healthy':status==='saving'?'Saving…':status==='checking'?'Checking Storage…':status==='error'?'Storage Needs Attention':'Folder Not Mapped';
const when=(value?:string)=>value?new Date(value).toLocaleString():'—';

/**
 * Mapped-folder storage status. An organization snapshot has no storage,
 * backups, or Sync, so it gets one plain explanation instead.
 */
export function StorageHealthCard({health,snapshot,canVerify,verifyDisabled,onVerify}:{health:StorageHealth;snapshot:boolean;canVerify:boolean;verifyDisabled:boolean;onVerify:()=>void}){
 if(snapshot)return <section className="storage-health snapshot" role="status"><div className="health-summary"><span className="health-dot"/><div><strong>Organization Status File · Read Only</strong><small>{health.message} To work with live records, Log Off and map the information system folder.</small></div></div></section>;
 return <section className={`storage-health ${health.status}`}><div className="health-summary"><span className="health-dot"/><div><strong>{title(health.status)}</strong><small>{health.message??(health.status==='unmapped'?'Map this system folder to enable protected storage.':'Database, Checksum, and Backup Status')}</small></div></div><div className="health-times"><span>Last Saved<b>{when(health.lastSaved)}</b></span><span>Last Backup<b>{when(health.lastBackup)}</b></span><span>Last Sync<b>{when(health.lastSync)}</b></span></div>{canVerify&&<button disabled={verifyDisabled} onClick={onVerify}>Verify Storage</button>}</section>;
}
