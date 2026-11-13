import {assert,clone,canonical} from './model.mjs';
/** Include paired ownership changes, but never publish other rooms' private drafts. */
export function freezeChange(baseline,project,selectedRooms){
 const scope=new Set(selectedRooms);assert(scope.size,'scope','请选择定稿范围');let advanced=true;
 const owners=(kind,v)=>!v?[]:kind==='connections'?[v.a.room,v.b.room]:[v.room||v.room_id];
 while(advanced){advanced=false;for(const rid of [...scope]){const before=baseline.rooms[rid],after=project.rooms[rid];if(canonical(before?.ports)===canonical(after?.ports))continue;for(const port of [...Object.values(before?.ports||{}),...Object.values(after?.ports||{})])if(port.target_room&&!scope.has(port.target_room)){scope.add(port.target_room);advanced=true;}}
 for(const kind of ['connections','rewards','npcs'])for(const key of new Set([...Object.keys(baseline[kind]),...Object.keys(project[kind])])){const old=baseline[kind][key],next=project[kind][key];if(canonical(old)===canonical(next))continue;const rooms=[...owners(kind,old),...owners(kind,next)].filter(Boolean);if(rooms.some(r=>scope.has(r)))for(const r of rooms)if(!scope.has(r)){scope.add(r);advanced=true;}}}
 const frozen=clone(baseline);for(const rid of scope){if(project.rooms[rid])frozen.rooms[rid]=clone(project.rooms[rid]);else delete frozen.rooms[rid];}
 for(const kind of ['connections','rewards','npcs'])for(const key of new Set([...Object.keys(baseline[kind]),...Object.keys(project[kind])]))if([...owners(kind,baseline[kind][key]),...owners(kind,project[kind][key])].some(r=>scope.has(r))){if(project[kind][key])frozen[kind][key]=clone(project[kind][key]);else delete frozen[kind][key];}
 frozen.revision=project.revision;frozen.source=clone(project.source);
 const clean=p=>{const copy=clone(p);copy.management={};copy.locks=[];for(const r of Object.values(copy.rooms))delete r.preview;return copy;};
 return {schema:2,source:clone(project.source),base:clean(baseline),project:clean(frozen),selected_rooms:[...scope],requested_rooms:selectedRooms};
}
