type LoadingTask={destroy:()=>Promise<unknown>|unknown};
type PdfWorkerHandle={destroy:()=>void};
type WorkerPort={terminate:()=>void};

export async function destroyPdfResources(task?:LoadingTask,worker?:PdfWorkerHandle,port?:WorkerPort,timeoutMs=2000){
 try{if(task)await new Promise<void>(resolve=>{let settled=false;const finish=()=>{if(settled)return;settled=true;globalThis.clearTimeout(timer);resolve()},timer=globalThis.setTimeout(finish,Math.max(1,Math.min(timeoutMs,10000)));Promise.resolve().then(()=>task.destroy()).then(finish,finish)})}catch{}
 try{worker?.destroy()}catch{}
 try{port?.terminate()}catch{}
}
