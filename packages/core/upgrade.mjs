/** One-time schema 3 workspace conversion. Runtime only accepts schema 3. */
import {clone,assert} from './model.mjs';
const esc=s=>s.replaceAll('~','~0').replaceAll('/','~1');
const nonempty=v=>v!==undefined&&v!==null&&(Array.isArray(v)?v.some(Boolean):typeof v==='object'?Object.keys(v).length>0:!!v);
function featurePresent(id,p){
 if(id==='story.intro')return ['intro_sequence','onboarding','tutorial_action'].some(k=>nonempty(p[k]));
 if(id==='encounter.windkeeper'||id==='encounter.bellstrider')return JSON.stringify(p.boss_binding||'').includes(id.split('.')[1]);
 return {'recovery.station':nonempty(p.rest_point),'reward.host':nonempty(p.reward_action),'encounter.waves':nonempty(p.wave_encounter),'story.sequence':nonempty(p.story_sequence)}[id]||false;
}
function upgradeRoom(room,catalog){
 if(!room)return room;const r=clone(room),p=r.root.properties;
 for(const [did,d] of Object.entries(catalog.definitions))if(d.room_bindings&&featurePresent(did,p)){
  const eid=r.id+(did==='reward.host'?':root':':feature:'+did),parameters={};let position=[0,0];
  for(const [field,binding] of Object.entries(d.room_bindings)){if(binding.parameter&&Object.hasOwn(p,field))parameters[binding.parameter]=clone(p[field]);if(binding.position&&p[field])position=clone(p[field]);}
  assert(!r.entities[eid],'upgrade_identity','升级宿主ID与现有实例冲突：'+eid);
  r.entities[eid]={id:eid,definition_id:did,definition_version:d.version,component:d.component,order:1000+Object.keys(r.entities).length,parent:'',properties:{position,parameters,rotation:0,scale:[1,1],z_index:0,visible:true,modulate:{$color:[1,1,1,1]}}};
 }
 for(const d of Object.values(catalog.definitions))for(const field of Object.keys(d.room_bindings||{}))delete p[field];
 if(r.root.component==='StarbridgeTrialRoom'){
  const eid=r.id+':feature:presentation.trial';r.entities[eid]={id:eid,definition_id:'presentation.trial',definition_version:1,component:'WorldTrialPresentation',order:2000,parent:'',properties:{position:[0,0],rotation:0,scale:[1,1],z_index:0,visible:true,modulate:{$color:[1,1,1,1]}}};r.root.component='FixedWorldRoom';
 }
 for(const e of [r.root,...Object.values(r.entities)]){
  e.definition_id||=e.component==='array:enemy_placements'?'enemy.'+e.properties.behavior:catalog.behaviors[e.component]?.default_definition;
  const d=catalog.definitions[e.definition_id];assert(d&&d.component===e.component,'upgrade_definition','无法迁移未登记实例：'+(e.id||r.id));e.definition_version=d.version;
  delete e.node_path;delete e.node_name;
 }
 return r;
}
function upgradeReward(value){if(!value)return value;const r=clone(value);delete r.host_field;return r;}
export function upgradeProject(project,catalog){
 if(project.schema===3)return clone(project);
 assert(project.schema===2&&catalog?.elements?.version===2,'upgrade_schema','需要当前游戏目录才能升级此项目；原稿保持不变');
 const p=clone(project),elements=catalog.elements;p.schema=3;p.source={...p.source,protocol:3};p.catalog={...p.catalog,elements:clone(elements),components:clone(catalog.components)};
 p.rooms=Object.fromEntries(Object.entries(p.rooms).map(([id,r])=>[id,upgradeRoom(r,elements)]));p.rewards=Object.fromEntries(Object.entries(p.rewards).map(([id,r])=>[id,upgradeReward(r)]));
 const locks=new Set(p.locks||[]);
 for(const lock of p.locks||[])for(const r of Object.values(p.rooms))for(const e of Object.values(r.entities)){
  const d=elements.definitions[e.definition_id];for(const [field,b] of Object.entries(d?.room_bindings||{})){
   const old=`/rooms/${esc(r.id)}/root/properties/${esc(field)}`;
   if(old===lock||old.startsWith(lock+'/'))locks.add(`/rooms/${esc(r.id)}/entities/${esc(e.id)}`);
   else if(lock.startsWith(old+'/')&&b.parameter)locks.add(`/rooms/${esc(r.id)}/entities/${esc(e.id)}/properties/parameters/${esc(b.parameter)}`+lock.slice(old.length));
  }
 }
 p.locks=[...locks];return p;
}
export function upgradeWorkspace(workspace,catalog){
 if(workspace.project.schema===3)return clone(workspace);
 const w=clone(workspace);w.project=upgradeProject(w.project,catalog);w.baseline=upgradeProject(w.baseline,catalog);
 for(const stack of [w.history||[],w.redo||[]])for(const item of stack)for(const change of item.changes||[]){
  if(change.map==='rooms'){change.before=upgradeRoom(change.before,catalog.elements);change.after=upgradeRoom(change.after,catalog.elements);}
  if(change.map==='rewards'){change.before=upgradeReward(change.before);change.after=upgradeReward(change.after);}
 }
 // Keep original candidate data for review. A candidate built against the old
 // structural paths must be regenerated, never silently applied to new hosts.
 for(const candidate of w.candidates||[])candidate.upgrade_required=true;
 w.migration={from:2,to:3,checkpoint:'checkpoint:before-schema3'};return w;
}
