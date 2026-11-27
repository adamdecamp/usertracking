import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from '../../app/page';
import Guide from '../../app/user-guide/page';
import '../../app/globals.css';
import '../../app/user-guide/user-guide.css';

type PortableWindow=Window&{__windowsUser?:string;__operatorFullName?:string;__portableHost?:boolean;__trackerSessionToken?:string};

function sessionToken(){return(window as PortableWindow).__trackerSessionToken??''}
function sessionHeaders(){return{'X-RAPTOR-Session-Token':sessionToken()}}

function loadLauncherSessionToken(){
 const portableWindow=window as PortableWindow,fragment=new URLSearchParams(location.hash.replace(/^#/,'')),fromFragment=fragment.get('session')??'',stored=sessionStorage.getItem('raptor-launcher-session')??'',token=fromFragment||stored;
 if(!token)return'';
 portableWindow.__trackerSessionToken=token;sessionStorage.setItem('raptor-launcher-session',token);
 if(fromFragment)history.replaceState(null,'',`${location.pathname}${location.search}`);
 return token;
}

function installPortableLifecycle(){
  let lastActivitySignal=0,handlingShutdown=false;
  const post=(path:string,keepalive=false)=>fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',keepalive,headers:sessionHeaders()}).catch(()=>undefined);
  const activity=()=>{const now=Date.now();if(now-lastActivitySignal<1000)return;lastActivitySignal=now;handlingShutdown=false;void post('/api/activity',true)};
  document.addEventListener('pointerdown',activity,{passive:true});
  document.addEventListener('keydown',activity);
  document.addEventListener('touchstart',activity,{passive:true});
  const closing=()=>{void post('/api/browser-closing',true)};
  window.addEventListener('beforeunload',closing);
  window.addEventListener('pagehide',closing);
  void post('/api/activity',true);
  void post('/api/presence');
  setInterval(()=>void post('/api/presence'),5000);
  setInterval(()=>void(async()=>{try{const response=await fetch('/api/control',{credentials:'same-origin',cache:'no-store',headers:sessionHeaders()});if(!response.ok)return;const control=await response.json() as{shutdownRequested?:boolean;reason?:string};if(!control.shutdownRequested){handlingShutdown=false;return}if(handlingShutdown)return;handlingShutdown=true;const event=new CustomEvent('tracker-shutdown-request',{cancelable:true,detail:{reason:control.reason||'idle'}}),handled=!window.dispatchEvent(event);if(!handled)await post('/api/shutdown-ready',true)}catch{}})(),5000);
}

const sessionUserAttempts=4,sessionUserRetryMs=400;

/**
 * The verified operator from the launcher. A passing failure (the request could not be sent, or a 5xx reply) is tried
 * again a few times; 'refused' is any other reply, such as an expired session, which a retry cannot fix.
 */
async function readSessionUser():Promise<{user?:string;fullName?:string}|'refused'|'unreachable'>{
 for(let attempt=1;attempt<=sessionUserAttempts;attempt++){
  try{
   const response=await fetch('/api/session-user',{credentials:'same-origin',cache:'no-store',headers:sessionHeaders()});
   if(response.ok)return await response.json() as {user?:string;fullName?:string};
   if(response.status<500)return'refused';
  }catch{}
  if(attempt<sessionUserAttempts)await new Promise(resolve=>setTimeout(resolve,sessionUserRetryMs*attempt));
 }
 return'unreachable';
}

function LauncherUnreachable(){
 return <main className="app" role="alert" style={{padding:'48px 24px',maxWidth:640,margin:'0 auto'}}><h1>R.A.P.T.O.R. Could Not Reach Its Windows Launcher</h1><p>The application could not confirm your Windows account with the launcher, so it did not open. No records were changed.</p><p>Close this window and open R.A.P.T.O.R. again from its Windows launcher. If this keeps happening, restart the launcher first.</p><p><button type="button" onClick={()=>location.reload()}>Try Again</button></p></main>;
}

async function start(){
  const portableWindow=window as PortableWindow;portableWindow.__portableHost=true;
  const token=loadLauncherSessionToken();
  const guide=location.pathname.startsWith('/user-guide'),identity=token?await readSessionUser():'none';
  if(typeof identity==='object'){if(identity.user)portableWindow.__windowsUser=identity.user;if(identity.fullName)portableWindow.__operatorFullName=identity.fullName;installPortableLifecycle()}
  const root=createRoot(document.getElementById('root')!);
  // Without the verified operator and the heartbeat the launcher expects, the application must not run as if all were well.
  if(identity==='unreachable'&&!guide){root.render(<LauncherUnreachable/>);return}
  const Page=guide?Guide:Home;
  root.render(<React.StrictMode><Page/></React.StrictMode>);
}
void start();
