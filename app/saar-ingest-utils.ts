export type SaarEmailRead={email:string;error?:string;manualEntryAllowed?:boolean};

export type SaarEmailAdmission=
 |{allowed:true;email:string;missingOfficialEmail:boolean}
 |{allowed:false;email:'';missingOfficialEmail:false;reason:string};

const emailPattern=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function saarEmailAdmission(read:SaarEmailRead):SaarEmailAdmission{
 const email=read.email.trim();
 if(email&&email.length<=254&&emailPattern.test(email))return{allowed:true,email,missingOfficialEmail:false};
 if(read.manualEntryAllowed)return{allowed:true,email:'',missingOfficialEmail:true};
 return{allowed:false,email:'',missingOfficialEmail:false,reason:read.error||'The SAAR could not be validated for new-user ingestion.'};
}
