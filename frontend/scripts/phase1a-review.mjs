import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const stage=process.argv[2]||'after';
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:8080';
const folder=`../docs/phase1a/${stage}`;fs.mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
const report={stage,pages:[],focus:{}};
await page.goto(base);
for(const [name,file] of [['Overview','overview'],['Data workspace','data-workspace'],['Dashboards','dashboard-inr']]){
 await page.getByRole('button',{name,exact:true}).click();
 await page.locator('main h1').waitFor();await page.waitForTimeout(700);
 await page.screenshot({path:`${folder}/${file}.png`,fullPage:true});
 const entry={page:name,localIndicators:await page.getByText('Local workspace',{exact:true}).count(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};
 if(name==='Dashboards')entry.axes=await page.locator('.recharts-yAxis-tick-labels').allTextContents();
 report.pages.push(entry);
}
const nav=page.getByRole('button',{name:'Overview',exact:true});
await nav.click();
report.focus.mouse=await nav.evaluate(el=>({visible:el.matches(':focus-visible'),outline:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth}));
await page.locator('#workspace-navigation').screenshot({path:`${folder}/sidebar-mouse.png`});
await page.getByRole('button',{name:'Collapse sidebar',exact:true}).focus();
await page.keyboard.press('Tab');await page.keyboard.press('Tab');
const current=page.locator(':focus');
report.focus.keyboard=await current.evaluate(el=>({label:el.getAttribute('aria-label'),visible:el.matches(':focus-visible'),outline:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth}));
await page.locator('#workspace-navigation').screenshot({path:`${folder}/sidebar-keyboard.png`});
if(stage==='after'){
 expect(report.pages.every(p=>p.localIndicators===1&&!p.overflow)).toBe(true);
 expect(report.focus.mouse.visible).toBe(false);expect(report.focus.mouse.outline).toBe('none');
 expect(report.focus.keyboard.visible).toBe(true);expect(report.focus.keyboard.outline).not.toBe('none');
 expect(report.pages.find(p=>p.page==='Dashboards').axes.join(' ')).toContain('L');
}
report.mobile = {};
await page.setViewportSize({width:390,height:844});
report.mobile.localVisible = await page.getByText('Local workspace',{exact:true}).isVisible();
report.mobile.overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
report.tokens = await page.evaluate(()=>{const style=getComputedStyle(document.documentElement);const rgb=style.getPropertyValue('--muted').trim().slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];return {helperColor:style.getPropertyValue('--muted').trim(),contrastOnWhite:1.05/(luminance+.05),bodySize:style.getPropertyValue('--text-body').trim()};});
if(stage==='after'){expect(report.mobile.localVisible).toBe(true);expect(report.mobile.overflow).toBe(false);expect(report.tokens.contrastOnWhite).toBeGreaterThanOrEqual(4.5);expect(report.tokens.bodySize).toBe('14px');}
fs.writeFileSync(`${folder}/inspection.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();
