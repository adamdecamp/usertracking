import type{Metadata}from'next';import'./globals.css';import{applicationVersion}from'./version';
const iconVersion=encodeURIComponent(applicationVersion);
export const metadata:Metadata={title:'R.A.P.T.O.R. — Role-Based Access Personnel Tracking & Oversight Registry',description:'NIST SP 800-53-aligned administrative access personnel tracking and oversight registry',icons:{icon:[{url:`/raptor-icon.png?v=${iconVersion}`,type:'image/png',sizes:'512x512'},{url:`/favicon.ico?v=${iconVersion}`,type:'image/x-icon'}],shortcut:{url:`/favicon.ico?v=${iconVersion}`},apple:{url:`/raptor-icon.png?v=${iconVersion}`}},robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
