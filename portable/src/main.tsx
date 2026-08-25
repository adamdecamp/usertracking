import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from '../../app/page';
import Guide from '../../app/user-guide/page';
import '../../app/globals.css';
import '../../app/user-guide/user-guide.css';

async function start(){
  try{const response=await fetch('/api/session-user',{credentials:'same-origin'});if(response.ok){const data=await response.json() as {user?:string};if(data.user)(window as unknown as{__windowsUser?:string}).__windowsUser=data.user}}catch{}
  const Page=location.pathname.startsWith('/user-guide')?Guide:Home;
  createRoot(document.getElementById('root')!).render(<React.StrictMode><Page/></React.StrictMode>);
}
void start();

