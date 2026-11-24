import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import KnowledgeEditor from './KnowledgeEditor';
import {insightApi,type Dataset,type KnowledgeInfo} from '../api';
import {reviewApi} from '../knowledgeReviewApi';
vi.mock('../api',()=>({insightApi:{knowledge:vi.fn(),saveKnowledge:vi.fn(),retrieve:vi.fn()}}));
vi.mock('../knowledgeReviewApi',()=>({reviewApi:{get:vi.fn(),draft:vi.fn()}}));
vi.mock('../datasetLifecycleApi',()=>({lifecycleApi:{dependencies:vi.fn().mockResolvedValue({counts:{dashboards:2,saved_charts:1}})}}));
const dataset={id:'d',name:'orders.csv',rows:2,bytes:10,created_at:'2026-01-01',columns:[]} as Dataset;
const initial={workspace_id:'w',dataset_id:'d',columns:['net_total','revenue'],settings:{description:'Original context',columns:{},metrics:[],monetary_columns:{net_total:{currency:'INR',mixed:false}}},schema_signature:'h',embedding_model:'local',verified_examples:0,updated_at:'2026-01-01'} as KnowledgeInfo;
beforeEach(()=>{vi.clearAllMocks();vi.mocked(insightApi.knowledge).mockResolvedValue(structuredClone(initial));vi.mocked(insightApi.saveKnowledge).mockImplementation(async(_id,settings)=>({...structuredClone(initial),settings}));vi.mocked(reviewApi.get).mockResolvedValue({revision:'r',drafts:[],examples:[]});Element.prototype.scrollIntoView=vi.fn()});afterEach(cleanup);
it('shows two real tabs, one primary button per tab, and keeps search, examples and AI drafting explicit',async()=>{
 render(<KnowledgeEditor datasets={[dataset]}/>);await screen.findByLabelText('Dataset description');
 expect(screen.getByText('Tell InsightIQ what your columns and key numbers mean.')).toBeVisible();expect(screen.getByText('0 of 2 columns described · 0 key metrics')).toBeVisible();
 const tabs=screen.getByRole('tablist',{name:'Business definitions'});expect(Array.from(tabs.querySelectorAll('[role=tab]')).map(t=>t.textContent)).toEqual(['What your columns mean','Your key metrics']);
 expect(screen.getByRole('textbox',{name:'net_total'})).toBeVisible();expect(screen.getByLabelText('Currency for net_total')).toHaveValue('INR');
 expect(document.querySelectorAll('.app .button-primary, .button-primary')).toHaveLength(1); // one primary action on this tab: Save definitions
 expect(await screen.findByRole('button',{name:'Draft with AI'})).toHaveClass('button-outline');   // drafting lives on the first tab, behind its disclosure
 expect(reviewApi.draft).not.toHaveBeenCalled();expect(insightApi.retrieve).not.toHaveBeenCalled();expect(insightApi.saveKnowledge).not.toHaveBeenCalled();
 const advanced=screen.getByText('Advanced: verified examples and search').closest('details')!;expect(advanced).not.toHaveAttribute('open');
 await userEvent.click(screen.getByText('Advanced: verified examples and search'));expect(await screen.findByRole('heading',{name:'What Ask can find'})).toBeVisible();expect(document.querySelector('#knowledge-examples')).toBeTruthy();
 await userEvent.click(screen.getByRole('tab',{name:'Your key metrics'}));expect(document.querySelectorAll('.button-primary')).toHaveLength(1);   // still exactly one primary button
});
it('keeps the metric calculation behind a disclosure that opens when it is empty',async()=>{
 render(<KnowledgeEditor datasets={[dataset]}/>);await screen.findByLabelText('Dataset description');
 await userEvent.click(screen.getByRole('tab',{name:'Your key metrics'}));await userEvent.click(screen.getByRole('button',{name:'Add metric'}));
 const box=screen.getByLabelText('The calculation (a read-only query)');expect(box.closest('details')).toHaveAttribute('open');   // empty: shown so it can be filled
 expect(screen.getByText('Show the calculation')).toBeInTheDocument();
});
it('only suggests money or a percentage from a name, and an owner choice confirms it',async()=>{
 vi.mocked(insightApi.knowledge).mockResolvedValue(structuredClone({...initial,settings:{...initial.settings,monetary_columns:{},units_confirmed:false}}) as KnowledgeInfo);
 render(<KnowledgeEditor datasets={[dataset]}/>);
 expect(await screen.findByText(/Suggested: money\. Not shown as such until you choose it/)).toBeVisible();
 expect(screen.getByLabelText('Currency for revenue')).toHaveValue('none');          // a suggestion is not a choice
 await userEvent.selectOptions(screen.getByLabelText('Currency for revenue'),'Percentage');
 expect(screen.getByLabelText('Currency for revenue')).toHaveValue('percent');
 expect(screen.queryByText(/Suggested: money/)).not.toBeInTheDocument();
});
it('adds visible required metric fields and saves metadata with explicit feedback without rewriting source currencies',async()=>{
 render(<KnowledgeEditor datasets={[dataset]}/>);await screen.findByLabelText('Dataset description');await userEvent.click(screen.getByRole('tab',{name:'Your key metrics'}));await userEvent.click(screen.getByRole('button',{name:'Add metric'}));
 expect(screen.getByLabelText('The calculation (a read-only query)')).toBeVisible();await userEvent.type(screen.getByLabelText('Name',{exact:true}),'Total');await userEvent.type(screen.getByLabelText('Definition',{exact:true}),'Recognized total');await userEvent.type(screen.getByLabelText('The calculation (a read-only query)'),'SELECT SUM(net_total) AS total FROM data');
 expect(screen.getByText('Unsaved changes')).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Save definitions'}));await screen.findByText('Definitions saved.',{exact:true});
 await waitFor(()=>expect(insightApi.saveKnowledge).toHaveBeenCalledWith('d',expect.objectContaining({monetary_columns:initial.settings.monetary_columns,metrics:[{name:'Total',description:'Recognized total',sql:'SELECT SUM(net_total) AS total FROM data'}]})));expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
});
it('keeps draft definitions and confirmed currencies after a failed save',async()=>{
 vi.mocked(insightApi.saveKnowledge).mockRejectedValueOnce(Error('Controlled save failure'));render(<KnowledgeEditor datasets={[dataset]}/>);const input=await screen.findByLabelText('Dataset description');await userEvent.clear(input);await userEvent.type(input,'Unsaved context');await userEvent.click(screen.getByRole('button',{name:'Save definitions'}));expect(await screen.findByRole('alert')).toHaveTextContent('Controlled save failure');expect(input).toHaveValue('Unsaved context');expect(screen.getByText('Unsaved changes')).toBeVisible();
});

