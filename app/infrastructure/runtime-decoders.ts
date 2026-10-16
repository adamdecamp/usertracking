export class RuntimeDecodeError extends Error{
 constructor(context:string,path:string,expectation:string){super(`${context} returned invalid data at ${path}: expected ${expectation}.`);this.name='RuntimeDecodeError'}
}

export type RuntimeDecoder<T>=(value:unknown,path?:string)=>T;

export function objectValue(value:unknown,context:string,path='$'):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new RuntimeDecodeError(context,path,'an object');
 return value as Record<string,unknown>;
}

export function stringValue(value:unknown,context:string,path:string,max=32767):string{
 if(typeof value!=='string'||value.length>max||/[\r\n\u0000]/.test(value))throw new RuntimeDecodeError(context,path,`a string no longer than ${max} characters`);
 return value;
}

export function booleanValue(value:unknown,context:string,path:string):boolean{
 if(typeof value!=='boolean')throw new RuntimeDecodeError(context,path,'a boolean');
 return value;
}

export function numberValue(value:unknown,context:string,path:string,min=0,max=Number.MAX_SAFE_INTEGER):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new RuntimeDecodeError(context,path,`an integer from ${min} through ${max}`);
 return value;
}

export function optionalString(record:Record<string,unknown>,key:string,context:string,max=32767):string|undefined{
 return record[key]===undefined?undefined:stringValue(record[key],context,`$.${key}`,max);
}

export function optionalBoolean(record:Record<string,unknown>,key:string,context:string):boolean|undefined{
 return record[key]===undefined?undefined:booleanValue(record[key],context,`$.${key}`);
}

export function optionalNumber(record:Record<string,unknown>,key:string,context:string,min=0,max=Number.MAX_SAFE_INTEGER):number|undefined{
 return record[key]===undefined?undefined:numberValue(record[key],context,`$.${key}`,min,max);
}

export function stringArrayValue(value:unknown,context:string,path:string,maxItems=100000,maxItemLength=32767):string[]{
 if(!Array.isArray(value)||value.length>maxItems)throw new RuntimeDecodeError(context,path,`an array with at most ${maxItems} items`);
 return value.map((item,index)=>stringValue(item,context,`${path}[${index}]`,maxItemLength));
}

export async function decodeJsonResponse<T>(response:Response,context:string,decoder:RuntimeDecoder<T>,maxBytes=100*1024*1024):Promise<T>{
 const declared=response.headers.get('content-length'),declaredBytes=declared===null?undefined:Number(declared);
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('JSON response limit must be a positive safe integer.');
 if(declaredBytes!==undefined&&(!Number.isSafeInteger(declaredBytes)||declaredBytes<0||declaredBytes>maxBytes))throw new RuntimeDecodeError(context,'$.bytes',`a response no larger than ${maxBytes} bytes`);
 let value:unknown;
 try{const text=await response.text();if(new TextEncoder().encode(text).byteLength>maxBytes)throw new RuntimeDecodeError(context,'$.bytes',`a response no larger than ${maxBytes} bytes`);value=JSON.parse(text)}catch(error){if(error instanceof RuntimeDecodeError)throw error;throw new RuntimeDecodeError(context,'$','valid JSON')}
 return decoder(value,'$');
}
