export type UpdatedSaarRequirementInput={
 statusChange:boolean;
 modifyingPrivileges:boolean;
 hasUpdatedSaar:boolean;
 overrideSelected:boolean;
 overrideComment:string;
};

export function accessChangeOverrideAllowed(input:Pick<UpdatedSaarRequirementInput,'statusChange'|'modifyingPrivileges'>){
 return input.statusChange&&!input.modifyingPrivileges;
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
