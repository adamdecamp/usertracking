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
