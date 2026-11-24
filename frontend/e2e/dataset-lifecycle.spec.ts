import { openAdmin, openDashboard, goAdmin } from "./ui";
import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const folder='../docs/phase1b';
test('throwaway datasets: rename, dependency preview, archive/restore, guarded delete and retained history',async({page})=>{
 test.setTimeout(90000);fs.mkdirSync(folder,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 async function openCatalog(){await page.locator('table.dataset-table').waitFor()}
 const suffix=String(Date.now()),original=`synthetic-PHASE1B-${suffix}.csv`,other=`verification-PHASE1B-${suffix}.csv`,renamed=`Temporary sales PHASE1B ${suffix}`;
 async function upload(name:string){const r=await page.request.post('/api/datasets',{multipart:{file:{name,mimeType:'text/csv',buffer:Buffer.from('id,revenue,region\n001,1250,North\n002,20,South\n')}}});expect(r.status()).toBe(201);return r.json();}
 const first=await upload(original),second=await upload(other);
 // Controlled test-server model boundary, real SQL/result persistence. No live AI.
 const asked=await page.request.post('/api/analyst/runs',{data:{dataset_id:first.id,question:'What is the total revenue?',type_mapping:{revenue:'DOUBLE'}}});expect(asked.status()).toBe(202);const run=await asked.json();
 await expect.poll(async()=> (await (await page.request.get('/api/analyst/runs/'+run.id)).json()).status).toBe('succeeded');
 const saved=await page.request.post('/api/saved-charts',{data:{run_id:run.id,title:'PHASE1B retained snapshot',persist_snapshot_confirmed:true}});expect(saved.status()).toBe(201);const chart=await saved.json();
 const created=await page.request.post('/api/dashboards',{data:{title:'PHASE1B throwaway dashboard',description:''}});const dashboard=await created.json();
 const layout=await page.request.put('/api/dashboards/'+dashboard.id,{data:{title:dashboard.title,description:'',revision:dashboard.revision,filters:[],widgets:[{chart_id:chart.id,kind:'chart',title:'PHASE1B snapshot',width:6,height:4}]}});expect(layout.status()).toBe(200);
 await page.goto('/#datasets');await openCatalog();await page.getByLabel('Find a dataset',{exact:true}).fill(suffix);
 // Stage 6: names that look like test data are NOT samples until the owner marks them.
 await expect(page.locator('table.dataset-table .sample-badge')).toHaveCount(0);
 for(const d of [first,second])expect((await page.request.put('/api/datasets/'+d.id+'/sample',{data:{is_sample:true}})).status()).toBe(200);
 await page.reload();await openCatalog();await page.getByLabel('Find a dataset',{exact:true}).fill(suffix);
 await expect(page.locator('table.dataset-table .sample-badge')).toHaveCount(2);await page.screenshot({path:folder+'/dataset-list-samples.png',fullPage:true});
 await page.getByLabel('Hide sample data').check();await expect(page.locator('table.dataset-table .sample-badge')).toHaveCount(0);await page.reload();await expect(page.getByLabel('Hide sample data')).toBeChecked();await openCatalog();await page.getByLabel('Find a dataset',{exact:true}).fill(suffix);await page.getByLabel('Hide sample data').uncheck();await expect(page.locator('table.dataset-table .sample-badge')).toHaveCount(2);
 await page.getByLabel('Actions for '+original,{exact:true}).click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
 await page.getByLabel('Dataset display name',{exact:true}).fill(renamed);await page.screenshot({path:folder+'/inline-rename.png',fullPage:true});await page.getByLabel('Dataset display name',{exact:true}).press('Enter');
 await expect(page.locator('table.dataset-table [title="'+renamed+'"]')).toBeVisible();
 expect((await (await page.request.get('/api/datasets/'+first.id)).json()).name).toBe(original);
 await page.getByLabel('Actions for '+renamed,{exact:true}).click();await page.getByRole('menuitem',{name:'Archive',exact:true}).click();
 let dialog=page.getByRole('dialog');await expect(dialog.locator('summary').filter({hasText:'1 dashboard'})).toBeVisible();await expect(dialog.locator('summary').filter({hasText:'1 saved question'})).toBeVisible();await page.screenshot({path:folder+'/dependency-preview.png',fullPage:false});
 await dialog.getByRole('button',{name:'Archive',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('success');await dialog.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByLabel('Show archived').check();await expect(page.locator('table.dataset-table [title="'+renamed+'"]')).toBeVisible();await page.screenshot({path:folder+'/archived-filter.png',fullPage:true});
 await page.getByLabel('Actions for '+renamed,{exact:true}).click();await page.getByRole('menuitem',{name:'Restore',exact:true}).click();await expect(page.locator('tr').filter({has:page.locator('[title="'+renamed+'"]')}).getByText('Archived',{exact:true})).toHaveCount(0);
 await page.getByLabel('Show archived').uncheck();await page.getByLabel('Select all visible datasets',{exact:true}).check();await expect(page.getByRole('region',{name:'Selected dataset actions'})).toContainText('2 selected');await page.screenshot({path:folder+'/bulk-selection.png',fullPage:true});await page.getByRole('button',{name:'Clear',exact:true}).click();
 await page.getByLabel('Actions for '+renamed,{exact:true}).click();await page.getByRole('menuitem',{name:'Delete',exact:true}).click();dialog=page.getByRole('dialog');
 const remove=dialog.getByRole('button',{name:'Delete permanently',exact:true});await expect(remove).toBeDisabled();await dialog.getByLabel('Delete confirmation').fill(original);await expect(remove).toBeDisabled();await dialog.getByLabel('Delete confirmation').fill(renamed);await dialog.getByLabel(/I acknowledge/).check();await expect(remove).toBeEnabled();await page.screenshot({path:folder+'/single-delete-confirmation.png',fullPage:false});await remove.click();await expect(dialog.getByRole('status')).toContainText('success');await dialog.getByRole('button',{name:'Done',exact:true}).click();
 const deletedLabel=`Deleted dataset (${original})`;
 await page.getByRole('button',{name:'Home',exact:true}).click();await expect(page.locator('[title="'+deletedLabel+'"]')).toBeVisible();await page.screenshot({path:folder+'/deleted-history-overview.png',fullPage:true});
 await openAdmin(page);
 await goAdmin(page,"Performance & errors");await expect(page.locator('[title="'+deletedLabel+'"]')).toBeVisible();
 await page.getByRole('button',{name:'Dashboards',exact:true}).click();await openDashboard(page,dashboard.id);await expect(page.locator('.dashboards-page [title="'+deletedLabel+'"]')).toBeVisible();await expect(page.locator('.result-kpi strong')).toContainText('1,270');await page.screenshot({path:folder+'/deleted-history-dashboard.png',fullPage:true});
 // Delete only the second, freshly created throwaway fixture with bulk UI confirmation.
 await page.getByRole('button',{name:'Datasets',exact:true}).click();await openCatalog();await page.getByLabel('Find a dataset',{exact:true}).fill(suffix);await page.getByLabel('Select all visible datasets',{exact:true}).check();await page.getByRole('region',{name:'Selected dataset actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 // The bulk action bar uses DELETE even for a single selected fixture.
 dialog=page.getByRole('dialog');await dialog.getByLabel('Delete confirmation').fill('DELETE');const ack=dialog.getByLabel(/I acknowledge/);if(await ack.count())await ack.check();await dialog.getByRole('button',{name:'Delete permanently'}).click();await expect(dialog.getByRole('status')).toContainText('success');
 expect(errors).toEqual([]);
});

test('bulk DELETE confirmation processes only newly created selected fixtures',async({page})=>{
 const suffix=String(Date.now());for(const name of [`synthetic-bulk-PHASE1B-${suffix}.csv`,`verification-bulk-PHASE1B-${suffix}.csv`]){const r=await page.request.post('/api/datasets',{multipart:{file:{name,mimeType:'text/csv',buffer:Buffer.from('id\n001\n')}}});expect(r.status()).toBe(201);}
 await page.goto('/#datasets');await page.getByLabel('Find a dataset',{exact:true}).fill(suffix);await page.getByLabel('Select all visible datasets').check();await page.getByRole('region',{name:'Selected dataset actions'}).getByRole('button',{name:'Delete',exact:true}).click();const dialog=page.getByRole('dialog');const remove=dialog.getByRole('button',{name:'Delete permanently'});await expect(remove).toBeDisabled();await dialog.getByLabel('Delete confirmation').fill('DELETE');const ack=dialog.getByLabel(/I acknowledge/);if(await ack.count())await ack.check();await page.screenshot({path:folder+'/bulk-delete-confirmation.png',fullPage:false});await remove.click();await expect(dialog.getByRole('status')).toContainText('success');expect(await dialog.getByRole('status').getByRole('listitem').count()).toBe(2);
});
