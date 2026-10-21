const cleanPrivilegedType=(value:string)=>value
 .replace(/[\r\n\u0000-\u001f\u007f]/g,' ')
 .trim()
 .replace(/^_+/,'')
 .trim();

/**
 * Privileged account types are identifiers, not display names. Store them in a
 * single case so DEV, dev, and Dev cannot become separate filters or report rows.
 */
export function normalizePrivilegedType(value:string){
 return cleanPrivilegedType(value).toUpperCase();
}

export function normalizePrivilegedTypes(values:Iterable<string>,limit=50){
 const normalized:string[]=[];
 const seen=new Set<string>();
 for(const value of values){
  const type=normalizePrivilegedType(value);
  if(!type||seen.has(type))continue;
  seen.add(type);
  normalized.push(type);
  if(normalized.length>=limit)break;
 }
 return normalized;
}

export function privilegedTypeMatches(left:string,right:string){
 const normalizedLeft=normalizePrivilegedType(left),normalizedRight=normalizePrivilegedType(right);
 return !!normalizedLeft&&normalizedLeft===normalizedRight;
}

export function privilegedTypeFromUsername(value:string){
 const clean=value.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim(),separator=clean.lastIndexOf('_');
 return separator>0&&separator<clean.length-1?clean.slice(separator+1):'';
}

export function parsePrivilegedUsernames(value:string){
 return Array.from(new Set(value.split(',').map(item=>item.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim()).filter(Boolean))).slice(0,50);
}

export function privilegedTypesFromUsernames(values:string[]){
 return normalizePrivilegedTypes(values.map(privilegedTypeFromUsername));
}

export function parsePrivilegedTypes(value:string){
 return normalizePrivilegedTypes(value.split(','));
}

export function validPrivilegedUsername(value:string){
 return value.length<=200&&!/\s|,/.test(value)&&!!privilegedTypeFromUsername(value);
}

export function validPrivilegedType(value:string){
 return value.length>0&&value.length<=100;
}
