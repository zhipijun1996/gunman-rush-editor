import {canonical,assert,clone} from './model.mjs';
import {sha256} from '@noble/hashes/sha2.js';
export const DIMENSIONS=['art','gameplay','world'];
export const DEVELOPMENT=['unbuilt','developing','developed'];
export function reviewFingerprint(project,roomId){const {preview,implemented,authored,layout_status,source_scene,...room}=project.rooms[roomId];const content=canonical({room,connections:Object.values(project.connections).filter(c=>c.a.room===roomId||c.b.room===roomId),rewards:Object.values(project.rewards).filter(x=>x.room===roomId),motion:project.source.motion_hash,catalog:project.source.behavior_hash||project.source.content_version});return [...sha256(new TextEncoder().encode(content))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function managementView(project,roomId){const m=project.management[roomId]||{};const current=(m.review?.passed||Object.values(m.scores||{}).some(Boolean)||m.ai)?reviewFingerprint(project,roomId):null;return {...m,development:m.development||'unbuilt',review:m.review?.passed?(m.review.fingerprint===current?'passed':'needs_review'):'unreviewed',scores:Object.fromEntries(DIMENSIONS.map(k=>{const x=m.scores?.[k];return [k,x?{...x,stale:x.fingerprint!==current}:null]})),ai:m.ai?{...m.ai,stale:m.ai.fingerprint!==current}:null};}
export function setManagement(project,roomId,{development,scores,passed,note},actor='human'){
 assert(project.rooms[roomId],'room_missing','房间不存在');assert(actor==='human','human_only','正式评分和初审只接受用户明确决定');
 const p={...project,management:{...project.management}},m=clone(project.management[roomId]||{});p.management[roomId]=m;const fingerprint=reviewFingerprint(project,roomId);
 if(development!==undefined){assert(DEVELOPMENT.includes(development),'development','开发进度无效');m.development=development;}
 if(scores){m.scores||={};for(const [k,v] of Object.entries(scores)){assert(DIMENSIONS.includes(k)&&(v===null||Number.isInteger(v)&&v>=0&&v<=10),'score','评分必须为0到10的整数或未评分');m.scores[k]=v===null?null:{value:v,fingerprint,at:new Date().toISOString(),source:'human'};}}
 if(passed!==undefined)m.review={passed:!!passed,fingerprint,note:note||'',at:new Date().toISOString(),source:'human'};
 p.revision++;return p;
}
export function setAISuggestions(project,roomId,scores,reason){assert(project.rooms[roomId],'room_missing','房间不存在');for(const v of Object.values(scores))assert(Number.isInteger(v)&&v>=0&&v<=10,'score','AI建议分无效');const p=clone(project);p.management[roomId]||={};p.management[roomId].ai={scores,reason,fingerprint:reviewFingerprint(project,roomId),source:'ai',at:new Date().toISOString()};p.revision++;return p;}
