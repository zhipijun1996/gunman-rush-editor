const cache=new WeakMap();
/** Exposed edges of a rectangle union, excluding shared and overlapping seams. */
export function chamberEdges(rectangles){if(cache.has(rectangles))return cache.get(rectangles);const result=[];
 for(let i=0;i<rectangles.length;i++){const [x,y,w,h]=rectangles[i];for(const [axis,fixed,start,end,positive] of [['x',y,x,x+w,false],['x',y+h,x,x+w,true],['y',x,y,y+h,false],['y',x+w,y,y+h,true]]){let spans=[[start,end]];
  for(let j=0;j<rectangles.length;j++){if(i===j)continue;const [a,b,c,d]=rectangles[j],lo=axis==='x'?b:a,hi=axis==='x'?b+d:a+c;const covers=positive?lo<=fixed&&hi>fixed:lo<fixed&&hi>=fixed;if(!covers)continue;const cutStart=axis==='x'?a:b,cutEnd=axis==='x'?a+c:b+d;spans=spans.flatMap(([s,e])=>cutEnd<=s||cutStart>=e?[[s,e]]:[[s,Math.max(s,cutStart)],[Math.min(e,cutEnd),e]].filter(([l,r])=>r>l));}
  for(const [s,e] of spans)result.push(axis==='x'?[s,fixed,e,fixed]:[fixed,s,fixed,e]);
 }}cache.set(rectangles,result);return result;
}
