import {canonical,clone,assert,validateProject} from './model.mjs';
const same=(a,b)=>canonical(a)===canonical(b);
/** Three-way object merge. Arrays remain atomic; stable identities live in maps. */
export function planUpdate(base,draft,incoming,resolutions={}){
 assert(base.schema===incoming.schema&&draft.schema===incoming.schema,'schema_migration','此更新需要明确的数据迁移器，当前草稿未改变');const conflicts=[];
 const merge=(a,b,c,path)=>{
  if(same(b,a))return clone(c);if(same(c,a)||same(b,c))return clone(b);
  if(Object.hasOwn(resolutions,path))return clone(resolutions[path]==='incoming'?c:resolutions[path]==='draft'?b:resolutions[path]?.value);
  if([a,b,c].every(v=>v&&typeof v==='object'&&!Array.isArray(v))){const out={};for(const k of new Set([...Object.keys(a),...Object.keys(b),...Object.keys(c)])){const v=merge(a[k],b[k],c[k],path+'/'+k.replaceAll('~','~0').replaceAll('/','~1'));if(v!==undefined)out[k]=v;}return out;}
  conflicts.push({path,base:clone(a),draft:clone(b),incoming:clone(c)});return clone(b);
 };
 const result=clone(draft);for(const field of ['rooms','connections','rewards','npcs','catalog'])result[field]=merge(base[field],draft[field],incoming[field],'/'+field);
 const lockedValue=(obj,path)=>path.split('/').slice(1).map(k=>k.replaceAll('~1','/').replaceAll('~0','~')).reduce((v,k)=>v?.[k],obj);
 for(const lock of draft.locks||[])if(!same(lockedValue(draft,lock),lockedValue(result,lock)))conflicts.push({path:lock,locked:true});
 const oldErrors=new Set(validateProject(draft).filter(x=>x.severity==='error').map(canonical));for(const problem of validateProject(result).filter(x=>x.severity==='error'&&!oldErrors.has(canonical(x))))conflicts.push({path:problem.path,reference_error:problem.message});
 result.source=clone(incoming.source);result.runtime_defaults=clone(incoming.runtime_defaults);result.native_runtime=clone(incoming.native_runtime);result.revision=draft.revision+1;return {canApply:!conflicts.length,conflicts,project:result,checkpoint:clone(draft)};
}
