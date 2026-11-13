import {assert,canonical} from '../core/model.mjs';
import {reviewFingerprint} from '../core/management.mjs';
import {scopeForOperations,resolveScope} from '../core/workspace.mjs';
import {createCandidate} from '../core/transactions.mjs';
import {analyseReachability} from '../core/reachability.mjs';
import {nativeRequest} from '../core/native.mjs';
const definition=(name,description,properties,required=[])=>({type:'function',name,description,parameters:{type:'object',properties,required,additionalProperties:false}});
export const EDITOR_TOOLS=[{type:'namespace',name:'editor',description:'读取真实项目，提交完整校验事务；默认直接更新草稿，另版模式保留独立方案。',tools:[
 definition('search_rooms','按区域、名称或职责检索房间摘要。',{query:{type:'string'},region:{type:'string'}}),
 definition('get_rooms','读取至多六房的完整当前数据及关联奖励。',{room_ids:{type:'array',items:{type:'string'},maxItems:6}},['room_ids']),
 definition('world_graph','读取指定区域或全世界的门对及房内有向路线。',{region:{type:'string'}}),
 definition('catalog','读取已实现组件、敌人及资源目录，不得发明行为。',{}),
 definition('reachability','分析起点、能力和剧情标记的逻辑可达性。',{room:{type:'string'},section:{type:'string'},tokens:{type:'array',items:{type:'string'}}},['room']),
 definition('submit_candidate','提交完整设计事务，默认立即更新草稿。operations路径使用稳定ID；不改management或locks；邻房仅可改单个关联端口。',{label:{type:'string'},reason:{type:'string'},operations:{type:'array',items:{type:'object',properties:{op:{type:'string',enum:['add','replace','remove']},path:{type:'string'},value:{}},required:['op','path'],additionalProperties:false}},aiScores:{type:'object',additionalProperties:{type:'object',properties:{art:{type:'integer',minimum:0,maximum:10},gameplay:{type:'integer',minimum:0,maximum:10},world:{type:'integer',minimum:0,maximum:10},reason:{type:'string'}}}}},['label','reason','operations'])
]}];
export function executeTool(project,scope,name,args,reads=new Set()){switch(name){
 case 'search_rooms':return Object.values(project.rooms).filter(r=>(!args.region||r.region===args.region)&&(!args.query||(r.id+' '+r.name+' '+r.purpose).includes(args.query))).map(r=>({id:r.id,region:r.region,name:r.name,purpose:r.purpose,sections:Object.keys(r.sections),authored:r.authored}));
 case 'get_rooms':assert(Array.isArray(args.room_ids)&&args.room_ids.length<=6,'scope','每次读取至多六房');args.room_ids.forEach(id=>reads.add(id));return {rooms:args.room_ids.map(id=>project.rooms[id]).filter(Boolean),rewards:Object.values(project.rewards).filter(r=>args.room_ids.includes(r.room)),npcs:Object.values(project.npcs).filter(n=>args.room_ids.includes(n.room_id)),locks:project.locks,revision:project.revision};
 case 'world_graph':{const rooms=Object.values(project.rooms).filter(r=>!args.region||r.region===args.region),ids=new Set(rooms.map(r=>r.id));rooms.forEach(r=>reads.add(r.id));return {rooms:rooms.map(r=>({id:r.id,region:r.region,origin:r.origin,layer:r.layer,sections:r.sections,routes:r.routes,ports:r.ports})),planning:args.region?project.planning?.blueprints?.[args.region]:project.planning,connections:Object.values(project.connections).filter(c=>ids.has(c.a.room)||ids.has(c.b.room))};}
 case 'catalog':return project.catalog;
 case 'reachability':return analyseReachability(project,args);
 case 'submit_candidate':{const allowed=scopeForOperations(project,scope,args.operations);return {...createCandidate(project,{...args,dependencyRooms:[...reads],scope:allowed.rooms}),neighborRooms:allowed.neighbors};}
 default:throw Error('未知编辑工具 '+name);
}}
export async function runAgent({project,getProject=()=>project,goal,scope,selection={},model,feedback=[],variant=false,signal,onApply,onProgress=()=>{},request=nativeRequest}){
 assert(model,'model','AI尚未就绪，请先连接账号并读取模型');
 const input=[{role:'developer',content:'你是《失序之钟》的关卡设计协作者。通过editor工具查询最新数据并用submit_candidate提交完整事务；默认事务校验后直接更新用户画布，只有variant=true时保留独立方案。用户可在期间编辑，冲突必须重新读取。保留范围外内容、稳定ID、永久奖励身份和人工锁定。先查询再修改。可读取全世界，写入范围明确指定；必要门对可改单个邻房关联端口，不可改邻房其他内容。范围外大改、主线/能力获得顺序变化及锁定冲突先向用户提出具体问题，不能擅自执行。能力锁由房内真实环境实现；每片空间有职责，主支路、失败恢复和接缝一致。逻辑可达不等于真实动作通过，不伪造实机评分。可编辑路径为rooms/connections/rewards/npcs；entities为ID映射，实例为{id,definition_id,definition_version,component,properties}，定义和参数必须来自catalog.elements；不可把已拆分的服务写回root。array:platforms使用properties.rect/one_way；敌人使用point/behavior；节点的node_name/parent保留。行为只用catalog已有组件。任务未完成或未实际写入时不能声称修改成功。'},
 {role:'user',content:JSON.stringify({goal,scope:resolveScope(project,scope),selection,variant,recent_feedback:feedback.slice(-5),base_revision:project.revision,source:project.source,room_schema:{id:'room ID',region:'area code',name:'名称',purpose:'职责',origin:[0,0],layer:'world',bounds:[0,0,1280,720],spaces:[[0,0,1280,720]],sections:{main:{id:'main',known:true}},routes:{},ports:{},entities:{},root:{definition_id:'room.standard',definition_version:1,component:'FixedWorldRoom',properties:{}}}})}];
 const candidates=[],applied=[],reads=new Set(),fingerprints=new Map(),source=canonical(project.source);let text='';
 const checkStop=()=>{if(signal?.aborted)throw new DOMException('已停止；已完成修改保留，可撤销本次任务','AbortError');};
 for(let round=0;round<12;round++){
  checkStop();onProgress(`AI正在分析 · 第${round+1}轮`);
  const response=await request('ai.response',{model,input,tools:EDITOR_TOOLS},{signal});
  checkStop();assert(response.status==='completed','ai_incomplete','本轮响应不完整，未提交的修改没有写入');
  const output=response.output||[];input.push(...output);const calls=output.filter(x=>x.type==='function_call');
  for(const item of output)if(item.type==='message')for(const c of item.content||[])if(c.type==='output_text')text+=c.text+'\n';
  if(!calls.length)return {candidates,applied,text};
  for(const call of calls){checkStop();let result;
   try{
    const args=JSON.parse(call.arguments),name=call.name.replace(/^editor[._]/,''),current=variant?project:getProject();
    if(name==='submit_candidate'){
     assert(source===canonical(current.source),'candidate_conflict','游戏基线已变化，请重新开始本次任务');
     for(const [rid,fingerprint] of fingerprints)assert(current.rooms[rid]&&reviewFingerprint(current,rid)===fingerprint,'candidate_conflict','读取过的房间已修改，请重新读取后再提交',{room:rid});
    }
    const prior=new Set(reads);result=executeTool(current,scope,name,args,reads);
    if(name==='get_rooms'||name==='world_graph')for(const rid of reads)if(!prior.has(rid)||args.room_ids?.includes(rid)||name==='world_graph')if(current.rooms[rid])fingerprints.set(rid,reviewFingerprint(current,rid));
    if(name==='submit_candidate'){
     checkStop();
     if(variant){candidates.push(result);onProgress(`独立方案已生成：${result.label}`);result={candidate_id:result.id,applied:false,operations:result.operations.length};}
     else {
      assert(onApply,'ai_apply','未连接草稿事务入口');
      const saved=await onApply(result);applied.push(result);reads.clear();fingerprints.clear();
      onProgress(`已更新画布：${result.label}${result.neighborRooms.length?' · 联动 '+result.neighborRooms.join('、'):''}`);
      result={transaction_id:result.id,applied:true,revision:saved?.revision,operations:result.operations.length,neighbor_rooms:result.neighborRooms};
     }
    }
   }catch(e){if(e.name==='AbortError')throw e;result={error:e.code||'tool_error',message:e.message,details:e.details};}
   input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)});
  }
 }
 return {candidates,applied,text:text||'已达到本次工具调用上限；已完成的修改保留，其他内容未执行。'};
}
