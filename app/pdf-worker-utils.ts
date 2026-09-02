type LoadingTask={destroy:()=>Promise<unknown>|unknown};
type PdfWorkerHandle={destroy:()=>void};
type WorkerPort={terminate:()=>void};

export async function destroyPdfResources(task?:LoadingTask,worker?:PdfWorkerHandle,port?:WorkerPort){
 try{await task?.destroy()}catch{}
 try{worker?.destroy()}catch{}
 try{port?.terminate()}catch{}
}
