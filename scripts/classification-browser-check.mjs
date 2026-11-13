import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '@playwright/test';
const catalog=JSON.parse(fs.readFileSync('apps/editor/public/project.json')).catalog.elements;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');
 await page.getByLabel('搜索房间').fill('P-R03');
 await page.getByRole('button').filter({hasText:'P-R03'}).first().click();
 const filter=page.getByLabel('要素分类'),picker=page.getByLabel('放置要素');
 for(const [library,group] of Object.entries(catalog.libraries)){
  const expected=Object.values(catalog.definitions).filter(d=>d.placeable!==false&&d.library===library).map(d=>d.id).sort();
  if(!expected.length){assert.equal(await filter.locator(`option[value="${library}"]`).count(),0);continue;}
  await filter.selectOption(library);
  const actual=await picker.locator('option').evaluateAll(rows=>rows.map(r=>r.value).filter(Boolean).sort());
  assert.deepEqual(actual,expected,group.name);
 }
 await filter.selectOption('mechanisms');
 assert.equal(await picker.locator('option[value="decor.barrel"],option[value="enemy.charger"],option[value="platform.solid"]').count(),0);
 await picker.selectOption('switch.shot');
 await page.getByRole('button',{name:'删除要素／组合及附着物',exact:true}).click();
 await filter.selectOption('presentation');await picker.selectOption('decor.barrel');
 await page.getByText('barrel · 美术表现',{exact:true}).waitFor();
 await page.getByRole('button',{name:'删除要素／组合及附着物',exact:true}).click();
 await filter.selectOption('enemies');await picker.selectOption('enemy.charger');
 await page.getByText('怪物 · charger · 怪物与遭遇',{exact:true}).waitFor();
 await page.getByRole('button',{name:'删除要素／组合及附着物',exact:true}).click();
 assert.deepEqual(errors,[]);assert.deepEqual(await page.getByRole('alert').allTextContents(),[]);
 await page.setViewportSize({width:390,height:844});await filter.selectOption('mechanisms');await filter.scrollIntoViewIfNeeded();
 await page.screenshot({path:'build/classification-phone.png'});
 console.log('CLASSIFICATION BROWSER: every library matches the game catalog; mechanisms exclude art/enemies/terrain; placement and deletion pass');
}finally{await browser.close();}
