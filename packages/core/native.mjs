const requests=new Map();
export function nativeAvailable(){return !!globalThis.GunmanNative?.request;}
export function nativeRequest(method,params={},options={}) {
  return new Promise((resolve,reject)=>{
    if(!nativeAvailable()){reject(new Error('此功能需要原生 APK'));return;}
    if(options.signal?.aborted){reject(new DOMException('已停止','AbortError'));return;}
    const request_id=crypto.randomUUID();
    const clean=()=>{requests.delete(request_id);clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);};
    const abort=()=>{clean();globalThis.GunmanNative.request(JSON.stringify({request_id:crypto.randomUUID(),method:'request.cancel',params:{request_id}}));reject(new DOMException('已停止','AbortError'));};
    const timeout=setTimeout(()=>{clean();globalThis.GunmanNative.request(JSON.stringify({request_id:crypto.randomUUID(),method:'request.cancel',params:{request_id}}));reject(new Error('原生请求超时，可重试；已完成的修改保留'));},['auth.signIn','runtime.ensure','preview.open','ai.response'].includes(method)?300000:120000);
    requests.set(request_id,{resolve,reject,clean});options.signal?.addEventListener('abort',abort,{once:true});
    try{globalThis.GunmanNative.request(JSON.stringify({request_id,method,params}));}catch(e){clean();reject(e);}
  });
}
globalThis.__gunmanNativeResult=message=>{
  const data=typeof message==='string'?JSON.parse(message):message,pending=requests.get(data.request_id);
  if(!pending)return;pending.clean();if(data.error)pending.reject(new Error(data.error));else pending.resolve(data.result);
};
