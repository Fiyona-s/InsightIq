import {selectGlobal, goAdmin } from './ui';
import {openAdmin} from './ui';
import {test,expect} from '@playwright/test';
import {openAnalysisTypes,openResultData,openResultSql,openResultCalculation} from './ui';
import fs from 'node:fs';
const folder='../docs/phase2/after';
test('Phase 2 computed card, follow-ups, clarification, feedback and dashboard pin',async({page,context})=>{
 test.setTimeout(90000);fs.mkdirSync(folder,{recursive:true});await context.grantPermissions(['clipboard-read','clipboard-write']);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const csv='id,revenue,region,order_date\n'+Array.from({length:35},(_,i)=>`${String(i+1).padStart(3,'0')},${i+1},${i%2?'West':'East'},2026-01-${String(i%28+1).padStart(2,'0')}`).join('\n')+'\n';
 const upload=await page.request.post('/api/datasets',{multipart:{file:{name:'synthetic-PHASE2.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}}});const dataset=await upload.json();expect(upload.status()).toBe(201);
 const made=await page.request.post('/api/dashboards',{data:{title:'PHASE2 controlled dashboard',description:''}});const dashboard=await made.json();
 await page.goto('/');await page.getByRole('button',{name:'Ask',exact:true}).click();await openAnalysisTypes(page);await page.getByLabel('Analysis type for revenue').selectOption('DOUBLE');await page.getByRole('checkbox').check();
 await expect(page.getByRole('region',{name:'Suggested questions'})).toBeVisible();await page.screenshot({path:folder+'/suggested-questions.png',fullPage:true});
 const sent:any[]=[];page.on('request',r=>{if(r.url().endsWith('/api/analyst/runs')&&r.method()==='POST')sent.push(r.postDataJSON())});
 async function ask(question:string){await page.getByRole('textbox',{name:'Your question',exact:true}).fill(question);await page.getByRole('button',{name:'Analyze',exact:true}).click();}
 await ask('PHASE2 slow total');await expect(page.locator('.analyst-skeleton')).toBeVisible();await page.screenshot({path:folder+'/loading.png',fullPage:true});
 await expect(page.locator('.answer-sentence')).toHaveText('Your total revenue is 630.');
 const card=page.getByRole('region',{name:'Result insights'});await expect(card.locator('.result-kpi strong')).toHaveText('630');
 expect(await card.locator('details.result-details').evaluate((el:HTMLDetailsElement)=>el.open)).toBe(false);
 expect(await card.innerText()).not.toMatch(/\[f\d+\]|finite values|nonfinite|model-selected computed facts/);
 expect((await card.innerText()).match(/630/g)?.length).toBe(1);await page.screenshot({path:folder+'/single-value.png',fullPage:true});
 await card.getByRole('button',{name:'Copy answer',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('Your total revenue is 630.');
 await openResultSql(page);await card.getByRole('button',{name:'Copy SQL'}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('SELECT');await openResultCalculation(page);await page.screenshot({path:folder+'/sql-calculation.png',fullPage:true});
 await card.getByRole('button',{name:'Helpful',exact:true}).click();await expect(card.getByRole('button',{name:'Helpful',exact:true})).toHaveAttribute('aria-pressed','true');
 await card.getByRole('button',{name:'Not helpful',exact:true}).click();await card.getByRole('button',{name:'Wrong columns'}).click();await card.getByLabel('Additional feedback').fill('Controlled feedback only');await page.screenshot({path:folder+'/feedback.png',fullPage:true});await card.getByRole('button',{name:'Save feedback'}).click();await expect(card.getByRole('button',{name:'Not helpful',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.reload();await page.getByRole('button',{name:'Ask',exact:true}).click();await page.getByRole('button',{name:/PHASE2 slow total/}).click();await expect(card.getByRole('button',{name:'Not helpful',exact:true})).toHaveAttribute('aria-pressed','true');await openAnalysisTypes(page);await page.getByRole('checkbox').check();
 await card.getByRole('button',{name:'Pin to dashboard',exact:true}).click();const popover=page.getByRole('dialog',{name:'Pin to dashboard'});await popover.getByLabel('Title',{exact:true}).fill('Revenue total');await popover.getByRole('combobox',{name:'Dashboard',exact:true}).selectOption(dashboard.id);await page.screenshot({path:folder+'/pin-popover.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:folder+'/pin-popover-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:720});await popover.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Tab');await expect(popover.getByRole('button',{name:'Pin',exact:true})).toBeFocused();await popover.getByRole('button',{name:'Pin',exact:true}).click();await expect(page.getByText(/Pinned to your dashboard/)).toBeVisible();
 expect((await (await page.request.get('/api/dashboards/'+dashboard.id)).json()).widgets[0].title).toBe('Revenue total');
 await ask('Total revenue by region');await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(2);await expect(page.locator('.answer-sentence')).toHaveText('Total revenue by region: East is highest at 324.');await page.screenshot({path:folder+'/grouped.png',fullPage:true});
 expect(sent[1].thread_id).toBe(sent[0].thread_id);await expect(page.getByRole('region',{name:'Earlier turns'})).toBeVisible();await page.screenshot({path:folder+'/follow-up.png',fullPage:true});
 await ask('PHASE2 ambiguous');await expect(page.locator('.analyst-clarification')).toBeVisible();await page.screenshot({path:folder+'/clarification.png',fullPage:true});await page.locator('.analyst-clarification').getByRole('button',{name:'revenue',exact:true}).click();await expect(page.locator('.answer-sentence')).toHaveText('Your total revenue is 630.');expect(sent[3].clarification_choice).toEqual({kind:'column',name:'revenue'});
 await page.getByRole('button',{name:'New question',exact:true}).click();await ask('PHASE2 show rows');await openResultData(page);await expect(page.getByRole('cell',{name:'001',exact:true})).toBeVisible();await page.getByRole('button',{name:/^Show all/}).click();await page.getByRole('button',{name:'Next result page'}).click();await expect(page.getByRole('cell',{name:'026',exact:true})).toBeVisible();expect(sent[4].thread_id).not.toBe(sent[0].thread_id);
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download CSV',exact:true}).click();expect((await download).suggestedFilename()).toBe('insightiq-result.csv');
 await page.getByRole('button',{name:'New question',exact:true}).click();await ask('PHASE2 empty');await expect(page.locator('.answer-sentence')).toHaveText('No rows matched this question.');
 await ask('PHASE2 unsafe query');await expect(page.locator('.analyst-error')).toBeVisible();await expect(page.locator('.analyst-error > details')).not.toHaveAttribute('open','');await page.screenshot({path:folder+'/error.png',fullPage:true});await page.getByRole('button',{name:'Edit question',exact:true}).click();await expect(page.getByRole('textbox',{name:'Your question',exact:true})).toHaveValue('PHASE2 unsafe query');
 await openAdmin(page);
 await goAdmin(page,"Performance & errors");await expect(page.locator('.feedback-counts')).toContainText('Not helpful: 1');
 expect(errors).toEqual([]);
});

test('switching datasets starts a new thread and requires fresh type confirmation',async({page})=>{
 const ids:string[]=[];
 for(const [name,amount] of [['synthetic-PHASE2-thread-a.csv',2],['synthetic-PHASE2-thread-b.csv',7]] as const){const r=await page.request.post('/api/datasets',{multipart:{file:{name,mimeType:'text/csv',buffer:Buffer.from(`id,revenue\n001,${amount}\n002,${amount}\n`)}}});expect(r.status()).toBe(201);ids.push((await r.json()).id);}
 await page.goto('/');await page.getByRole('button',{name:'Ask',exact:true}).click();await selectGlobal(page,ids[0]);
 const sent:any[]=[];page.on('request',r=>{if(r.url().endsWith('/api/analyst/runs')&&r.method()==='POST')sent.push(r.postDataJSON())});
 async function submit(){await openAnalysisTypes(page);await page.getByLabel('Analysis type for revenue').selectOption('DOUBLE');await page.getByRole('checkbox').check();await page.getByRole('textbox',{name:'Your question',exact:true}).fill('What is the total revenue?');await page.getByRole('button',{name:'Analyze',exact:true}).click();}
 await submit();await expect(page.locator('.answer-sentence')).toHaveText('Your total revenue is 4.');
 await selectGlobal(page,ids[1]);await expect(page.locator('.answer-sentence')).toHaveCount(0);await expect(page.getByRole('region',{name:'Earlier turns'})).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Your question',exact:true})).toHaveValue('');
 await submit();await expect(page.locator('.answer-sentence')).toHaveText('Your total revenue is 14.');expect(sent[0].dataset_id).toBe(ids[0]);expect(sent[1].dataset_id).toBe(ids[1]);expect(sent[0].thread_id).not.toBe(sent[1].thread_id);
});
