import {canonical} from './model.mjs';
import {sha256} from '@noble/hashes/sha2.js';
const cache=new WeakMap();
export function roomVisualSignature(room){if(cache.has(room))return cache.get(room);const text=canonical({bounds:room.bounds,spaces:room.spaces,entities:room.entities,root:room.root,ports:room.ports,camera:room.camera});const result=[...sha256(new TextEncoder().encode(text))].map(v=>v.toString(16).padStart(2,'0')).join('');cache.set(room,result);return result;}
