import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import {openAdmin} from './ui';
// [route, page heading, sidebar label (null = reached from the top-bar Menu)]
const pages:[string,string,string|null][]=[['overview','Home','Home'],['datasets','Datasets','Datasets'],['analyst','Ask your data','Ask'],['dashboards','Dashboards','Dashboards'],['automl','Predictions','Predictions'],['knowledge','Business definitions','Business definitions'],['evaluation','Accuracy check','Accuracy check'],['analytics','Performance & errors','Performance & errors'],['traces','Execution traces','Execution traces'],['settings','Settings',null]];
test('Stage 1 task navigation, preferences, aliases and unobscured responsive headers',async({page})=>{
 test.setTimeout(180000);fs.mkdirSync('../docs/product-stage1/after',{recursive:true});const errors:string[]=[],reviews:unknown[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(!sessionStorage.getItem('admin-set')){localStorage.setItem('insightiq-admin-tools-v1','true');sessionStorage.setItem('admin-set','1')}});
 for(const width of [1280,768,390]){
  await page.setViewportSize({width,height:1000});
  for(const [route,title,navLabel]of pages){
   await page.goto('/#'+route);await expect(page.locator('main h1')).toHaveText(title);await page.waitForLoadState('networkidle');await page.waitForTimeout(200);
   const geometry=await page.evaluate(()=>{window.scrollTo(0,0);const h=document.querySelector('main h1')!.getBoundingClientRect(),header=document.querySelector('.main>header')!.getBoundingClientRect(),selector=document.querySelector('.main>header .dataset-trigger')?.getBoundingClientRect()      /* Home keeps its dataset picker inside the question box, not in the top bar */;return {headingTop:h.top,headerBottom:header.bottom,selectorBottom:selector?selector.bottom:0,overflow:document.documentElement.scrollWidth>innerWidth}});
   expect(geometry.headingTop,title+' clears full header').toBeGreaterThanOrEqual(geometry.headerBottom);expect(geometry.selectorBottom,title+' selector stays within header').toBeLessThanOrEqual(geometry.headerBottom);expect(geometry.overflow).toBe(false);
   await expect(page.locator('main h1')).toHaveText(title);
   if(navLabel&&['Accuracy check','Performance & errors','Execution traces','Dataset change history','Backup info'].includes(navLabel))await expect(page.locator('nav[aria-label="Main navigation"] [aria-current="page"]')).toHaveCount(0);else if(navLabel)await expect(page.locator('nav[aria-label="Main navigation"] [aria-current="page"]')).toHaveAttribute('aria-label',navLabel);      /* Admin pages are chosen from the Menu, so the rail marks none of them */
   const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>v.impact==='serious'||v.impact==='critical'),title+' axe').toEqual([]);reviews.push({route,width,...geometry,violations:axe.violations});
   await page.screenshot({path:`../docs/product-stage1/after/${route}-${width}.png`,fullPage:true});
  }
 }
 await page.setViewportSize({width:1280,height:1000});await page.goto('/#overview');await expect(page.locator('nav[aria-label="Main navigation"]').getByRole('button',{name:'Settings'})).toHaveCount(0);await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('menuitem',{name:'Settings'}).click();await expect(page.locator('main h1')).toHaveText('Settings');await expect(page).toHaveURL(/#settings$/);const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))requests.push(r.method()+' '+new URL(r.url()).pathname)});
 await page.goto('/#overview');await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:/Show admin tools/}).click();await expect(page.getByRole('menuitemcheckbox',{name:/Show admin tools/})).toHaveAttribute('aria-checked','false');await expect(page.getByRole('menuitem',{name:'Accuracy check',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');await page.getByRole('button',{name:'Business definitions',exact:true}).click();await expect(page.locator('main h1')).toHaveText('Business definitions');await openAdmin(page);await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByText(/not protected by a login/i)).toBeVisible();await page.keyboard.press('Escape');
 for(const [alias,title]of [['ask-your-data','Ask your data'],['ask-insightiq','Ask your data'],['check-answer-accuracy','Accuracy check'],['performance-%26-errors','Performance & errors'],['data-workspace','Datasets'],['my-data','Datasets'],['build-models','Predictions']]){await page.goto('/#'+alias);await expect(page.locator('main h1')).toHaveText(title)}
 expect(requests).toEqual([]);expect(errors).toEqual([]);fs.writeFileSync('../docs/product-stage1/browser-review.json',JSON.stringify({reviews,errors,preferenceMutatingRequests:requests},null,2));
});
