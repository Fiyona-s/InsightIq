import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const phase=process.argv[2]||'after';
const baseURL=process.env.UI_REVIEW_URL||'http://127.0.0.1:8080';
const modules=['Overview','Data workspace','AI Analyst','Dashboards','AutoML Studio','Knowledge base','Evaluation center','Run analytics','Execution traces'];
const browser=await chromium.launch({channel:'chrome'});
const report=[];
for(const [size,width,height] of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844]]){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 const page=await context.newPage();
 await page.goto(baseURL);
 for(const name of modules){
  const toggle=page.getByRole('button',{name:'Toggle navigation',exact:true});
  if(await toggle.isVisible())await toggle.click();
  await page.getByRole('button',{name,exact:true}).click();
  await page.locator('main h1').waitFor();
  await page.waitForTimeout(650);
  const filename=path.resolve('../docs/ui-refresh',phase,size,name.toLowerCase().replaceAll(' ','-')+'.png');
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  await page.screenshot({path:filename,fullPage:true});
  report.push({size,module:name,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),height:await page.evaluate(()=>document.documentElement.scrollHeight),screenshot:path.relative(path.resolve('..'),filename)});
 }
 await context.close();
}
await browser.close();
fs.writeFileSync(path.resolve('../docs/ui-refresh',phase,'review.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