it('shows the currency dependency impact dialog before saving a changed currency, and saves only after confirmation',async()=>{
 render(<KnowledgeEditor datasets={[dataset]}/>);await screen.findByLabelText('Dataset description');
 await userEvent.selectOptions(screen.getByLabelText('Currency for net_total'),'EUR');await userEvent.click(screen.getByRole('button',{name:'Save definitions'}));
 const dialog=await screen.findByRole('dialog',{name:'Currency dependency impact'});
 expect(dialog).toHaveTextContent('Currency changes affect future answers. Dashboards and saved results keep their saved snapshots.');expect(dialog).toHaveTextContent('dashboards: 2');
 expect(insightApi.saveKnowledge).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Save confirmed change'})).toBeDisabled();
 await userEvent.click(screen.getByLabelText('Confirm source-currency change'));await userEvent.click(screen.getByRole('button',{name:'Save confirmed change'}));
 await waitFor(()=>expect(insightApi.saveKnowledge).toHaveBeenCalled());
});
it('an ARCHIVED dataset\'s descriptions and key numbers are read-only in Business definitions and cannot be saved',async()=>{
 const archived={...dataset,id:'old',name:'old-orders.csv',archived_at:'2026-02-01T00:00:00Z'} as Dataset;
 vi.mocked(insightApi.knowledge).mockImplementation(async(id:string)=>structuredClone({...initial,dataset_id:id,settings:{...initial.settings,description:'Archived context',columns:{net_total:'Kept as written'}}}) as KnowledgeInfo);
 render(<KnowledgeEditor datasets={[dataset,archived]}/>);
 await screen.findByLabelText('Dataset description');
 expect(screen.getByRole('textbox',{name:'net_total'})).toBeEnabled();                      // the active dataset can be edited
 await userEvent.click(screen.getByText('Advanced: verified examples and search'));
 await userEvent.selectOptions(screen.getByLabelText('View an archived dataset’s definitions'),'old');
 await waitFor(()=>expect(insightApi.knowledge).toHaveBeenCalledWith('old'));
 expect(await screen.findByDisplayValue('Archived context')).toBeDisabled();                // dataset description
 expect(screen.getByRole('textbox',{name:'net_total'})).toBeDisabled();                     // column description
 expect(screen.getByRole('textbox',{name:'net_total'})).toHaveValue('Kept as written');     // still shown
 await userEvent.type(screen.getByRole('textbox',{name:'net_total'}),'x');                  // typing does nothing
 expect(screen.getByRole('textbox',{name:'net_total'})).toHaveValue('Kept as written');
 expect(insightApi.saveKnowledge).not.toHaveBeenCalled();
});
