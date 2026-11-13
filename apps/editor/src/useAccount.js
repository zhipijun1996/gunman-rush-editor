import {useCallback,useEffect,useRef,useState} from 'react';
import {nativeAvailable,nativeRequest} from '../../../packages/core/native.mjs';
import {readSession,writeSession} from '../../../packages/core/session.mjs';

export default function useAccount() {
  const [state,setState]=useState({phase:nativeAvailable()?'checking':'web',busy:nativeAvailable(),models:[],model:readSession().model||'',email:'',error:'',canRetry:false,step:'idle',diagnostic:null});
  const refreshing=useRef(false),action=useRef(null),generation=useRef(0);
  const refresh=useCallback(async()=>{
    if(!nativeAvailable()||refreshing.current)return;
    refreshing.current=true;const seq=generation.current;
    try{
      const account=await nativeRequest('auth.status');if(seq!==generation.current)return;
      const patch={email:account.email||'',canRetry:!!account.can_retry,step:account.step||'idle',diagnostic:account.diagnostic||null,error:account.last_error||''};
      if(account.busy||action.current){setState(s=>({...s,...patch,busy:true,phase:['identity','storage'].includes(account.step)?'verifying':'authorizing'}));return;}
      if(account.can_retry){setState(s=>({...s,...patch,busy:false,phase:'verificationPending',models:[]}));return;}
      if(!account.connected){setState(s=>({...s,...patch,busy:false,phase:patch.error?'error':'signedOut',models:[]}));return;}
      setState(s=>({...s,...patch,busy:true,phase:'loadingModels'}));
      const models=await nativeRequest('ai.models');if(seq!==generation.current)return;
      if(!Array.isArray(models)||!models.length)throw Error('账号已保存，但未取得可用模型；请重试连接检查');
      setState(s=>({...s,...patch,phase:'ready',busy:false,models,model:models.some(m=>m.slug===s.model)?s.model:models[0].slug,error:''}));
    }catch(e){
      if(seq!==generation.current)return;
      const account=await nativeRequest('auth.status').catch(()=>null);if(seq!==generation.current)return;
      setState(s=>({...s,phase:account?.can_retry?'verificationPending':'error',busy:false,models:[],canRetry:!!account?.can_retry,step:account?.step||s.step,diagnostic:account?.diagnostic||null,error:e.message}));
    }finally{refreshing.current=false;}
  },[]);
  useEffect(()=>{
    refresh();const resume=()=>{if(!document.hidden)refresh();};
    document.addEventListener('visibilitychange',resume);window.addEventListener('gunman:resume',resume);
    return()=>{document.removeEventListener('visibilitychange',resume);window.removeEventListener('gunman:resume',resume);};
  },[refresh]);
  useEffect(()=>{if(!state.busy)return;const timer=setInterval(refresh,1000);return()=>clearInterval(timer);},[state.busy,refresh]);
  useEffect(()=>{if(state.model)writeSession({model:state.model});},[state.model]);
  async function authorize(method){
    if(action.current||state.busy)return;
    const seq=++generation.current;action.current=method;
    setState(s=>({...s,busy:true,phase:method==='auth.retry'?'verifying':'authorizing',step:method==='auth.retry'?'identity':'discovery',error:''}));
    try{await nativeRequest(method);}
    catch(e){if(seq===generation.current)setState(s=>({...s,error:e.message}));}
    finally{if(seq===generation.current)action.current=null;}
    if(seq===generation.current)await refresh();
  }
  async function logout(){++generation.current;action.current=null;try{await nativeRequest('auth.signOut');setState(s=>({...s,phase:'signedOut',busy:false,models:[],error:'',email:'',canRetry:false,diagnostic:null}));}catch(e){setState(s=>({...s,phase:'error',busy:false,error:e.message}));}}
  async function cancelLogin(){++generation.current;action.current=null;try{await nativeRequest('auth.cancel');await refresh();}catch(e){setState(s=>({...s,phase:'error',busy:false,error:e.message}));}}
  return {...state,login:()=>authorize('auth.signIn'),retryIdentity:()=>authorize('auth.retry'),logout,cancelLogin,refresh,setModel:model=>setState(s=>({...s,model}))};
}
