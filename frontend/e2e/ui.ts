import { expect, type Locator, type Page } from "@playwright/test";
export async function openAnalysisTypes(page: Page) {
  const panel = page.locator("details.type-settings");
  await panel.waitFor();
  if (!(await panel.evaluate((el: HTMLDetailsElement) => el.open)))
    await panel.locator("summary").click();
}
export async function knowledgeTab(page: Page, name: string) {
  // Stage 4: two tabs. AI drafts live on the first tab; verified examples and search are one "Advanced" disclosure.
  if (name === 'Advanced') {
    const details = page.locator('#knowledge-advanced');
    if (!(await details.evaluate((el: HTMLDetailsElement) => el.open))) await details.locator('summary').first().click();
    return;
  }
  await page.getByRole('tab', { name: name === 'AI drafts' ? 'What your columns mean' : name, exact: true }).click();
}
export async function openSourceCurrencies(page: Page) {
  // The currency choice now sits on each column row of the first Business definitions tab.
  await knowledgeTab(page, 'What your columns mean');
  return;
  const panel = page.locator("details.currency-settings");
  await panel.waitFor();
  if (!(await panel.evaluate((el: HTMLDetailsElement) => el.open)))
    await panel.locator("summary").click();
}
async function openResultDetails(page:Page,tab:string){if(await page.locator('form.question-composer').count())await page.locator('form.question-composer[aria-busy="false"]').waitFor();const panel=page.locator('details.result-details');await panel.waitFor();if(!await panel.evaluate((el:HTMLDetailsElement)=>el.open))await panel.locator(':scope > summary').click();const t=panel.getByRole('tab',{name:tab,exact:true});if(await t.getAttribute('aria-selected')!=='true')await t.click();}
export async function openResultData(page:Page){await openResultDetails(page,'Data');}
export async function openResultSql(page:Page){await openResultDetails(page,'SQL');}
export async function openResultCalculation(page:Page){await openResultDetails(page,'How this was calculated');}
export async function openResultTechnical(page:Page){await openAdmin(page);await openResultDetails(page,'Execution (admin)');}
export async function openResultActions(page:Page){const menu=page.getByRole('menu',{name:'More result actions'});if(!await menu.isVisible())await page.getByRole('button',{name:'More result actions',exact:true}).click();await menu.waitFor();}
// Admin tools are hidden by default; switch them on the way an owner would (Menu → Show admin tools).
export async function openAdmin(page:Page){await page.getByRole('button',{name:'Menu',exact:true}).click();const item=page.getByRole('menuitemcheckbox',{name:/Show admin tools/});if(await item.getAttribute('aria-checked')!=='true')await item.click();await expect(item).toHaveAttribute('aria-checked','true');await page.keyboard.press('Escape');}
// Admin pages live under the top-bar Menu (UI-CLEAN): open it and choose the page.
export async function goAdmin(page:Page,name:string){await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();}
export async function selectGlobal(page:Page,id:string){const response=await page.request.get('/api/datasets');const dataset=(await response.json()).find((d:{id:string})=>d.id===id);const trigger=page.getByRole('button',{name: /^Active dataset/});if(/#(datasets|data-workspace|my-data)/.test(page.url())){/* Datasets page: the dataset is chosen by selecting its row */await page.locator('table.dataset-table').getByRole('button',{name:new RegExp('^'+(dataset.display_name||dataset.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).first().click();return;}await trigger.click();await page.getByRole('textbox',{name:'Search active datasets'}).fill(dataset.display_name||dataset.name);await page.getByRole('option').filter({hasText:dataset.display_name||dataset.name}).click();}
export async function editDashboard(page:Page){const toggle=page.getByRole('button',{name:'Edit dashboard',exact:true});if(await page.getByRole('button',{name:'Done editing',exact:true}).isVisible())return;await toggle.click();}
export async function openDashboardCreation(page:Page){await page.getByRole('button',{name:'New dashboard',exact:true}).click();await page.getByRole('dialog',{name:'New dashboard'}).waitFor();}

export async function openEvaluationSetup(page:Page){const panel=page.locator('details.evaluation-new-run');await panel.waitFor();if(!await panel.evaluate((el:HTMLDetailsElement)=>el.open))await panel.locator(':scope > summary').click();}

export async function showDatasetList(page:Page){await page.waitForTimeout(400);const files=page.getByRole('button',{name:'Files',exact:true});if(await files.count()&&await files.isVisible())await files.click();}
export async function openVersionHistory(page:Page){await showDatasetList(page);const row=page.locator('tr.selected').first();await row.getByRole('button',{name:/^Actions for/}).click();await page.getByRole('menuitem',{name:'Version history'}).click();await page.getByRole('dialog',{name:'Version history'}).waitFor();}
export async function openDataQuality(page:Page){await page.getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('dialog',{name:'Data quality details'}).waitFor();}
export async function closeDrawer(page:Page){await page.keyboard.press('Escape');await expect(page.locator('dialog[open]')).toHaveCount(0);}
export async function closeDrawerIfOpen(page:Page){if(await page.locator('dialog[open]').count())await closeDrawer(page);}
// Dashboards (Stage 3): tabs instead of a picker, tile menus, Details drawer, Saved charts modal.
export async function openDashboard(page:Page,id:string){await page.locator('#dashboard-tab-'+id).click();}
export async function addSavedChart(page:Page,chartId:string){await page.getByRole('button',{name:'Add chart',exact:true}).click();const m=page.getByRole('dialog',{name:'Saved charts'});await m.getByLabel('Chart library').selectOption(chartId);await m.getByRole('button',{name:'Add chart widget',exact:true}).click();}
export async function addSavedChartAgain(page:Page){await page.getByRole('button',{name:'Add chart',exact:true}).click();await page.getByRole('dialog',{name:'Saved charts'}).getByRole('button',{name:'Add chart widget',exact:true}).click();}
export async function tileMenu(page:Page,tile:Locator,item:string){await tile.getByRole('button',{name:/^Actions for/}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();}
export async function openTileDetails(page:Page,tile:Locator,tab:'Exact rows'|'Evidence & provenance'='Exact rows'){await tileMenu(page,tile,'Details');const d=page.getByRole('dialog',{name:/Details$/});await d.waitFor();if(tab!=='Exact rows')await d.getByRole('tab',{name:tab}).click();return d;}
