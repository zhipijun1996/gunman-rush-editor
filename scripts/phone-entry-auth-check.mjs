import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const project=JSON.parse(await readFile('apps/editor/public/project.json','utf8'));
await mkdir('build/auth-room',{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,recordVideo:{dir:'build/auth-room',size:{width:390,height:844}}});
await context.addInitScript(()=>{
 const saved=JSON.parse(localStorage.getItem('test-auth-state')||'null');
 const auth=window.__authTest={connected:saved?.connected||false,busy:false,can_retry:false,step:'idle',login:0,retry:0};
 window.GunmanNative={request(raw){const req=JSON.parse(raw);let result={};
  if(req.method==='auth.status')result={...auth};
  if(req.method==='auth.signIn'){
   auth.login++;auth.can_retry=true;auth.step='identity';auth.last_error='校验登录身份失败 [NETWORK_TIMEOUT_OR_UNAVAILABLE]';
   auth.diagnostic={step:'identity',code:'NETWORK_TIMEOUT_OR_UNAVAILABLE',retryable:true};
   setTimeout(()=>window.__gunmanNativeResult({request_id:req.request_id,error:auth.last_error}),50);return;
  }
  if(req.method==='auth.retry'){auth.retry++;auth.connected=true;auth.can_retry=false;auth.step='connected';delete auth.last_error;delete auth.diagnostic;localStorage.setItem('test-auth-state',JSON.stringify(auth));}
  if(req.method==='ai.models')result=[{slug:'test-model',display_name:'界面验证模拟模型'}];
  setTimeout(()=>window.__gunmanNativeResult({request_id:req.request_id,result}),20);
 }};
});
const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5173');await page.getByText('房间目录',{exact:true}).waitFor();
 await page.addStyleTag({content:`body::after{content:'手机触摸交互验证 · 授权界面为模拟桥接';position:fixed;bottom:2px;left:4px;z-index:99;background:#142027dd;color:#dec58a;font:10px sans-serif;padding:3px;pointer-events:none}`});
 await page.getByLabel('地图视图').selectOption('physical');await page.getByLabel('区域',{exact:true}).selectOption('P');
 const canvas=page.getByLabel('世界与房间编辑画布');await canvas.waitFor();await page.waitForTimeout(300);
 async function pixel(point){return page.evaluate(point=>{
  const session=JSON.parse(localStorage.getItem('editor-session-v1')),canvas=document.querySelector('canvas'),rect=canvas.getBoundingClientRect();
  const key=[session.roomId||'world',session.region||'',session.layer||'world',false].join('|'),v=session.views[key];
  return {x:rect.x+rect.width/2+(point[0]-v.x)*v.z,y:rect.y+rect.height/2+(point[1]-v.y)*v.z};
 },point);}
 const room=project.rooms['P-R03'],space=room.spaces[0],point=[room.origin[0]+space[0]+space[2]*.2,room.origin[1]+space[1]+space[3]*.5];
 const target=await pixel(point);await page.touchscreen.tap(target.x,target.y);
 await page.getByRole('heading',{name:'房内元素',exact:true}).waitFor();assert.ok((await page.locator('.breadcrumbs').innerText()).includes('P-R03'));
 await page.screenshot({path:'build/auth-room/phone-room-entry.png'});await page.waitForTimeout(700);
 await page.getByLabel('快速添加').selectOption('platform.solid');
 const selected=await page.getByLabel('选择实例').inputValue();assert.ok(selected);
 const insertedPosition=[Number(await page.locator('.entity-card').getByLabel('X',{exact:true}).inputValue()),Number(await page.locator('.entity-card').getByLabel('Y',{exact:true}).inputValue())];
 await page.getByRole('button',{name:'房间',exact:true}).click();
 // Touch the newly added platform to reopen its properties, without a double click.
 const at=await pixel([room.origin[0]+insertedPosition[0]+80,room.origin[1]+insertedPosition[1]+32]);
 await page.touchscreen.tap(at.x,at.y);await page.getByRole('heading',{name:'房内元素',exact:true}).waitFor();
 assert.equal(await page.getByLabel('选择实例').inputValue(),selected);
 const width=page.locator('.quick-edit').getByLabel('宽',{exact:true});await width.fill('192');await width.blur();
 assert.equal(await width.inputValue(),'192');
 await page.waitForTimeout(200);const dragAt=await pixel([room.origin[0]+insertedPosition[0]+96,room.origin[1]+insertedPosition[1]+32]);
 await page.evaluate(()=>{window.__pointerLog=[];for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,e=>window.__pointerLog.push({type,x:e.clientX,y:e.clientY,tag:e.target.tagName}),true);});
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:dragAt.x,y:dragAt.y}]});
 for(let n=1;n<=8;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:dragAt.x+n*3,y:dragAt.y}]});await page.waitForTimeout(30);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(500);
 const saved=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('gunman-world-editor');open.onsuccess=()=>{const db=open.result,r=db.transaction('documents').objectStore('documents').get('workspace');r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=reject;};}));
 assert.equal(saved.project.rooms['P-R03'].entities[selected].properties.rect[2],192);
 await writeFile('build/auth-room/touch-drag.json',JSON.stringify({dragAt,rect:saved.project.rooms['P-R03'].entities[selected].properties.rect,events:await page.evaluate(()=>window.__pointerLog)},null,2));
 assert.notEqual(saved.project.rooms['P-R03'].entities[selected].properties.rect[0],insertedPosition[0]);
 assert.deepEqual(saved.project.rooms['P-R03'].origin,room.origin);
 await page.screenshot({path:'build/auth-room/phone-element-edit.png'});await page.waitForTimeout(700);
 await page.getByRole('button',{name:'AI',exact:true}).click();await page.getByRole('button',{name:'连接ChatGPT',exact:true}).click();
 await page.getByRole('button',{name:'重试身份核验',exact:true}).waitFor();await page.getByText('授权已收到，身份核验待重试',{exact:true}).waitFor();
 await page.getByText('连接诊断（不含凭据）',{exact:true}).click();
 await page.screenshot({path:'build/auth-room/phone-identity-retry.png'});await page.waitForTimeout(700);
 await page.getByRole('button',{name:'重试身份核验',exact:true}).click();await page.getByText('模型已连接，可以开始编辑',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__authTest.login),1);assert.equal(await page.evaluate(()=>window.__authTest.retry),1);
 await page.reload();await page.getByText('模型已连接，可以开始编辑',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__authTest.login),0);
 assert.deepEqual(errors,[]);const result={singleTouchRoomEntry:true,elementTouchOpensProperties:true,resizeAndTouchDragChangeEntityNotRoom:true,identityRetryWithoutAnotherAuthorization:true,accountRestored:true,pageErrors:errors,actualAndroidOrChatgptService:false};
 await writeFile('build/auth-room/browser-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){await page.screenshot({path:'build/auth-room/failure.png'});console.error(e);process.exitCode=1;}
finally{await context.close();await browser.close();}
