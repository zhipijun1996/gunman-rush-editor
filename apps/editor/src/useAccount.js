import {useCallback,useEffect,useRef,useState} from 'react';
import {nativeAvailable,nativeRequest} from '../../../packages/core/native.mjs';
import {readSession,writeSession} from '../../../packages/core/session.mjs';

export default function useAccount() {
  const [state,setState]=useState({phase:nativeAvailable()?'checking':'web',models:[],model:readSession().model||'',email:'',error:''});
  const busy=useRef(false),signing=useRef(false),generation=useRef(0);
  const refresh=useCallback(async()=>{
    if(!nativeAvailable()||busy.current||signing.current)return;
    busy.current=true;const seq=++generation.current;
    try{
      const account=await nativeRequest('auth.status');
      if(seq!==generation.current)return;
      if(!account.connected){setState(s=>({...s,phase:account.busy?'authorizing':'signedOut',models:[],error:account.last_error||''}));return;}
      setState(s=>({...s,phase:'loadingModels',email:account.email||'',error:''}));
      const models=await nativeRequest('ai.models');
      if(seq!==generation.current)return;
      if(!Array.isArray(models)||!models.length)throw Error('账号已保存，但未取得可用模型；请重试连接检查');
      setState(s=>({...s,phase:'ready',models,model:models.some(m=>m.slug===s.model)?s.model:models[0].slug,error:''}));
    }catch(e){if(seq===generation.current)setState(s=>({...s,phase:'error',models:[],error:e.message}));}
    finally{busy.current=false;}
  },[]);
  useEffect(()=>{
    refresh();const resume=()=>{if(!document.hidden)refresh();};
    document.addEventListener('visibilitychange',resume);window.addEventListener('gunman:resume',resume);
    return()=>{document.removeEventListener('visibilitychange',resume);window.removeEventListener('gunman:resume',resume);};
  },[refresh]);
  useEffect(()=>{if(state.model)writeSession({model:state.model});},[state.model]);
  async function login(){
    if(signing.current||busy.current)return;
    signing.current=true;++generation.current;setState(s=>({...s,phase:'authorizing',error:''}));
    try{await nativeRequest('auth.signIn');}catch(e){setState(s=>({...s,phase:'error',error:e.message}));return;}
    finally{signing.current=false;}
    await refresh();
  }
  async function logout(){++generation.current;try{await nativeRequest('auth.signOut');setState(s=>({...s,phase:'signedOut',models:[],error:'',email:''}));}catch(e){setState(s=>({...s,phase:'error',error:e.message}));}}
  async function cancelLogin(){try{await nativeRequest('auth.cancel');}catch(e){setState(s=>({...s,phase:'error',error:e.message}));}}
  return {...state,login,logout,cancelLogin,refresh,setModel:model=>setState(s=>({...s,model}))};
}
