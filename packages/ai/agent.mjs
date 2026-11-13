import {assert} from '../core/model.mjs';
import {createCandidate} from '../core/transactions.mjs';
import {analyseReachability} from '../core/reachability.mjs';
import {nativeRequest} from '../core/native.mjs';
const definition=(name,description,properties,required=[])=>({type:'function',name,description,parameters:{type:'object',properties,required,additionalProperties:false}});
export const EDITOR_TOOLS=[{type:'namespace',name:'editor',description:'读取真实项目并提交隔离候选，不直接改草稿。',tools:[
 definition('search_rooms','按区域、名称或职责检索房间摘要。',{query:{type:'string'},region:{type:'string'}}),
 definition('get_rooms','读取至多六房的完整当前数据及关联奖励。',{room_ids:{type:'array',items:{type:'string'},maxItems:6}},['room_ids']),
 definition('world_graph','读取指定区域或全世界的门对及房内有向路线。',{region:{type:'string'}}),
 definition('catalog','读取已实现组件、敌人及资源目录，不得发明行为。',{}),
 definition('reachability','分析起点、能力和剧情标记的逻辑可达性。',{room:{type:'string'},section:{type:'string'},tokens:{type:'array',items:{type:'string'}}},['room']),
 definition('submit_candidate','提交可撤销设计候选。operations路径使用稳定ID，不改management或locks。',{label:{type:'string'},reason:{type:'string'},operations:{type:'array',items:{type:'object',properties:{op:{type:'string',enum:['add','replace','remove']},path:{type:'string'},value:{}},required:['op','path'],additionalProperties:false}},aiScores:{type:'object',additionalProperties:{type:'object',properties:{art:{type:'integer',minimum:0,maximum:10},gameplay:{type:'integer',minimum:0,maximum:10},world:{type:'integer',minimum:0,maximum:10},reason:{type:'string'}}}}},['label','reason','operations'])
]}];
export function executeTool(project,scope,name,args,reads=new Set()){switch(name){
 case 'search_rooms':return Object.values(project.rooms).filter(r=>(!args.region||r.region===args.region)&&(!args.query||(r.id+' '+r.name+' '+r.purpose).includes(args.query))).map(r=>({id:r.id,region:r.region,name:r.name,purpose:r.purpose,sections:Object.keys(r.sections),authored:r.authored}));
 case 'get_rooms':assert(Array.isArray(args.room_ids)&&args.room_ids.length<=6,'scope','每次读取至多六房');args.room_ids.forEach(id=>reads.add(id));return {rooms:args.room_ids.map(id=>project.rooms[id]).filter(Boolean),rewards:Object.values(project.rewards).filter(r=>args.room_ids.includes(r.room)),npcs:Object.values(project.npcs).filter(n=>args.room_ids.includes(n.room_id)),locks:project.locks,revision:project.revision};
 case 'world_graph':{const rooms=Object.values(project.rooms).filter(r=>!args.region||r.region===args.region),ids=new Set(rooms.map(r=>r.id));rooms.forEach(r=>reads.add(r.id));return {rooms:rooms.map(r=>({id:r.id,region:r.region,origin:r.origin,layer:r.layer,sections:r.sections,routes:r.routes,ports:r.ports})),connections:Object.values(project.connections).filter(c=>ids.has(c.a.room)||ids.has(c.b.room))};}
 case 'catalog':return project.catalog;
 case 'reachability':return analyseReachability(project,args);
 case 'submit_candidate':return createCandidate(project,{...args,dependencyRooms:[...reads],scope:scope?.length===Object.keys(project.rooms).length?undefined:scope});
 default:throw Error('未知编辑工具 '+name);
}}
export async function runAgent({project,goal,scope,model,feedback=[],onProgress=()=>{},request=nativeRequest}){
 assert(model,'model','请先登录ChatGPT并选择可用模型');
 const input=[{role:'developer',content:'你是《失序之钟》的关卡设计协作者。只能通过editor工具查询并提交候选，不能直接修改草稿。保留范围外内容、稳定ID、永久奖励身份和人工锁定。先查询再修改。能力锁在房内分区之间，以真实环境实现；不生成隐形能力墙。每片空间有职责，主支路、失败恢复和接缝一致。逻辑可达不等于真实动作通过，不伪造实机评分。所有修改通过submit_candidate提交，遇到真实设计冲突用文字说明。可编辑路径为rooms/connections/rewards/npcs；房间内entities为ID映射，实例为{id,component,properties}。数组组件使用array:platforms的properties.rect/one_way、array:enemy_placements的point/behavior等；节点组件的node_name/parent需保留。新行为只能使用catalog中已有组件。'},
 {role:'user',content:JSON.stringify({goal,scope,recent_feedback:feedback.slice(-5),base_revision:project.revision,source:project.source,room_schema:{id:'room ID',region:'area code',name:'名称',purpose:'职责',origin:[0,0],layer:'world',bounds:[0,0,1280,720],spaces:[[0,0,1280,720]],sections:{main:{id:'main',known:true}},routes:{},ports:{},entities:{},root:{component:'FixedWorldRoom',properties:{}}}})}];
 const candidates=[],reads=new Set();let text='';
 for(let round=0;round<12;round++){
  onProgress(`AI正在分析 · 第${round+1}轮工具调用`);
  const response=await request('ai.response',{model,input,tools:EDITOR_TOOLS});
  assert(response.status==='completed','ai_incomplete','模型未完整返回，草稿未改变');
  const output=response.output||[];input.push(...output);const calls=output.filter(x=>x.type==='function_call');
  for(const item of output)if(item.type==='message')for(const c of item.content||[])if(c.type==='output_text')text+=c.text+'\n';
  if(!calls.length)return {candidates,text};
  for(const call of calls){let result;try{const args=JSON.parse(call.arguments),name=call.name.replace(/^editor[._]/,'');result=executeTool(project,scope,name,args,reads);if(name==='submit_candidate'){candidates.push(result);onProgress(`候选已生成：${result.label}`);result={candidate_id:result.id,accepted:false,operations:result.operations.length};}}catch(e){result={error:e.code||'tool_error',message:e.message,details:e.details};}input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)});}
 }
 return {candidates,text:text||'已达到本轮工具调用上限，请检查已有候选。'};
}
