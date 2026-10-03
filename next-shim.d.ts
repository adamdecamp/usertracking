declare module 'next' {
  export type Metadata=Record<string,unknown>;
  export interface NextConfig {
    headers?:()=>Promise<Array<{
      source:string;
      headers:Array<{key:string;value:string}>;
    }>>;
  }
}
