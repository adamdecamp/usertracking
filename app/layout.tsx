import type{Metadata}from'next';import'./globals.css';
export const metadata:Metadata={title:'AUDIT — Authorized User Documentation & Information Tracker',description:'NIST SP 800-53-aligned administrative user documentation and information tracker',icons:{icon:[{url:'/favicon.ico',type:'image/x-icon'},{url:'/audit-icon.png',type:'image/png',sizes:'512x512'}],apple:{url:'/audit-icon.png'}},robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
