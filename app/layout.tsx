import type{Metadata}from'next';import'./globals.css';import{applicationVersion}from'./version';
const iconVersion=encodeURIComponent(applicationVersion);
export const metadata:Metadata={title:'AUDIT — Authorized User Documentation & Information Tracker',description:'NIST SP 800-53-aligned administrative user documentation and information tracker',icons:{icon:[{url:`/audit-icon.png?v=${iconVersion}`,type:'image/png',sizes:'512x512'},{url:`/favicon.ico?v=${iconVersion}`,type:'image/x-icon'}],shortcut:{url:`/favicon.ico?v=${iconVersion}`},apple:{url:`/audit-icon.png?v=${iconVersion}`}},robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
