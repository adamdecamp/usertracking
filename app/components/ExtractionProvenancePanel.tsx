import type {UserExtractionProvenance} from '../domain/tracker-models';

const labels:Record<keyof UserExtractionProvenance,string>={identity:'Name',organization:'Storage Organization',officialEmail:'Official Email',designation:'Designation',accountType:'Account Type'};

export function ExtractionProvenancePanel({provenance}:{provenance?:UserExtractionProvenance}){
 const entries=(Object.entries(provenance??{}) as [keyof UserExtractionProvenance,NonNullable<UserExtractionProvenance[keyof UserExtractionProvenance]>][]).filter((entry):entry is [keyof UserExtractionProvenance,NonNullable<typeof entry[1]>]=>!!entry[1]);
 return <section className="change-box"><strong>Extraction Provenance</strong>{entries.length?<div className="record-meta">{entries.map(([field,item])=><span key={field}>{labels[field]}<b>{item.source}</b><small title={item.detail}>{item.filename?`${item.filename} · `:''}{new Date(item.verifiedAtUtc).toLocaleString()}</small></span>)}</div>:<p className="hint">No source metadata is available for this legacy record. The next verified Sync or operator edit will add it.</p>}</section>;
}
