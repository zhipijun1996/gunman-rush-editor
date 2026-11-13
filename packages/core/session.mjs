export const SESSION_KEY='editor-session-v1';
export const clampSplit=value=>Math.max(.28,Math.min(.75,Number(value)||.54));
export function readSession(storage=globalThis.localStorage) {
  try{return JSON.parse(storage.getItem(SESSION_KEY))||{};}catch{return {};}
}
export function writeSession(patch,storage=globalThis.localStorage) {
  try{storage.setItem(SESSION_KEY,JSON.stringify({...readSession(storage),...patch}));return true;}catch{return false;}
}
export const viewKey=({roomId,region,layer,showPlanned})=>[roomId||'world',region||'',layer||'world',!!showPlanned].join('|');
