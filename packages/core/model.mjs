import {validateElements,terrainPaintError} from './elements.mjs';
export const SCHEMA=2;
export class EditorError extends Error {constructor(code,message,details={}){super(message);this.code=code;this.details=details;}}
export const clone=value=>structuredClone(value);
export const canonical=value=>JSON.stringify(sort(value));
function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
export function id(prefix='entity'){return `${prefix}:${crypto.randomUUID()}`;}
export function assert(ok,code,message,details){if(!ok)throw new EditorError(code,message,details);}
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const point=v=>Array.isArray(v)&&v.length===2&&v.every(finite);
export const rect=v=>Array.isArray(v)&&v.length===4&&v.every(finite)&&v[2]>0&&v[3]>0;
export function createProject(source={}){return {schema:SCHEMA,id:id('project'),revision:0,source,rooms:{},connections:{},rewards:{},npcs:{},catalog:{components:{},resources:[],enemies:[]},management:{},locks:[],metadata:{name:'失序之钟 · 世界工坊'}};}
export function createRoom(region='P',origin=[0,0]){const roomId=region+'-R'+crypto.randomUUID().replaceAll('-','').slice(0,10);return {id:roomId,region,name:'新房间',purpose:'待设计',origin,layer:'world',bounds:[0,0,1280,720],spaces:[[0,0,1280,720]],sections:{main:{id:'main',name:'主体',kind:'main',known:true,point:[640,360]}},routes:{},ports:{},entities:{},root:{component:'FixedWorldRoom',properties:{}},camera:{profile:'bounded_follow',transition:'occluded',zones:[],links:[]},implemented:false};}
export function roomBounds(room){const [x,y,w,h]=room.bounds;return [room.origin[0]+x,room.origin[1]+y,w,h];}
export function entityPosition(e){const p=e.properties||{};return p.rect?p.rect.slice(0,2):p.bounds?p.bounds.slice(0,2):p.position||p.point||p.bell||[0,0];}
export function entityRect(e){const p=e.properties||{},pos=entityPosition(e);return p.rect||p.bounds||(p.platform_size?[pos[0]-p.platform_size[0]/2,pos[1]-p.platform_size[1]/2,...p.platform_size]:[pos[0]-12,pos[1]-24,24,24]);}
export function entityWithPosition(entity,pos){const e=clone(entity),p=e.properties;if(p.rect)p.rect=[...pos,...p.rect.slice(2)];else if(p.bounds)p.bounds=[...pos,...p.bounds.slice(2)];else if(p.point)p.point=pos;else if(p.bell)p.bell=pos;else p.position=pos;return e;}
export function findEntity(project,entityId){for(const room of Object.values(project.rooms)){if(room.entities?.[entityId])return {room,entity:room.entities[entityId]};}return null;}
export function validateProject(p){const issues=[];const issue=(code,path,message,severity='error')=>issues.push({code,path,message,severity});
 if(p.schema!==SCHEMA)issue('schema','/schema','不支持的数据版本');
 const entities=new Map();
 for(const [rid,r] of Object.entries(p.rooms||{})){
  if(r.id!==rid||!point(r.origin)||!rect(r.bounds))issue('room_geometry',`/rooms/${rid}`,'房间身份、位置或尺寸无效');
  for(const [eid,e] of Object.entries(r.entities||{})){
   if(e.id!==eid||entities.has(eid))issue('entity_identity',`/rooms/${rid}/entities/${eid}`,'实例ID缺失或重复');entities.set(eid,{room:r,entity:e});
   if(typeof e.component!=='string'||!e.component)issue('component',`/rooms/${rid}/entities/${eid}`,'组件类型缺失');
   if(Object.keys(p.catalog?.components||{}).length&&!p.catalog.components[e.component])issue('component_unknown',`/rooms/${rid}/entities/${eid}`,'组件未在当前游戏目录登记');
   if(e.component==='array:enemy_placements'&&p.catalog.enemies?.length&&!p.catalog.enemies.some(x=>x.id===e.properties?.behavior))issue('enemy_unknown',`/rooms/${rid}/entities/${eid}`,'怪物物种未在当前游戏登记');
   if(!point(entityPosition(e)))issue('entity_position',`/rooms/${rid}/entities/${eid}`,'实例坐标无效');
   if(e.properties?.rect&&!rect(e.properties.rect))issue('entity_rect',`/rooms/${rid}/entities/${eid}`,'地形尺寸无效');
  }
  issues.push(...validateElements(r,p.catalog?.elements,p.catalog?.surface_styles));
  const paintError=terrainPaintError(r.root?.properties?.terrain_paint,p.catalog?.terrain_materials);if(paintError)issue('terrain_paint',`/rooms/${rid}/root/properties/terrain_paint`,paintError);
  for(const route of Object.values(r.routes||{})){if(!r.sections?.[route.from]||!r.sections?.[route.to])issue('route_endpoint',`/rooms/${rid}/routes/${route.id}`,'房内路线引用了不存在的分区');if(route.requires!==null&&!validCondition(route.requires))issue('condition',`/rooms/${rid}/routes/${route.id}/requires`,'通路条件必须为OR-of-AND字符串数组');}
  for(const port of Object.values(r.ports||{})){if(!r.sections?.[port.section])issue('port_section',`/rooms/${rid}/ports/${port.id}`,'入口没有合法的房内分区');if(port.connection&&!p.connections[port.connection])issue('port_connection',`/rooms/${rid}/ports/${port.id}`,'入口引用了不存在的连接');}
 }
 for(const c of Object.values(p.connections||{})){for(const end of [c.a,c.b]){const r=p.rooms[end?.room],port=r?.ports?.[end?.port];if(!port)issue('door_pair',`/connections/${c.id}`,'连接缺少合法的双端入口');else if(port.connection&&port.connection!==c.id)issue('door_pair',`/connections/${c.id}`,'入口与连接身份不一致');}if(c.requires!==null&&!validCondition(c.requires))issue('condition',`/connections/${c.id}/requires`,'连接条件必须为OR-of-AND字符串数组');else if(c.requires?.some(g=>g.some(t=>['H','W','D','Q'].includes(t))))issue('door_ability',`/connections/${c.id}/requires`,'移动能力锁须由房内环境路线表达');}
 const actions=new Set();
 for(const reward of Object.values(p.rewards||{})){
  if(actions.has(reward.action_id))issue('reward_receipt',`/rewards/${reward.id}`,'永久奖励身份重复');if(reward.action_id)actions.add(reward.action_id);
  if(reward.host){const hit=entities.get(reward.host),root=p.rooms[reward.room];const rootHost=reward.host===reward.room+':root'&&reward.host_field&&point(root?.root.properties[reward.host_field]);if(!rootHost&&(!hit||hit.room.id!==reward.room))issue('reward_host',`/rewards/${reward.id}`,'奖励缺少唯一实际宿主');if(hit&&hit.entity.properties.action_id!==reward.action_id)issue('reward_action',`/rewards/${reward.id}`,'奖励身份与实际宿主不一致');}
  else if(reward.physical)issue('reward_host',`/rewards/${reward.id}`,'地图奖励缺少实际宿主');
  if(reward.quantity!==undefined&&(!Number.isInteger(reward.quantity)||reward.quantity<1))issue('reward_quantity',`/rewards/${reward.id}/quantity`,'奖励数量必须为正整数');
 }
 for(const npc of Object.values(p.npcs||{})){if(npc.host){const hit=entities.get(npc.host);if(!hit||hit.room.id!==npc.room_id||hit.entity.properties.npc_id!==npc.id)issue('npc_host',`/npcs/${npc.id}`,'NPC身份、房间与实际宿主不一致');}}
 return issues;
}
function validCondition(value){return Array.isArray(value)&&value.every(g=>Array.isArray(g)&&g.every(x=>typeof x==='string'&&x.length>0));}
export function projectStats(p){return {rooms:Object.keys(p.rooms).length,connections:Object.keys(p.connections).length,rewards:Object.keys(p.rewards).length,regions:new Set(Object.values(p.rooms).map(r=>r.region)).size};}
