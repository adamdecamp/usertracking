import {agreementArtifactKind} from '../filename-utils.ts';

export type ArtifactRecognitionRule={kind:string;all?:string[][];any?:string[];compact?:string[]};

/**
 * Recognition aliases are data rather than control flow so every ingestion
 * workflow can evaluate the same vocabulary before the strict storage gate.
 */
export const artifactRecognitionRules:ArtifactRecognitionRule[]=[
 {kind:'SAAR',any:['SAAR'],all:[['DD','2875'],['FORM','2875'],['ACCESS','REQUEST']]},
 {kind:agreementArtifactKind,any:['AGREEMENT','AGREEMENTS'],all:[['ACCEPTABLE','USE']]},
 {kind:'8140 Cert Memo',any:['8140','8570'],all:[['CERT','MEMO'],['CERTIFICATE','MEMO'],['CERTIFICATION','MEMO'],['QUALIFICATION','MEMO'],['CERT','LETTER'],['CERTIFICATION','LETTER']]},
 {kind:'DTA Training',all:[['DTA','TRAINING'],['DTA','COURSE'],['DTA','RESPONSIBILITIES'],['DATA','TRANSFER','AGENT','TRAINING'],['DATA','TRANSFER','AGENT','COURSE']]},
 {kind:'Privileged User Training Cert',all:[['PRIV','TRAINING'],['PRIVILEGED','TRAINING'],['PRIVILEGED','COURSE'],['PRIVILEGED','RESPONSIBILITIES'],['PRIVILEGED','ACCESS','TRAINING']]},
 {kind:'DoD Cyber Cert',any:['AWARENESS'],all:[['DOD','CYBER'],['DOW','CYBER'],['CYBER','CERT'],['CYBER','CERTIFICATE'],['AWARENESS','CHALLENGE']]},
];

export const recognitionThresholds={automatic:0.98,minimumMargin:0.10} as const;

export const surnamePrefixes=[
 ['VAN','DER'],['VAN','DEN'],['VAN','DE'],['DE','LA'],['DE','LOS'],['DE','LAS'],
 ['VON','DER'],['VON','DEN'],['VAN'],['VON'],['DE'],['DEL'],['DA'],['DI'],['LA'],['LE'],['ST'],['SAINT'],
] as const;

export const nameSuffixes=new Set(['JR','SR','II','III','IV','V']);
