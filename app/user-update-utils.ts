export type UpdatedSaarRequirementInput={
 statusChange:boolean;
 modifyingPrivileges:boolean;
 hasUpdatedSaar:boolean;
 overrideSelected:boolean;
 overrideComment:string;
};

export function accessChangeOverrideAllowed(input:Pick<UpdatedSaarRequirementInput,'statusChange'|'modifyingPrivileges'>){
 return input.statusChange||input.modifyingPrivileges;
}

export function updatedSaarRequirementSatisfied(input:UpdatedSaarRequirementInput){
 if(!input.statusChange&&!input.modifyingPrivileges)return true;
 if(input.hasUpdatedSaar)return true;
 return accessChangeOverrideAllowed(input)&&input.overrideSelected&&input.overrideComment.trim().length>0;
}

export function reactivationEvidenceRequirementSatisfied(input:{reactivating:boolean;allRequiredEvidenceSelected:boolean;overrideAllowed:boolean;overrideSelected:boolean;overrideComment:string}){
 if(!input.reactivating||input.allRequiredEvidenceSelected)return true;
 return input.overrideAllowed&&input.overrideSelected&&input.overrideComment.trim().length>0;
}

export function manualAddEvidenceGate(input:{requiredKinds:string[];selectedKinds:string[];overrideSelected:boolean;overrideComment:string}){
 const selected=new Set(input.selectedKinds),missingKinds=input.requiredKinds.filter(kind=>!selected.has(kind)),missingSaar=missingKinds.includes('SAAR'),justification=input.overrideComment.trim();
 const overrideApplied=missingKinds.length>0&&!missingSaar&&input.overrideSelected&&justification.length>0;
 return{allowed:missingKinds.length===0||overrideApplied,missingKinds,overrideApplied,justification};
}

const emailPattern=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function missingOfficialEmailUpdate(currentEmail:string,nextEmail:string,otherEmails:string[]=[]){
 const current=currentEmail.trim(),next=nextEmail.trim();
 if(current)return{allowed:false,reason:'Official Email can only be entered here when the user record is missing it.'} as const;
 if(!next||next.length>254||!emailPattern.test(next))return{allowed:false,reason:'Enter a valid Official Email address.'} as const;
 if(otherEmails.some(value=>value.trim().toLowerCase()===next.toLowerCase()))return{allowed:false,reason:'That Official Email is already assigned to another user record.'} as const;
 return{allowed:true,email:next} as const;
}
