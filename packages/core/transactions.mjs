import {assert,canonical,clone,findEntity,id,validateProject} from './model.mjs';
import {reviewFingerprint} from './management.mjs';
const forbidden=new Set(['__proto__','prototype','constructor']);
export function pathParts(path){assert(typeof path==='string'&&path.startsWith('/'),'path','修改路径无效');const parts=path.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));assert(parts.every(x=>x&&!forbidden.has(x)),'path','修改路径包含非法字段');return parts;}
export function readPath(obj,path){return pathParts(path).reduce((v,k)=>v?.[k],obj);}
function writePath(obj,op){const parts=pathParts(op.path);assert(['rooms','connections','rewards','npcs'].includes(parts[0]),'scope','候选只能修改设计数据');let parent=obj;for(const k of parts.slice(0,-1)){assert(parent&&Object.hasOwn(parent,k),'path_missing','修改路径已不存在');parent[k]=Array.isArray(parent[k])?[...parent[k]]:{...parent[k]};parent=parent[k];}const key=parts.at(-1);assert(parent&&typeof parent==='object','path_missing','修改父对象不存在');if(op.op==='remove'){assert(Object.hasOwn(parent,key),'path_missing','删除对象不存在');delete parent[key];}else{assert(['add','replace'].includes(op.op),'operation','不支持的修改操作');if(op.op==='replace')assert(Object.hasOwn(parent,key),'path_missing','替换对象不存在');parent[key]=clone(op.value);}}
export function applyTransaction(project,{base_revision,operations,scope},options={}){
 assert(project.revision===base_revision,'revision_conflict','草稿已变化，请重新比较');assert(Array.isArray(operations)&&operations.length>0&&operations.length<=2000,'operations','修改数量无效');
 const next={...project},affected=new Set();
 for(const op of operations){const parts=pathParts(op.path);if(parts[0]==='rooms'){if(scope)assert(scope.includes(parts[1]),'scope','修改超出本次选区');affected.add(parts[1]);}
  assert(!(project.locks||[]).some(lock=>op.path===lock||op.path.startsWith(lock+'/')||lock.startsWith(op.path+'/')),'locked','修改涉及锁定对象');writePath(next,op);
 }
 if(scope)for(const kind of ['connections','rewards','npcs'])for(const key of new Set([...Object.keys(project[kind]),...Object.keys(next[kind])])){
  if(canonical(project[kind][key])===canonical(next[kind][key]))continue;
  const owners=[project[kind][key],next[kind][key]].filter(Boolean).flatMap(v=>kind==='connections'?[v.a.room,v.b.room]:[v.room||v.room_id]);
  assert(owners.every(r=>scope.includes(r)),'scope','关联修改超出本次选区，请把门对或迁移目标一起纳入选区');
 }
 for(const [key,old] of Object.entries(project.rewards))if(next.rewards[key]){assert(next.rewards[key].action_id===old.action_id,'reward_receipt','移动或修改奖励不能改永久领取身份');if(old.goal||['ability','equipment'].includes(old.type))assert(next.rewards[key].type===old.type,'unique_reward','唯一能力和修钟目标不能转换成普通奖励');}
 const issues=validateProject(next),beforeErrors=new Set(validateProject(project).filter(x=>x.severity==='error').map(x=>canonical(x)));
 const introduced=issues.filter(x=>x.severity==='error'&&!beforeErrors.has(canonical(x)));assert(!introduced.length||options.allowIncomplete,'invalid_design','修改产生了关联错误',{issues:introduced});
 next.revision++;return {project:next,affected:[...affected],issues,transaction:{id:id('transaction'),base_revision,operations:clone(operations)}};
}
export function createCandidate(project,{label,operations,scope,reason,aiScores,dependencyRooms}){
 applyTransaction(project,{base_revision:project.revision,operations,scope});
 const dependencies=Object.fromEntries((dependencyRooms||scope||[]).filter(r=>project.rooms[r]).map(r=>[r,reviewFingerprint(project,r)]));
 return {id:id('candidate'),base_revision:project.revision,source:clone(project.source),label:label||'AI候选',reason:reason||'',scope:scope||[],dependencies,operations:clone(operations),aiScores:aiScores||null,before:operations.map(op=>({path:op.path,present:readPath(project,op.path)!==undefined,value:clone(readPath(project,op.path))})),at:new Date().toISOString()};
}
export function validateCandidate(candidate){assert(candidate&&typeof candidate.id==='string'&&candidate.source&&Array.isArray(candidate.scope)&&Array.isArray(candidate.operations)&&Array.isArray(candidate.before),'candidate','候选格式不完整');assert(candidate.operations.length===candidate.before.length,'candidate','候选缺少逐项比较基线');candidate.operations.forEach((op,i)=>{pathParts(op.path);assert(['add','replace','remove'].includes(op.op)&&candidate.before[i]?.path===op.path,'candidate','候选操作与比较基线不一致');});return candidate;}
export function compareCandidate(project,candidate){validateCandidate(candidate);const conflicts=[];for(const b of candidate.before){if(canonical(readPath(project,b.path))!==canonical(b.value))conflicts.push({path:b.path,base:b.value,current:readPath(project,b.path)});}for(const [rid,fingerprint] of Object.entries(candidate.dependencies||{}))if(!project.rooms[rid]||reviewFingerprint(project,rid)!==fingerprint)conflicts.push({path:'/rooms/'+rid,message:'AI读取过的房间已变化，请重新比较'});if(canonical(project.source)!==canonical(candidate.source))conflicts.push({path:'/source',message:'游戏基线已改变'});return {canAdopt:!conflicts.length,conflicts};}
export function adoptCandidate(project,candidate){const comparison=compareCandidate(project,candidate);assert(comparison.canAdopt,'candidate_conflict','候选与当前草稿冲突',comparison);return applyTransaction(project,{base_revision:project.revision,operations:candidate.operations,scope:candidate.scope.length?candidate.scope:undefined});}
export function moveReward(project,rewardId,targetRoomId,position,section='main'){
 const reward=project.rewards[rewardId],target=project.rooms[targetRoomId];assert(reward?.host&&target?.sections[section],'reward_target','奖励或目标分区不存在');const hit=findEntity(project,reward.host);assert(hit,'reward_host','奖励实际宿主不存在');const host=clone(hit.entity);host.properties.position=position;
 const moved={...reward,room:targetRoomId,section};const escape=v=>v.replaceAll('~','~0').replaceAll('/','~1');const ops=[];
 if(hit.room.id===targetRoomId)ops.push({op:'replace',path:`/rooms/${escape(hit.room.id)}/entities/${escape(host.id)}`,value:host});
 else ops.push({op:'remove',path:`/rooms/${escape(hit.room.id)}/entities/${escape(host.id)}`},{op:'add',path:`/rooms/${escape(targetRoomId)}/entities/${escape(host.id)}`,value:host});
 ops.push({op:'replace',path:`/rewards/${escape(rewardId)}`,value:moved});return ops;
}
export function moveNpc(project,npcId,targetRoomId,position,section='main'){
 const npc=project.npcs[npcId],target=project.rooms[targetRoomId];assert(npc?.host&&target?.sections[section],'npc_target','NPC尚无实际宿主或目标分区不存在');const hit=findEntity(project,npc.host);assert(hit,'npc_host','NPC宿主不存在');const host=clone(hit.entity);host.properties.position=position;const escape=v=>v.replaceAll('~','~0').replaceAll('/','~1');const ops=[];
 if(hit.room.id===targetRoomId)ops.push({op:'replace',path:`/rooms/${escape(hit.room.id)}/entities/${escape(host.id)}`,value:host});else ops.push({op:'remove',path:`/rooms/${escape(hit.room.id)}/entities/${escape(host.id)}`},{op:'add',path:`/rooms/${escape(targetRoomId)}/entities/${escape(host.id)}`,value:host});
 ops.push({op:'replace',path:`/npcs/${escape(npcId)}`,value:{...npc,room_id:targetRoomId,physical_room:targetRoomId,section_id:section}});return ops;
}
export function createReward(project,roomId,type='time_gear',position=[128,128],section='main'){
 assert(project.rooms[roomId]?.sections[section],'reward_target','奖励目标分区不存在');const template=project.catalog.actions?.find(a=>a.type===type&&Object.keys(a.inventory_grants||{}).length);assert(template,'reward_type','此收集类型尚未实现');assert(!['ability','equipment'].includes(type),'unique_reward','能力或装备需先选择唯一的正式定义，不能复制既有权益');
 const rewardId=id('reward'),actionId='pickup_'+rewardId,host=id('pickup'),escape=v=>v.replaceAll('~','~0').replaceAll('/','~1');
 const action={id:actionId,reward_id:rewardId,room_id:roomId,section_id:section,type,requires:[[]],grants:['found_'+rewardId],inventory_grants:clone(template.inventory_grants),persistent:true,repeat:false,receipt_id:rewardId,interaction_required:true,description:'新收集物'};
 const entity={id:host,component:'WorldRoomInteraction',order:Object.keys(project.rooms[roomId].entities).length,node_name:'Pickup_'+host.split(':').at(-1).replaceAll('-',''),parent:'',properties:{position,action_id:actionId,section_id:section,label:'拾取',visual:['time_gear','health_shard'].includes(type)?type:'chest',radius:60}};
 return [{op:'add',path:`/rooms/${escape(roomId)}/entities/${escape(host)}`,value:entity},{op:'add',path:`/rewards/${escape(rewardId)}`,value:{id:rewardId,action_id:actionId,room:roomId,section,type,quantity:1,host,physical:true,requires:[[]],action}}];
}
