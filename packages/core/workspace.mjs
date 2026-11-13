import {assert,canonical,clone,SCHEMA,validateProject} from './model.mjs';
import {readPath,pathParts,applyTransaction} from './transactions.mjs';

const esc = key => key.replaceAll('~','~0').replaceAll('/','~1');
const maps = ['rooms','connections','rewards','npcs','management'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
// Arrays are atomic: their indexes are not stable identities. Objects are diffed to
// leaves so undoing an AI task cannot erase an unrelated manual edit in that room.
export function projectChanges(before,after) {
  const changes=[];
  function visit(a,b,path) {
    if(a===b || canonical(a)===canonical(b)) return;
    if(object(a)&&object(b)) for(const key of new Set([...Object.keys(a),...Object.keys(b)])) visit(a[key],b[key],path+'/'+esc(key));
    else changes.push({path,before:clone(a),after:clone(b)});
  }
  for(const key of maps) visit(before[key],after[key],'/'+key);
  return changes;
}
export function commitWorkspace(workspace,next,label,taskId=null) {
  const changes=projectChanges(workspace.project,next);
  if(!changes.length)return workspace;
  return {...workspace,project:next,history:[...(workspace.history||[]),{label,taskId,changes}].slice(-80),redo:[]};
}
function restore(project,changes,redo) {
  const expected=redo?'before':'after',target=redo?'after':'before';
  const conflicts=changes.filter(c=>canonical(readPath(project,c.path))!==canonical(c[expected]));
  assert(!conflicts.length,'undo_conflict','这些内容在任务后已修改，未撤销任何内容',{conflicts:conflicts.map(c=>c.path)});
  // Reuse transaction validation and lock checks; management is human-only metadata.
  const design=changes.filter(c=>pathParts(c.path)[0]!=='management');
  let next=project;
  if(design.length) next=applyTransaction(project,{base_revision:project.revision,operations:design.map(c=>({op:c[target]===undefined?'remove':readPath(project,c.path)===undefined?'add':'replace',path:c.path,...(c[target]!==undefined?{value:c[target]}:{})}))}).project;
  next={...next,revision:project.revision+1,management:clone(next.management)};
  for(const c of changes.filter(c=>pathParts(c.path)[0]==='management')) {
    assert(!(project.locks||[]).some(lock=>c.path===lock||c.path.startsWith(lock+'/')||lock.startsWith(c.path+'/')),'locked','撤销涉及已锁定内容');
    const parts=pathParts(c.path).slice(1);let parent=next.management;
    for(const part of parts.slice(0,-1))parent=parent[part]??={};
    if(c[target]===undefined)delete parent[parts.at(-1)];else parent[parts.at(-1)]=clone(c[target]);
  }
  return next;
}
export function undoWorkspace(workspace,redo=false) {
  const history=(workspace.history||[]),forward=(workspace.redo||[]),stack=redo?forward:history,item=stack.at(-1);
  if(!item)return workspace;
  const project=restore(workspace.project,item.changes,redo);
  return {...workspace,project,history:redo?[...history,item]:history.slice(0,-1),redo:redo?forward.slice(0,-1):[...forward,item]};
}
export function undoTask(workspace,taskId) {
  const history=(workspace.history||[]),items=history.filter(h=>h.taskId===taskId);
  const expected=workspace.tasks?.find(t=>t.id===taskId)?.changes?.length;
  assert(expected===undefined||items.length===expected,'undo_missing','部分任务历史已过期或已单独撤销，未撤销任何内容');
  assert(items.length,'undo_missing','本任务修改已撤销或超出可撤销历史');
  // Build a net diff from reversing the task in reverse chronological order.
  // Each reverse validates before doing anything to the persisted workspace.
  let next=workspace.project;
  for(const item of [...items].reverse())next=restore(next,item.changes,false);
  return {...workspace,project:next,history:[...history.filter(h=>h.taskId!==taskId),{label:'撤销AI任务',changes:projectChanges(workspace.project,next)}],redo:[],tasks:(workspace.tasks||[]).map(t=>t.id===taskId?{...t,status:'undone'}:t)};
}

export function resolveScope(project,scope) {
  if(Array.isArray(scope))return {kind:'selection',rooms:scope};
  if(scope?.kind==='world')return {kind:'world',rooms:Object.keys(project.rooms)};
  if(scope?.kind==='region')return {kind:'region',region:scope.region,rooms:Object.values(project.rooms).filter(r=>r.region===scope.region).map(r=>r.id)};
  return {kind:scope?.kind||'room',rooms:(scope?.rooms||[]).filter(id=>project.rooms[id])};
}
export function scopeForOperations(project,scope,operations) {
  const resolved=resolveScope(project,scope),allowed=new Set(resolved.rooms),neighbors=new Set();
  if(resolved.kind==='world')return {rooms:undefined,neighbors:[]};
  for(const op of operations) {
    const [map,rid,field,portId]=pathParts(op.path);
    if(['rewards','npcs'].includes(map)) {
      const original=project[map][rid],owner=map==='rewards'?'room':'room_id';
      const destination=field===owner?op.value:!field&&op.op!=='remove'?op.value?.[owner]:original?.[owner];
      assert([original?.[owner],destination].filter(Boolean).every(id=>allowed.has(id)),'scope','奖励或NPC迁移超出明确范围');
    }
    if(map==='connections') {
      const ends=[project.connections[rid],!field&&op.op!=='remove'?op.value:null].filter(Boolean).flatMap(c=>[c.a?.room,c.b?.room]);
      assert(ends.some(id=>allowed.has(id)),'scope','连接不属于明确范围');
    }
    if(map!=='rooms'||allowed.has(rid))continue;
    if(!project.rooms[rid]&&op.op==='add'&&resolved.kind==='region'&&op.value?.region===resolved.region){allowed.add(rid);continue;}
    // Permission to fix a shared doorway never grants permission to redesign its
    // neighbor. A new/changed port must still connect to the explicit scope.
    assert(field==='ports'&&portId,'scope','修改超出明确范围，邻房只允许关联门对联动');
    const port=op.op==='remove'?project.rooms[rid]?.ports?.[portId]:op.value;
    const target=port?.target_room;
    const original=project.rooms[rid]?.ports?.[portId];
    assert(resolved.rooms.includes(target)||resolved.rooms.includes(original?.target_room),'scope','邻房端口不属于当前门对');
    neighbors.add(rid);
  }
  return {rooms:[...allowed,...neighbors],neighbors:[...neighbors]};
}

export const WORKSPACE_VERSION=1;
export function freshWorkspace(project,bundleIdentity=null) {
  assert(project?.schema===SCHEMA&&project.catalog?.elements,'workspace_format','只支持当前版本的世界项目，不转换旧格式');
  const issues=validateProject(project).filter(i=>i.severity==='error');
  assert(!issues.length,'invalid_design','新项目未通过校验，当前内容未改变',{issues});
  return {editor_state_version:WORKSPACE_VERSION,bundle_identity:bundleIdentity,project:clone(project),baseline:clone(project),history:[],redo:[],tasks:[],candidates:[]};
}
