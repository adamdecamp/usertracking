import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from '../../app/page';
import Guide from '../../app/user-guide/page';
import '../../app/globals.css';
import '../../app/user-guide/user-guide.css';

type PortableWindow=Window&{__windowsUser?:string;__portableHost?:boolean};

function installPortableLifecycle(){
  let lastActivitySignal=0,handlingShutdown=false;
  const post=(path:string,keepalive=false)=>fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',keepalive}).catch(()=>undefined);
  const activity=()=>{const now=Date.now();if(now-lastActivitySignal<1000)return;lastActivitySignal=now;handlingShutdown=false;void post('/api/activity',true)};
  document.addEventListener('pointerdown',activity,{passive:true});
  document.addEventListener('keydown',activity);
  document.addEventListener('touchstart',activity,{passive:true});
  window.addEventListener('pagehide',()=>{navigator.sendBeacon('/api/browser-closing')});
  void post('/api/activity',true);
  void post('/api/presence');
  setInterval(()=>void post('/api/presence'),5000);
  setInterval(()=>void(async()=>{try{const response=await fetch('/api/control',{credentials:'same-origin',cache:'no-store'});if(!response.ok)return;const control=await response.json() as{shutdownRequested?:boolean;reason?:string};if(!control.shutdownRequested){handlingShutdown=false;return}if(handlingShutdown)return;handlingShutdown=true;const event=new CustomEvent('tracker-shutdown-request',{cancelable:true,detail:{reason:control.reason||'idle'}}),handled=!window.dispatchEvent(event);if(!handled)await post('/api/shutdown-ready',true)}catch{}})(),5000);
}

async function start(){
  try{const response=await fetch('/api/session-user',{credentials:'same-origin'});if(response.ok){const data=await response.json() as {user?:string},portableWindow=window as PortableWindow;portableWindow.__portableHost=true;if(data.user)portableWindow.__windowsUser=data.user;installPortableLifecycle()}}catch{}
  const Page=location.pathname.startsWith('/user-guide')?Guide:Home;
  createRoot(document.getElementById('root')!).render(<React.StrictMode><Page/></React.StrictMode>);
}
void start();
