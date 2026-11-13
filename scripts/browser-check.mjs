import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('build/workflow',{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,recordVideo:{dir:'build/workflow',size:{width:390,height:844}}});
await context.addInitScript(()=>{
 const state=window.__testNative={calls:[],round:0};
 window.GunmanNative={async request(raw){const req=JSON.parse(raw);state.calls.push(req.method);let result={};
  if(req.method==='auth.status')result={connected:localStorage.getItem('test-account')==='yes',email:'test@example.invalid'};
  if(req.method==='auth.signIn'){localStorage.setItem('test-account','yes');result={connected:true,email:'test@example.invalid'};}
  if(req.method==='auth.signOut'){localStorage.removeItem('test-account');result={connected:false};}
  if(req.method==='ai.models')result=[{slug:'test-model',display_name:'交互验证模拟模型'}];
  if(req.method==='ai.response'){
   const count=req.params.input.filter(x=>x.type==='function_call_output').length;
   let output=[];
   if(count===0)output=[{type:'function_call',name:'editor.get_rooms',call_id:'read',arguments:JSON.stringify({room_ids:['P-R03']})}];
   if(count===1)output=[{type:'function_call',name:'editor.submit_candidate',call_id:'edit',arguments:JSON.stringify({label:'更名测试',reason:'验证直接更新画布与撤销',operations:[{op:'replace',path:'/rooms/P-R03/name',value:'初行草坡 · AI修改'}]})}];
   if(count>=2)output=[{type:'message',content:[{type:'output_text',text:'已更新房间名称。'}]}];
   result={status:'completed',output};
  }
  if(req.method==='game.latest'){result=await fetch('./project.json').then(r=>r.json());result.rooms['P-R03'].name='新版初行草坡';result.source.content_version='test-update';}
  if(req.method==='runtime.ensure'&&state.failRuntime){setTimeout(()=>window.__gunmanNativeResult({request_id:req.request_id,error:'模拟运行包准备失败'}),20);return;}
  if(req.method==='preview.open'){state.preview=req.params;result={started:true};}
  setTimeout(()=>window.__gunmanNativeResult({request_id:req.request_id,result}),req.method==='ai.response'?300:20);
 }};
});
const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
try{
await page.goto('http://127.0.0.1:5173');
await page.addStyleTag({content:`body::after{content:'交互验证：AI及试玩使用模拟桥接';position:fixed;bottom:2px;right:4px;z-index:99;background:#142027dd;color:#d9c68f;font:10px sans-serif;padding:3px;pointer-events:none}`});await page.getByText('房间目录',{exact:true}).waitFor();
await page.getByLabel('世界规划拓扑画布').waitFor();
await page.screenshot({path:'build/workflow/phone-world.png'});
await page.getByLabel('区域',{exact:true}).selectOption('F');await page.getByLabel('区域候选蓝图').waitFor();
await page.screenshot({path:'build/workflow/forest-blueprint.png'});
const separator=page.getByRole('separator');const box=await separator.boundingBox();
await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+70,{steps:12});await page.mouse.up();
const split=Number(await separator.getAttribute('aria-valuenow'));assert.ok(split>=60&&split<=70);
const beforeHide=await page.getByLabel('区域候选蓝图').boundingBox();await page.getByRole('button',{name:'面板',exact:true}).click();assert.ok((await page.getByLabel('区域候选蓝图').boundingBox()).height>beforeHide.height);await page.getByRole('button',{name:'面板',exact:true}).click();
await page.getByLabel('搜索房间').fill('P-R03'); // clear region before finding plains
await page.getByLabel('区域',{exact:true}).selectOption('');
await page.getByRole('button').filter({hasText:'P-R03'}).first().click();
await page.getByLabel('选择实例').waitFor();
const initialName=await page.getByText('房间名称',{exact:true}).locator('..').locator('input').inputValue();
await page.getByRole('button',{name:'AI',exact:true}).click();
await page.getByRole('button',{name:'连接ChatGPT',exact:true}).click();await page.getByText('模型已连接，可以开始编辑',{exact:true}).waitFor();
await page.getByLabel('AI修改目标').fill('把当前房间改名用于验证，保留布局。');
await page.getByRole('button',{name:'修改并更新画布',exact:true}).click();
await page.getByText('已更新房间名称。',{exact:true}).first().waitFor();
await page.getByRole('button',{name:'撤销本次任务',exact:true}).waitFor();
assert.ok(await page.locator('.breadcrumbs').innerText().then(t=>t.includes('AI修改')));
await page.screenshot({path:'build/workflow/phone-ai.png'});
// A later human edit in the same room must survive task undo.
await page.getByRole('button',{name:'编辑',exact:true}).click();
const purpose=page.getByText('一句话职责',{exact:true}).locator('..').locator('textarea');
await purpose.fill('人工保留的房间职责');await purpose.blur();
await page.getByRole('button',{name:'AI',exact:true}).click();
await page.getByRole('button',{name:'撤销本次任务',exact:true}).click();
await page.getByRole('button',{name:'编辑',exact:true}).click();
assert.equal(await page.getByText('房间名称',{exact:true}).locator('..').locator('input').inputValue(),initialName);
assert.equal(await page.getByText('一句话职责',{exact:true}).locator('..').locator('textarea').inputValue(),'人工保留的房间职责');
// Real pointer move/resize paths, not just editing numeric inputs.
await page.getByLabel('快速添加').selectOption('platform.solid');
await page.locator('.quick-edit').waitFor();
const canvas=page.getByLabel('世界与房间编辑画布');
const rect=await canvas.boundingBox();
await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+20,rect.y+rect.height/2+10,{steps:8});await page.mouse.up();
await page.mouse.wheel(0,-80);await page.waitForTimeout(300);
const sessionBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('editor-session-v1')));
await page.getByRole('button',{name:'试玩',exact:true}).click();
await page.waitForFunction(()=>window.__testNative.preview?.room_id==='P-R03');
await page.evaluate(()=>window.dispatchEvent(new Event('gunman:resume')));
await page.waitForTimeout(300);
assert.deepEqual((await page.evaluate(()=>JSON.parse(localStorage.getItem('editor-session-v1')))).views,sessionBefore.views);
// Process recreation restores auth/model and editing position from native vault/session.
await page.reload();await page.getByLabel('选择实例').waitFor();
assert.equal(Number(await page.getByRole('separator').getAttribute('aria-valuenow')),split);
await page.getByRole('button',{name:'AI',exact:true}).click();await page.getByText('模型已连接，可以开始编辑',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.__testNative.calls.includes('auth.signIn')),false);
assert.equal(await page.getByLabel('AI修改目标').inputValue(),'把当前房间改名用于验证，保留布局。');
const scopeBefore=await page.getByLabel('AI目标房间').inputValue();
await page.getByRole('button',{name:'世界',exact:true}).click();
assert.equal(await page.getByLabel('AI目标房间').inputValue(),scopeBefore);
await page.getByLabel('地图视图').selectOption('physical');await page.getByText(/265 间尚未定位/).waitFor();
await page.screenshot({path:'build/workflow/physical-map.png'});
// A failed update cannot replace the active workspace; success resets old tasks.
await page.evaluate(()=>window.__testNative.failRuntime=true);
await page.getByRole('button',{name:'游戏更新',exact:true}).click();
await page.getByRole('heading',{name:'载入新版游戏数据',exact:true}).waitFor();
await page.getByRole('button',{name:'载入新版',exact:true}).click();
await page.getByRole('alert').filter({hasText:'模拟运行包准备失败'}).waitFor();
await page.getByRole('alert').getByRole('button',{name:'×',exact:true}).click();
await page.evaluate(()=>window.__testNative.failRuntime=false);
await page.getByRole('button',{name:'载入新版',exact:true}).click();
await page.getByRole('heading',{name:'载入新版游戏数据',exact:true}).waitFor({state:'hidden'});
await page.getByRole('button',{name:'房间',exact:true}).click();
await page.getByLabel('搜索房间').fill('P-R03');await page.getByRole('button').filter({hasText:'P-R03'}).first().click();
assert.equal(await page.getByText('房间名称',{exact:true}).locator('..').locator('input').inputValue(),'新版初行草坡');
await page.getByRole('button',{name:'AI',exact:true}).click();assert.equal(await page.getByRole('button',{name:'撤销本次任务',exact:true}).count(),0);
await page.waitForTimeout(400);await page.reload();await page.getByText('模型已连接，可以开始编辑',{exact:true}).waitFor();
assert.ok(await page.locator('.breadcrumbs').innerText().then(s=>s.includes('新版初行草坡')));
await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'build/workflow/desktop.png'});
const result={errors,split,authRestoredWithoutSignIn:true,scopeStableOnNavigation:true,manualEditSurvivesTaskUndo:true,previewBridgePreservesView:true,updateReplacesOldDraftOnlyAfterRuntimeReady:true,realAndroidOrLiveInference:false};
await writeFile('build/workflow/browser-check.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));}catch(e){await page.screenshot({path:'build/workflow/failure.png'});console.error(e);process.exitCode=1;}finally{await context.close();await browser.close();}if(errors.length)process.exitCode=1;
