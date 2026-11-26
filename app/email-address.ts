const localPart=/^[A-Z0-9._%+-]+$/i,domainCharacters=/^[A-Z0-9.-]+$/i,topLevelDomain=/^[A-Z]{2,}$/i;

/**
 * Accepts exactly the addresses matched by /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, without that pattern's
 * backtracking: the domain's character class and its final dot overlap, so a value with many dots made the
 * regex retry polynomially. Here each check is a single linear character-class test, and the top-level domain
 * is whatever follows the last dot (it holds only letters, so it can never contain a dot).
 */
export function isEmailAddress(value:string,maxLength=254){
 if(value.length>maxLength)return false;
 const at=value.indexOf('@');if(at<1||at!==value.lastIndexOf('@'))return false;
 const domain=value.slice(at+1),dot=domain.lastIndexOf('.');
 return dot>=1&&localPart.test(value.slice(0,at))&&domainCharacters.test(domain)&&topLevelDomain.test(domain.slice(dot+1));
}
