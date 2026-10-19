export type GlobalErrorReporter=(context:string,error:unknown)=>void|Promise<void>;

export function installGlobalErrorReporting(report:GlobalErrorReporter){
 const submit=(context:string,error:unknown)=>{try{void Promise.resolve(report(context,error)).catch(()=>undefined)}catch{/* The reporter itself must never create another global error. */}};
 const browserError=(event:ErrorEvent)=>{submit('Unhandled browser error.',event.error??new Error(event.message||'An unknown browser error occurred.'))};
 const rejected=(event:PromiseRejectionEvent)=>{submit('Unhandled promise rejection.',event.reason??new Error('A promise was rejected without an error detail.'))};
 window.addEventListener('error',browserError);
 window.addEventListener('unhandledrejection',rejected);
 return()=>{window.removeEventListener('error',browserError);window.removeEventListener('unhandledrejection',rejected)};
}
