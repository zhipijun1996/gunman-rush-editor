import {canonical} from './model.mjs';
export const sectionKey=(room,section)=>canonical([room,section]);
export function conditionMet(groups,tokens){if(!Array.isArray(groups))return null;if(groups.some(g=>!Array.isArray(g)||g.some(x=>typeof x!=='string')))return null;return groups.some(g=>g.every(x=>tokens.has(x)));}
export function missingConditions(groups,tokens){if(!Array.isArray(groups)||groups.some(g=>!Array.isArray(g)))return [['未定义条件']];return groups.map(g=>g.filter(x=>!tokens.has(x))).filter(g=>g.length).sort((a,b)=>a.length-b.length);}
/** Pure logical graph. No implicit pickup, physics inference or room-wide teleport. */
export function analyseReachability(project,{room,section='main',tokens=[],honorConditions=true}={}){
 const abilities=new Set(tokens),nodes=new Map(),edges=[],adj=new Map();
 for(const r of Object.values(project.rooms))for(const s of Object.values(r.sections||{})){const k=sectionKey(r.id,s.id);nodes.set(k,{room:r.id,section:s.id,known:s.known!==false});adj.set(k,[]);}
 const add=(from,to,requires,details)=>{const edge={from,to,requires,...details};edges.push(edge);if(adj.has(from))adj.get(from).push(edge);};
 for(const r of Object.values(project.rooms))for(const path of Object.values(r.routes||{})){
  add(sectionKey(r.id,path.from),sectionKey(r.id,path.to),path.requires,{id:path.id,kind:'internal',room:r.id,known:path.known!==false});
  if(path.bidirectional)add(sectionKey(r.id,path.to),sectionKey(r.id,path.from),path.reverse_requires??path.requires,{id:path.id+':return',kind:'internal',room:r.id,known:path.known!==false});
 }
 for(const c of Object.values(project.connections)){
  const ar=project.rooms[c.a.room],br=project.rooms[c.b.room],a=ar?.ports[c.a.port],b=br?.ports[c.b.port];if(!a||!b)continue;
  const ak=sectionKey(ar.id,a.section),bk=sectionKey(br.id,b.section);
  if(c.direction!=='b_to_a')add(ak,bk,c.requires,{id:c.id,kind:'connection',known:c.known!==false});
  if(c.direction!=='a_to_b')add(bk,ak,c.reverse_requires??c.requires,{id:c.id+':return',kind:'connection',known:c.known!==false});
 }
 const start=sectionKey(room,section),reachable=new Set(),possible=new Set(),queue=[];
 if(nodes.has(start)){reachable.add(start);queue.push(start);}
 for(let i=0;i<queue.length;i++)for(const e of adj.get(queue[i])||[]){if(!nodes.has(e.to))continue;const pass=honorConditions?conditionMet(e.requires,abilities):true;if(pass===true&&e.known&&nodes.get(e.to).known&&!reachable.has(e.to)){reachable.add(e.to);queue.push(e.to);}}
 // Unknown can propagate only along a potential traversable route, never across a known lock.
 const pq=[...reachable];pq.forEach(k=>possible.add(k));
 for(let i=0;i<pq.length;i++)for(const e of adj.get(pq[i])||[]){if(!nodes.has(e.to)||possible.has(e.to))continue;const pass=honorConditions?conditionMet(e.requires,abilities):true;if(pass!==false){possible.add(e.to);pq.push(e.to);}}
 const sections=Object.fromEntries([...nodes].map(([k,n])=>[k,{...n,status:reachable.has(k)?'reachable':possible.has(k)?'unknown':'unreachable'}]));
 const rooms={};for(const r of Object.values(project.rooms)){const values=Object.values(r.sections||{}).map(s=>sections[sectionKey(r.id,s.id)]?.status);rooms[r.id]=values.length&&values.every(v=>v==='reachable')?'reachable':values.some(v=>v==='reachable')?'partial':values.some(v=>v==='unknown')?'unknown':'unreachable';}
 const blocked=edges.filter(e=>reachable.has(e.from)&&!reachable.has(e.to)).map(e=>({...e,missing:missingConditions(e.requires,abilities),unknown:!e.known||conditionMet(e.requires,abilities)===null}));
 return {rooms,sections,blocked,reachable:[...reachable],tokens:[...abilities],start,logicalOnly:true};
}
