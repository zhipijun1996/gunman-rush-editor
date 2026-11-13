import React,{useRef} from 'react';
import {clampSplit} from '../../../packages/core/session.mjs';
export default function Splitter({ratio,onChange}) {
  const start=useRef(null);
  return <div className="splitter" role="separator" aria-label="调整画布与操作面板比例" aria-orientation="horizontal" aria-valuemin={28} aria-valuemax={75} aria-valuenow={Math.round(ratio*100)} tabIndex={0}
    onKeyDown={e=>{if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();onChange(e.key==='Home'?.28:e.key==='End'?.75:clampSplit(ratio+(e.key==='ArrowDown'?.04:-.04)));}}}
    onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);start.current=e.currentTarget.parentElement.getBoundingClientRect();}}
    onPointerMove={e=>{if(start.current)onChange(clampSplit((e.clientY-start.current.top)/start.current.height));}}
    onPointerUp={()=>{start.current=null;}} onPointerCancel={()=>{start.current=null;}}><span/></div>;
}
