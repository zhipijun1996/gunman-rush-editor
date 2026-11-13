/** The game catalog owns definitions and port types. These functions only edit data. */
import {sha256} from '@noble/hashes/sha2.js';
import {assert,clone,id,entityPosition,entityWithPosition,point,rect,finite} from './model.mjs';
const nodeName=eid=>'Element_'+Array.from(sha256(new TextEncoder().encode(eid)),b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
const esc=s=>s.replaceAll('~','~0').replaceAll('/','~1');
const path=(room,eid)=>`/rooms/${esc(room)}/entities/${esc(eid)}`;

export function instantiateElement(project,roomId,definitionId,position,instanceId=id('element')) {
 const room=project.rooms[roomId],catalog=project.catalog.elements,definition=catalog?.definitions[definitionId];
 assert(room&&definition&&point(position),'definition','要素定义或放置位置无效');
 const members=definition.members||[{id:'',definition:definitionId,offset:[0,0]}],entities={};
 for(const member of members){
  const d=catalog.definitions[member.definition];assert(d&&!d.members,'definition','组合必须引用已登记的单个要素');
  const eid=member.id?instanceId+'/'+member.id:instanceId,p={...clone(d.defaults||{}),...clone(member.properties||{})},at=position.map((v,i)=>v+(member.offset?.[i]||0)),field=d.position_field||'position';
  if(['rect','bounds'].includes(field))p[field]=[...at,...p[field].slice(2)];else p[field]=at;
  const e={id:eid,component:d.component,definition_id:member.definition,definition_version:d.version,order:Object.keys(room.entities).length+Object.keys(entities).length,properties:p};
  if(definition.members)e.assembly_id=instanceId;
  if(!d.component.startsWith('array:')){e.node_name=nodeName(eid);e.parent='';if(catalog.behaviors[d.component]?.state)p.element_id=eid;}
  else if(!['array:platforms','array:hook_points','array:climbable_walls','array:hazards'].includes(d.component))p.id=eid;
  assert(!room.entities[eid],'identity','实例ID已存在');entities[eid]=e;
 }
 for(const link of definition.links||[]){const p=entities[instanceId+'/'+link.source].properties;p.links||=[];p.links.push({output:link.output||'active',input:link.input||'set_active',target:instanceId+'/'+link.target});}
 return Object.values(entities).map(value=>({op:'add',path:path(roomId,value.id),value}));
}

export function validateElements(room,catalog,surfaceStyles) {
 const issues=[],add=(code,id,message)=>issues.push({code,path:path(room.id,id),message,severity:'error'}),rows=room.entities||{};
 for(const [eid,e] of Object.entries(rows)){
  if(e.definition_id){const d=catalog?.definitions?.[e.definition_id];if(!d||d.component!==e.component||d.version!==(e.definition_version??1))add('definition',eid,'要素定义或版本与运行包不匹配');}
  const behavior=catalog?.behaviors?.[e.component],p=e.properties||{};
  if(behavior?.state&&p.element_id!==eid)add('element_identity',eid,'运行身份必须等于实例ID');
  for(const [key,spec] of Object.entries(behavior?.fields||{})){
   const v=p[key];if(v===undefined){if(spec.required)add('field_missing',eid,'缺少参数：'+key);continue;}
   const valid={number:()=>finite(v)&&(spec.min===undefined||v>=spec.min),bool:()=>typeof v==='boolean',string:()=>typeof v==='string',point:()=>point(v)&&(spec.min_component===undefined||v.every(n=>n>=spec.min_component)),rect:()=>rect(v),points:()=>Array.isArray(v)&&v.every(point)}[spec.type];
   if(valid&&!valid()||spec.choices&&!spec.choices.includes(v))add('element_parameter',eid,'参数不合法：'+key);
  }
  if(p.links!==undefined&&!Array.isArray(p.links)){add('signal',eid,'信号连接必须是数组');continue;}
  const seen=new Set();for(const link of p.links||[]){const target=rows[link?.target],receiver=catalog?.behaviors?.[target?.component],output=behavior?.outputs?.[link?.output||'active'],input=receiver?.inputs?.[link?.input||'set_active'];
   if(!output||output!==input)add('signal',eid,'信号目标不存在或端口类型不兼容');
   if(target&&(p.state_scope||'permanent')!==(target.properties.state_scope||'permanent'))add('signal_scope',eid,'相连机关的状态生命周期必须一致');
   const key=link?.target+':'+(link?.output||'active');if(seen.has(key))add('signal_duplicate',eid,'同一信号连接重复');seen.add(key);
  }
  if(p.drive_id&&!catalog?.behaviors?.[rows[p.drive_id]?.component]?.clock)add('drive',eid,'运动时钟来源不存在');
  if(p.host_id&&!rows[p.host_id])add('host',eid,'附着宿主不存在');
  if(e.component==='array:spike_strips'){
   if(p.appearance&&(!surfaceStyles?.styles[p.appearance]||!surfaceStyles.styles[p.appearance].faces.includes(p.facing)))add('surface_style',eid,'危险外观不存在或不支持此朝向');
   if(p.host_id&&rows[p.host_id]){const h=rows[p.host_id];if(h.component!=='array:platforms'||h.properties.one_way||!spikeAttached(p,h.properties.rect))add('attachment',eid,'危险必须贴合实体宿主表面，请同步调整尺寸');}
  }
  if(p.surface_platform_id&&rows[p.surface_platform_id]?.component!=='array:platforms')add('surface_host',eid,'平台饰面宿主不存在');
  for(const host of p.facing_platform_ids||[])if(rows[host]?.component!=='array:platforms')add('facing_host',eid,'建筑实体引用不存在');
 }
 const visit=(eid,active,done)=>{if(active.has(eid))return true;if(done.has(eid)||!rows[eid])return false;active.add(eid);for(const link of (Array.isArray(rows[eid].properties?.links)?rows[eid].properties.links:[]))if(visit(link?.target,active,done))return true;active.delete(eid);done.add(eid);return false;};
 for(const eid of Object.keys(rows))if(visit(eid,new Set(),new Set())){add('signal_cycle',eid,'信号连接不能形成即时循环');break;}
 return issues;
}

export function linkElements(project,roomId,sourceId,targetId,input='set_active',output='active') {
 const source=clone(project.rooms[roomId].entities[sourceId]);assert(source,'source','发送者不存在');
 source.properties.links||=[];source.properties.links.push({target:targetId,input,output});
 return [{op:'replace',path:path(roomId,sourceId),value:source}];
}

export function moveElement(project,roomId,entityId,position) {
 const rows=project.rooms[roomId].entities,e=rows[entityId],old=entityPosition(e),delta=position.map((v,i)=>v-old[i]);
 const group=new Set(Object.values(rows).filter(r=>r.id===entityId||(e.assembly_id&&r.assembly_id===e.assembly_id)).map(r=>r.id));
 let changed=true;while(changed){changed=false;for(const r of Object.values(rows))if(group.has(r.properties?.host_id)&&!group.has(r.id)){group.add(r.id);changed=true;}}
 return [...group].map(eid=>{const original=rows[eid],pos=entityPosition(original),value=entityWithPosition(original,pos.map((v,i)=>v+delta[i]));
  if(value.properties.access_points)value.properties.access_points=value.properties.access_points.map(pt=>pt.map((v,i)=>v+delta[i]));
  return {op:'replace',path:path(roomId,eid),value};});
}

export function setElementField(project,roomId,entityId,key,value){
 const rows=project.rooms[roomId].entities,updated=new Map(),source=clone(rows[entityId]);source.properties[key]=value;updated.set(entityId,source);
 if(key==='state_scope'||key==='duration'&&value>0){
  const scope=key==='state_scope'?value:'attempt',connected=new Set([entityId]);let changed=true;
  while(changed){changed=false;for(const e of Object.values(rows))for(const link of e.properties.links||[])if(connected.has(e.id)||connected.has(link.target)){for(const eid of [e.id,link.target])if(!connected.has(eid)){connected.add(eid);changed=true;}}}
  for(const eid of connected){const e=updated.get(eid)||clone(rows[eid]);e.properties.state_scope=scope;updated.set(eid,e);}
 }
 return [...updated.values()].map(value=>({op:'replace',path:path(roomId,value.id),value}));
}

export function duplicateElements(project,roomId,entityIds,offset=[32,32]) {
 const rows=project.rooms[roomId].entities,selected=new Set(entityIds);
 for(const eid of entityIds){const group=rows[eid]?.assembly_id;if(group)for(const r of Object.values(rows))if(r.assembly_id===group)selected.add(r.id);}
 let expanded=true;while(expanded){expanded=false;for(const e of Object.values(rows))if(selected.has(e.properties?.host_id)&&!selected.has(e.id)){selected.add(e.id);expanded=true;}}
 const remap=Object.fromEntries([...selected].map(eid=>[eid,id('element')])),groups={};
 return [...selected].map(eid=>{const old=rows[eid],value=entityWithPosition(old,entityPosition(old).map((v,i)=>v+offset[i]));value.id=remap[eid];
  if(value.properties.element_id)value.properties.element_id=value.id;if(value.properties.id)value.properties.id=value.id;
  if(value.node_name){value.node_name=nodeName(value.id);delete value.node_path;}
  if(value.assembly_id)value.assembly_id=groups[value.assembly_id]||=(id('assembly'));
  value.parent=remap[value.parent]||value.parent;
  for(const link of value.properties.links||[])link.target=remap[link.target]||link.target;
  for(const key of ['drive_id','host_id','surface_platform_id'])if(value.properties[key])value.properties[key]=remap[value.properties[key]]||value.properties[key];
  if(value.properties.facing_platform_ids)value.properties.facing_platform_ids=value.properties.facing_platform_ids.map(ref=>remap[ref]||ref);
  if(value.properties.access_points)value.properties.access_points=value.properties.access_points.map(pt=>pt.map((v,i)=>v+offset[i]));
  return {op:'add',path:path(roomId,value.id),value};});
}

export function paintMaterial(project,roomId,bounds,materialId) {
 assert(rect(bounds)&&bounds.every(Number.isInteger),'paint','材质区域须为整数且尺寸为正');
 assert(project.catalog.terrain_materials?.materials?.[materialId],'material','材质尚未登记');
 const root=clone(project.rooms[roomId].root);root.properties.terrain_paint||={version:1,seed:0,regions:[],surfaces:[]};
 root.properties.terrain_paint.regions.push({id:id('paint'),material_id:materialId,bounds,priority:1+Math.max(0,...root.properties.terrain_paint.regions.map(r=>r.priority||0))});
 return [{op:'replace',path:`/rooms/${esc(roomId)}/root`,value:root}];
}

export function attachSpikes(project,roomId,hostId,facing='up',length=96,depth=24) {
 const host=project.rooms[roomId].entities[hostId],r=host?.properties.rect;
 assert(rect(r)&&host.component==='array:platforms'&&!host.properties.one_way,'host','请选择真实实体平台作为支撑面');
 const [x,y,w,h]=r,horizontal=['up','down'].includes(facing),span=Math.min(length,horizontal?w:h);
 const bounds={up:[x,y-depth,span,depth],down:[x,y+h,span,depth],left:[x-depth,y,depth,span],right:[x+w,y,depth,span]}[facing];
 const ops=instantiateElement(project,roomId,'hazard.spikes',bounds.slice(0,2));
 Object.assign(ops[0].value.properties,{bounds,facing,host_id:hostId});return ops;
}

function spikeAttached(p,h){
 if(!rect(p.bounds)||!rect(h))return false;
 const [x,y,w,d]=p.bounds,[a,b,c,f]=h;
 return {up:Math.abs(y+d-b)<.01&&x>=a&&x+w<=a+c,down:Math.abs(y-b-f)<.01&&x>=a&&x+w<=a+c,left:Math.abs(x+w-a)<.01&&y>=b&&y+d<=b+f,right:Math.abs(x-a-c)<.01&&y>=b&&y+d<=b+f}[p.facing]||false;
}
export function removeElements(project,roomId,entityIds){
 const rows=project.rooms[roomId].entities,selected=new Set(entityIds);
 for(const eid of entityIds){const group=rows[eid]?.assembly_id;if(group)for(const e of Object.values(rows))if(e.assembly_id===group)selected.add(e.id);}
 let changed=true;while(changed){changed=false;for(const e of Object.values(rows))if(selected.has(e.properties?.host_id)&&!selected.has(e.id)){selected.add(e.id);changed=true;}}
 // External references are deliberately left for the transaction validator to
 // reject. Deleting a connected target must not silently rewire other sources.
 return [...selected].map(eid=>({op:'remove',path:path(roomId,eid)}));
}

export function terrainPaintError(paint,catalog){
 if(paint===undefined||paint&&typeof paint==='object'&&!Array.isArray(paint)&&!Object.keys(paint).length)return '';
 const int=v=>Number.isInteger(v)&&Math.abs(v)<=1000000;
 if(!paint||Array.isArray(paint)||paint.version!==1)return '材质覆盖版本无效';
 if(Object.keys(paint).some(k=>!['version','seed','regions','surfaces'].includes(k))||!int(paint.seed??0))return '材质覆盖字段或种子无效';
 const ids=new Set();
 for(const field of ['regions','surfaces']){
  if(!Array.isArray(paint[field]??[]))return '材质记录必须是数组';
  for(const row of paint[field]||[]){
   if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id))return '材质记录身份缺失或重复';ids.add(row.id);
   if(!rect(row.bounds)||!row.bounds.every(int)||!int(row.priority??0))return '材质区域须为整数像素且尺寸为正';
   const allowed=field==='regions'?['id','bounds','priority','material_id']:['id','bounds','priority','surface_id','material_id','facing'];
   if(Object.keys(row).some(k=>!allowed.includes(k)))return '未知材质记录字段';
   if((field==='regions'||row.surface_id==='material')&&!catalog?.materials?.[row.material_id])return '材质尚未登记';
   if(field==='surfaces'&&(!['bare','material'].includes(row.surface_id)||!['up','down','left','right'].includes(row.facing)))return '表面类型或方向无效';
  }
 }
 return '';
}
