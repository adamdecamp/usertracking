export type EvidenceExistenceLoader=(path:string)=>Promise<unknown>;

export async function verifyArchivedEvidenceExists(path:string,load:EvidenceExistenceLoader,cache:Map<string,Promise<boolean>>){
 const key=path.replaceAll('\\','/').toUpperCase();let exists=cache.get(key);
 if(!exists){exists=load(path).then(payload=>{if(!payload||typeof payload!=='object'||typeof(payload as{exists?:unknown}).exists!=='boolean')throw new Error('Archived evidence verification returned invalid data.');return(payload as{exists:boolean}).exists});cache.set(key,exists)}
 if(!(await exists))throw new Error('The archived evidence file no longer exists.');
}
